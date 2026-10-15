-- Sprint 10B: active-team visibility, creator/Head direct task management,
-- assignee change requests, Head-only dual-channel resolution, orthogonal
-- soft archive/restore, and semantic notification idempotency.

create table public.task_archives (
  task_id uuid primary key references public.tasks (id) on delete restrict,
  archived_at timestamptz not null default statement_timestamp(),
  archived_by uuid not null references public.users (id) on delete restrict,
  reason text check (reason is null or char_length(btrim(reason)) between 1 and 2000)
);

create index task_archives_archived_by_idx
  on public.task_archives (archived_by, archived_at desc);

create table public.task_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 300),
  recipient_user_id uuid not null references public.users (id) on delete restrict,
  status text not null default 'CLAIMED' check (status in ('CLAIMED', 'SENT', 'FAILED')),
  failure_reason text,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (dedupe_key, recipient_user_id)
);

create index task_notification_deliveries_recipient_created_idx
  on public.task_notification_deliveries (recipient_user_id, created_at desc);

alter table public.task_archives enable row level security;
alter table public.task_notification_deliveries enable row level security;

revoke all on table public.task_archives from public, anon, authenticated, service_role;
revoke all on table public.task_notification_deliveries from public, anon, authenticated, service_role;
grant select, insert, delete on table public.task_archives to service_role;
grant select, insert, update on table public.task_notification_deliveries to service_role;

alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (
  event_type in (
    'TASK_CREATED', 'TASK_ACCEPTED', 'STATUS_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED',
    'PRIORITY_CHANGED', 'DEADLINE_CHANGE_REQUESTED', 'DEADLINE_CHANGE_APPROVED',
    'DEADLINE_CHANGE_REJECTED', 'DEADLINE_CHANGE_CANCELLED', 'DEADLINE_CHANGED',
    'REASSIGN_REQUESTED', 'REASSIGN_APPROVED', 'REASSIGN_REJECTED', 'REASSIGN_CANCELLED',
    'ASSIGNEE_CHANGED', 'TASK_BLOCKED', 'TASK_UNBLOCKED', 'REVIEW_REQUESTED',
    'REVISION_REQUESTED', 'TASK_COMPLETED', 'TASK_CANCELLED', 'TASK_REOPENED',
    'TASK_ARCHIVED', 'TASK_RESTORED', 'POSTING_CHECKLIST_CREATED',
    'POSTING_CHECKLIST_ITEM_TOGGLED', 'RECURRING_TASK_GENERATED'
  )
);

create function private.prevent_task_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'tasks are retained; archive instead of deleting'
    using errcode = 'PT409';
end;
$$;

create trigger tasks_prevent_hard_delete
before delete on public.tasks
for each row execute function private.prevent_task_hard_delete();

create function private.prevent_archived_task_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.task_archives where task_id = old.id
  ) then
    raise exception 'archived task must be restored before mutation'
      using errcode = 'PT409';
  end if;
  return new;
end;
$$;

create trigger tasks_prevent_archived_update
before update on public.tasks
for each row execute function private.prevent_archived_task_update();

revoke execute on function private.prevent_task_hard_delete() from public, anon, authenticated, service_role;
revoke execute on function private.prevent_archived_task_update() from public, anon, authenticated, service_role;

create function public.update_task_content_with_events(
  p_task_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text,
  p_priority text
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_old_title text;
  v_old_description text;
  v_old_priority text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found or (v_actor.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_actor_id) then
    raise exception 'only the active task creator or Head may edit task content'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task content cannot be changed' using errcode = 'PT409';
  end if;

  v_old_title := v_task.title;
  v_old_description := v_task.description;
  v_old_priority := v_task.priority;

  update public.tasks
  set title = btrim(p_title),
      description = nullif(btrim(p_description), ''),
      priority = p_priority
  where id = p_task_id
  returning * into v_task;

  if v_old_title is distinct from v_task.title then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'TITLE_CHANGED', to_jsonb(v_old_title), to_jsonb(v_task.title));
  end if;
  if v_old_description is distinct from v_task.description then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'DESCRIPTION_CHANGED', to_jsonb(v_old_description), to_jsonb(v_task.description));
  end if;
  if v_old_priority is distinct from v_task.priority then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'PRIORITY_CHANGED', to_jsonb(v_old_priority), to_jsonb(v_task.priority));
  end if;

  return v_task;
end;
$$;

create or replace function public.reassign_task_with_event(
  p_task_id uuid,
  p_new_assignee_id uuid,
  p_actor_id uuid
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_old_assignee uuid;
  v_cancelled_request public.reassign_requests;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found or (v_actor.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_actor_id) then
    raise exception 'only the active task creator or Head may directly reassign'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'a terminal task cannot be reassigned' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.users where id = p_new_assignee_id and is_active) then
    raise exception 'new assignee must be an active team member' using errcode = '22023';
  end if;
  if v_task.assignee_id = p_new_assignee_id then
    return v_task;
  end if;

  update public.reassign_requests
  set status = 'CANCELLED', resolved_by = p_actor_id,
      resolved_at = statement_timestamp(), resolution_note = 'Superseded by direct reassignment'
  where task_id = p_task_id and status = 'PENDING'
  returning * into v_cancelled_request;

  if v_cancelled_request.id is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_task_id, p_actor_id, 'REASSIGN_CANCELLED',
      to_jsonb(v_cancelled_request.current_assignee_id),
      to_jsonb(v_cancelled_request.requested_assignee_id),
      jsonb_build_object('requestId', v_cancelled_request.id, 'reason', 'SUPERSEDED_BY_DIRECT_CHANGE')
    );
  end if;

  v_old_assignee := v_task.assignee_id;
  update public.tasks set assignee_id = p_new_assignee_id
  where id = p_task_id returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_actor_id, 'ASSIGNEE_CHANGED',
    to_jsonb(v_old_assignee), to_jsonb(p_new_assignee_id),
    jsonb_build_object('mode', 'DIRECT')
  );

  return v_task;
end;
$$;

create function public.change_task_deadline_with_event(
  p_task_id uuid,
  p_new_deadline timestamptz,
  p_actor_id uuid
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_old_deadline timestamptz;
  v_cancelled_request public.deadline_change_requests;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found or (v_actor.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_actor_id) then
    raise exception 'only the active task creator or Head may directly change the deadline'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'a terminal task deadline cannot be changed' using errcode = 'PT409';
  end if;
  if p_new_deadline <= statement_timestamp() then
    raise exception 'new deadline must be in the future' using errcode = '22023';
  end if;
  if v_task.deadline = p_new_deadline then
    return v_task;
  end if;

  update public.deadline_change_requests
  set status = 'CANCELLED', resolved_by = p_actor_id,
      resolved_at = statement_timestamp(), resolution_note = 'Superseded by direct deadline change'
  where task_id = p_task_id and status = 'PENDING'
  returning * into v_cancelled_request;

  if v_cancelled_request.id is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_task_id, p_actor_id, 'DEADLINE_CHANGE_CANCELLED',
      to_jsonb(v_cancelled_request.current_deadline),
      to_jsonb(v_cancelled_request.requested_deadline),
      jsonb_build_object('requestId', v_cancelled_request.id, 'reason', 'SUPERSEDED_BY_DIRECT_CHANGE')
    );
  end if;

  v_old_deadline := v_task.deadline;
  update public.tasks set deadline = p_new_deadline
  where id = p_task_id returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_actor_id, 'DEADLINE_CHANGED',
    to_jsonb(v_old_deadline), to_jsonb(p_new_deadline),
    jsonb_build_object('mode', 'DIRECT')
  );

  return v_task;
end;
$$;

create or replace function public.create_deadline_change_request_with_event(
  p_task_id uuid,
  p_requested_by uuid,
  p_requested_deadline timestamptz,
  p_reason text
)
returns public.deadline_change_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_request public.deadline_change_requests;
  v_requester public.users;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  select * into v_requester from public.users where id = p_requested_by and is_active;
  if not found or v_task.assignee_id <> p_requested_by then
    raise exception 'only the active assignee may request a deadline change' using errcode = '42501';
  end if;
  if v_requester.role = 'HEAD_OF_MARKETING' or v_task.creator_id = p_requested_by then
    raise exception 'creator or Head must use the direct deadline path' using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task cannot change deadline' using errcode = 'PT409';
  end if;
  if p_requested_deadline <= statement_timestamp() then
    raise exception 'requested deadline must be in the future' using errcode = '22023';
  end if;

  begin
    insert into public.deadline_change_requests (
      task_id, requested_by, current_deadline, requested_deadline, reason
    ) values (
      p_task_id, p_requested_by, v_task.deadline, p_requested_deadline, btrim(p_reason)
    ) returning * into v_request;
  exception when unique_violation then
    raise exception 'a pending deadline request already exists' using errcode = 'PT409';
  end;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_requested_by, 'DEADLINE_CHANGE_REQUESTED',
    to_jsonb(v_task.deadline), to_jsonb(p_requested_deadline),
    jsonb_build_object('requestId', v_request.id, 'reason', v_request.reason)
  );
  return v_request;
end;
$$;

create or replace function public.resolve_deadline_change_request_with_events(
  p_request_id uuid,
  p_resolved_by uuid,
  p_approve boolean,
  p_resolution_note text default null
)
returns public.deadline_change_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.deadline_change_requests;
  v_task public.tasks;
  v_resolver public.users;
begin
  -- Lock in the same task -> request order used by direct deadline changes.
  -- The first unlocked read only discovers the task id; both the request and
  -- its status are read again under lock before any mutation.
  select * into v_request from public.deadline_change_requests
  where id = p_request_id;
  if not found then
    raise exception 'deadline request not found' using errcode = 'P0002';
  end if;

  select * into v_task from public.tasks where id = v_request.task_id for update;
  select * into v_request from public.deadline_change_requests
  where id = p_request_id for update;
  if v_request.status <> 'PENDING' then
    raise exception 'deadline request is already resolved' using errcode = 'PT409';
  end if;
  select * into v_resolver from public.users
  where id = p_resolved_by and is_active and role = 'HEAD_OF_MARKETING';
  if not found then
    raise exception 'only active Head may resolve deadline requests' using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = v_task.id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if p_approve and v_task.deadline <> v_request.current_deadline then
    raise exception 'deadline request is stale' using errcode = 'PT409';
  end if;

  update public.deadline_change_requests
  set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      resolved_by = p_resolved_by,
      resolved_at = statement_timestamp(),
      resolution_note = nullif(btrim(p_resolution_note), '')
  where id = p_request_id and status = 'PENDING'
  returning * into v_request;
  if v_request.id is null then
    raise exception 'deadline request was concurrently resolved' using errcode = 'PT409';
  end if;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    v_task.id, p_resolved_by,
    case when p_approve then 'DEADLINE_CHANGE_APPROVED' else 'DEADLINE_CHANGE_REJECTED' end,
    to_jsonb(v_request.current_deadline), to_jsonb(v_request.requested_deadline),
    jsonb_build_object('requestId', v_request.id, 'resolutionNote', v_request.resolution_note)
  );

  if p_approve then
    update public.tasks set deadline = v_request.requested_deadline where id = v_task.id;
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      v_task.id, p_resolved_by, 'DEADLINE_CHANGED',
      to_jsonb(v_request.current_deadline), to_jsonb(v_request.requested_deadline),
      jsonb_build_object('requestId', v_request.id, 'mode', 'REQUEST')
    );
  end if;
  return v_request;
end;
$$;

create function public.create_reassign_request_with_event(
  p_task_id uuid,
  p_requested_by uuid,
  p_requested_assignee_id uuid,
  p_reason text
)
returns public.reassign_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_request public.reassign_requests;
  v_requester public.users;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  select * into v_requester from public.users where id = p_requested_by and is_active;
  if not found or v_task.assignee_id <> p_requested_by then
    raise exception 'only the active assignee may request reassignment' using errcode = '42501';
  end if;
  if v_requester.role = 'HEAD_OF_MARKETING' or v_task.creator_id = p_requested_by then
    raise exception 'creator or Head must use the direct reassignment path' using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task cannot be reassigned' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.users where id = p_requested_assignee_id and is_active) then
    raise exception 'requested assignee must be an active team member' using errcode = '22023';
  end if;

  begin
    insert into public.reassign_requests (
      task_id, requested_by, current_assignee_id, requested_assignee_id, reason
    ) values (
      p_task_id, p_requested_by, v_task.assignee_id, p_requested_assignee_id, btrim(p_reason)
    ) returning * into v_request;
  exception when unique_violation then
    raise exception 'a pending reassign request already exists' using errcode = 'PT409';
  end;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_requested_by, 'REASSIGN_REQUESTED',
    to_jsonb(v_task.assignee_id), to_jsonb(p_requested_assignee_id),
    jsonb_build_object('requestId', v_request.id, 'reason', v_request.reason)
  );
  return v_request;
end;
$$;

create function public.resolve_reassign_request_with_events(
  p_request_id uuid,
  p_resolved_by uuid,
  p_approve boolean,
  p_resolution_note text default null
)
returns public.reassign_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request public.reassign_requests;
  v_task public.tasks;
  v_resolver public.users;
begin
  -- Match the task -> request lock order used by direct reassignment. The
  -- authoritative request state is re-read under lock before the decision.
  select * into v_request from public.reassign_requests
  where id = p_request_id;
  if not found then
    raise exception 'reassign request not found' using errcode = 'P0002';
  end if;

  select * into v_task from public.tasks where id = v_request.task_id for update;
  select * into v_request from public.reassign_requests
  where id = p_request_id for update;
  if v_request.status <> 'PENDING' then
    raise exception 'reassign request is already resolved' using errcode = 'PT409';
  end if;
  select * into v_resolver from public.users
  where id = p_resolved_by and is_active and role = 'HEAD_OF_MARKETING';
  if not found then
    raise exception 'only active Head may resolve reassign requests' using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = v_task.id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if p_approve and v_task.assignee_id <> v_request.current_assignee_id then
    raise exception 'reassign request is stale' using errcode = 'PT409';
  end if;
  if p_approve and not exists (
    select 1 from public.users where id = v_request.requested_assignee_id and is_active
  ) then
    raise exception 'requested assignee is no longer active' using errcode = 'PT409';
  end if;

  update public.reassign_requests
  set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      resolved_by = p_resolved_by,
      resolved_at = statement_timestamp(),
      resolution_note = nullif(btrim(p_resolution_note), '')
  where id = p_request_id and status = 'PENDING'
  returning * into v_request;
  if v_request.id is null then
    raise exception 'reassign request was concurrently resolved' using errcode = 'PT409';
  end if;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    v_task.id, p_resolved_by,
    case when p_approve then 'REASSIGN_APPROVED' else 'REASSIGN_REJECTED' end,
    to_jsonb(v_request.current_assignee_id), to_jsonb(v_request.requested_assignee_id),
    jsonb_build_object('requestId', v_request.id, 'resolutionNote', v_request.resolution_note)
  );

  if p_approve then
    update public.tasks set assignee_id = v_request.requested_assignee_id where id = v_task.id;
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      v_task.id, p_resolved_by, 'ASSIGNEE_CHANGED',
      to_jsonb(v_request.current_assignee_id), to_jsonb(v_request.requested_assignee_id),
      jsonb_build_object('requestId', v_request.id, 'mode', 'REQUEST')
    );
  end if;
  return v_request;
end;
$$;

create function public.archive_task_with_event(
  p_task_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns public.task_archives
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_archive public.task_archives;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  select * into v_actor from public.users
  where id = p_actor_id and is_active and role = 'HEAD_OF_MARKETING';
  if not found then
    raise exception 'only active Head may archive tasks' using errcode = '42501';
  end if;

  select * into v_archive from public.task_archives where task_id = p_task_id;
  if found then return v_archive; end if;

  insert into public.task_archives (task_id, archived_by, reason)
  values (p_task_id, p_actor_id, nullif(btrim(p_reason), ''))
  returning * into v_archive;

  insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
  values (
    p_task_id, p_actor_id, 'TASK_ARCHIVED', to_jsonb(v_task.status),
    jsonb_strip_nulls(jsonb_build_object('reason', v_archive.reason))
  );
  return v_archive;
end;
$$;

create function public.restore_task_with_event(
  p_task_id uuid,
  p_actor_id uuid
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_archive public.task_archives;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  select * into v_actor from public.users
  where id = p_actor_id and is_active and role = 'HEAD_OF_MARKETING';
  if not found then
    raise exception 'only active Head may restore tasks' using errcode = '42501';
  end if;

  delete from public.task_archives where task_id = p_task_id returning * into v_archive;
  if v_archive.task_id is null then return v_task; end if;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_actor_id, 'TASK_RESTORED', to_jsonb(v_archive.archived_at),
    to_jsonb(v_task.status), jsonb_build_object('archivedBy', v_archive.archived_by)
  );
  return v_task;
end;
$$;

revoke execute on function public.update_task_content_with_events(uuid, uuid, text, text, text) from public, anon, authenticated, service_role;
revoke execute on function public.reassign_task_with_event(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.change_task_deadline_with_event(uuid, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.create_deadline_change_request_with_event(uuid, uuid, timestamptz, text) from public, anon, authenticated, service_role;
revoke execute on function public.resolve_deadline_change_request_with_events(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
revoke execute on function public.create_reassign_request_with_event(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.resolve_reassign_request_with_events(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;
revoke execute on function public.archive_task_with_event(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.restore_task_with_event(uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.update_task_content_with_events(uuid, uuid, text, text, text) to service_role;
grant execute on function public.reassign_task_with_event(uuid, uuid, uuid) to service_role;
grant execute on function public.change_task_deadline_with_event(uuid, timestamptz, uuid) to service_role;
grant execute on function public.create_deadline_change_request_with_event(uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.resolve_deadline_change_request_with_events(uuid, uuid, boolean, text) to service_role;
grant execute on function public.create_reassign_request_with_event(uuid, uuid, uuid, text) to service_role;
grant execute on function public.resolve_reassign_request_with_events(uuid, uuid, boolean, text) to service_role;
grant execute on function public.archive_task_with_event(uuid, uuid, text) to service_role;
grant execute on function public.restore_task_with_event(uuid, uuid) to service_role;

comment on table public.task_archives is
  'Current soft-archive marker. Workflow status remains unchanged; immutable task events retain archive/restore history.';
comment on table public.task_notification_deliveries is
  'Semantic Telegram notification idempotency ledger. One delivery claim per event key and recipient.';
comment on function public.resolve_deadline_change_request_with_events(uuid, uuid, boolean, text) is
  'Head-only, first-resolution-wins deadline decision shared by Telegram and Content OS.';
comment on function public.resolve_reassign_request_with_events(uuid, uuid, boolean, text) is
  'Head-only, first-resolution-wins reassignment decision shared by Telegram and Content OS.';
