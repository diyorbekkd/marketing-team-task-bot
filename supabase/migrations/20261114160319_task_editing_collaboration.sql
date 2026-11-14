-- Full task editing, separate publication scheduling, and immutable task
-- collaboration. The application still uses the trusted server client, but
-- actor/ownership checks are repeated inside mutation RPCs as defence in depth.

alter table public.tasks
  add column publication_at timestamptz;

create index tasks_publication_at_id_idx
  on public.tasks (publication_at, id)
  where publication_at is not null;

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  author_id uuid not null references public.users (id) on delete restrict,
  kind text not null default 'COMMENT' check (kind in ('COMMENT', 'RESULT')),
  body text check (body is null or char_length(body) between 1 and 4000),
  attachment_url text check (
    attachment_url is null
    or (
      char_length(attachment_url) <= 2048
      and attachment_url ~* '^https?://'
    )
  ),
  created_at timestamptz not null default now(),
  check (body is not null or attachment_url is not null)
);

create index task_comments_task_created_at_id_idx
  on public.task_comments (task_id, created_at, id);

create function private.prevent_task_comment_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'task_comments are immutable; append a new comment instead'
    using errcode = '55000';
end;
$$;

create trigger task_comments_prevent_update_or_delete
before update or delete on public.task_comments
for each row execute function private.prevent_task_comment_mutation();

alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (
  event_type in (
    'TASK_CREATED', 'TASK_ACCEPTED', 'STATUS_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED',
    'PRIORITY_CHANGED', 'DEADLINE_CHANGE_REQUESTED', 'DEADLINE_CHANGE_APPROVED',
    'DEADLINE_CHANGE_REJECTED', 'DEADLINE_CHANGED', 'REASSIGN_REQUESTED', 'REASSIGN_APPROVED',
    'REASSIGN_REJECTED', 'ASSIGNEE_CHANGED', 'TASK_BLOCKED', 'TASK_UNBLOCKED',
    'REVIEW_REQUESTED', 'REVISION_REQUESTED', 'TASK_COMPLETED', 'TASK_CANCELLED',
    'TASK_REOPENED', 'POSTING_CHECKLIST_CREATED', 'POSTING_CHECKLIST_ITEM_TOGGLED',
    'RECURRING_TASK_GENERATED', 'PUBLICATION_DATE_CHANGED', 'COMMENT_ADDED', 'RESULT_SUBMITTED'
  )
);

create function public.update_task_with_events(
  p_task_id uuid,
  p_actor_id uuid,
  p_patch jsonb
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.users;
  v_old public.tasks;
  v_task public.tasks;
  v_title text;
  v_description text;
  v_priority text;
  v_deadline timestamptz;
  v_assignee_id uuid;
  v_publication_at timestamptz;
  v_can_manage boolean;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'patch must be an object' using errcode = '22023';
  end if;
  if p_patch = '{}'::jsonb then
    raise exception 'at least one field is required' using errcode = '22023';
  end if;
  if (p_patch - array['title', 'description', 'priority', 'deadline', 'assigneeId', 'publicationAt']) <> '{}'::jsonb then
    raise exception 'patch contains unsupported fields' using errcode = '22023';
  end if;

  select * into v_actor
  from public.users
  where id = p_actor_id and is_active;

  if not found then
    raise exception 'actor is not active' using errcode = '42501';
  end if;

  select * into v_old
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if v_actor.role <> 'HEAD_OF_MARKETING'
     and v_old.creator_id <> p_actor_id
     and v_old.assignee_id <> p_actor_id then
    raise exception 'actor cannot view this task' using errcode = '42501';
  end if;

  v_can_manage := v_actor.role = 'HEAD_OF_MARKETING' or v_old.creator_id = p_actor_id;
  if not v_can_manage and (
    p_patch ? 'deadline'
    or p_patch ? 'assigneeId'
    or p_patch ? 'publicationAt'
  ) then
    raise exception 'assignee cannot change restricted fields' using errcode = '42501';
  end if;

  v_title := case
    when p_patch ? 'title' then nullif(btrim(p_patch ->> 'title'), '')
    else v_old.title
  end;
  if v_title is null or char_length(v_title) > 200 then
    raise exception 'title is invalid' using errcode = '22023';
  end if;

  v_description := case
    when p_patch ? 'description' then nullif(btrim(p_patch ->> 'description'), '')
    else v_old.description
  end;
  if v_description is not null and char_length(v_description) > 5000 then
    raise exception 'description is too long' using errcode = '22023';
  end if;

  v_priority := case
    when p_patch ? 'priority' then p_patch ->> 'priority'
    else v_old.priority
  end;
  if v_priority not in ('high', 'normal', 'low') then
    raise exception 'priority is invalid' using errcode = '22023';
  end if;

  if p_patch ? 'deadline' then
    if p_patch ->> 'deadline' is null then
      raise exception 'deadline is required' using errcode = '22023';
    end if;
    v_deadline := (p_patch ->> 'deadline')::timestamptz;
  else
    v_deadline := v_old.deadline;
  end if;

  if p_patch ? 'assigneeId' then
    if p_patch ->> 'assigneeId' is null then
      raise exception 'assignee is required' using errcode = '22023';
    end if;
    v_assignee_id := (p_patch ->> 'assigneeId')::uuid;
    if not exists (
      select 1 from public.users where id = v_assignee_id and is_active
    ) then
      raise exception 'assignee must be active' using errcode = '22023';
    end if;
  else
    v_assignee_id := v_old.assignee_id;
  end if;

  if p_patch ? 'publicationAt' then
    v_publication_at := case
      when p_patch -> 'publicationAt' = 'null'::jsonb then null
      else (p_patch ->> 'publicationAt')::timestamptz
    end;
  else
    v_publication_at := v_old.publication_at;
  end if;

  update public.tasks
  set title = v_title,
      description = v_description,
      priority = v_priority,
      deadline = v_deadline,
      assignee_id = v_assignee_id,
      publication_at = v_publication_at
  where id = p_task_id
  returning * into v_task;

  if v_old.title is distinct from v_task.title then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'TITLE_CHANGED', to_jsonb(v_old.title), to_jsonb(v_task.title));
  end if;
  if v_old.description is distinct from v_task.description then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'DESCRIPTION_CHANGED', to_jsonb(v_old.description), to_jsonb(v_task.description));
  end if;
  if v_old.priority is distinct from v_task.priority then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'PRIORITY_CHANGED', to_jsonb(v_old.priority), to_jsonb(v_task.priority));
  end if;
  if v_old.assignee_id is distinct from v_task.assignee_id then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'ASSIGNEE_CHANGED', to_jsonb(v_old.assignee_id), to_jsonb(v_task.assignee_id));
  end if;
  if v_old.deadline is distinct from v_task.deadline then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'DEADLINE_CHANGED', to_jsonb(v_old.deadline), to_jsonb(v_task.deadline));

    with cancelled as (
      update public.deadline_change_requests
      set status = 'CANCELLED',
          resolved_by = p_actor_id,
          resolved_at = statement_timestamp(),
          resolution_note = 'Deadline was changed directly.'
      where task_id = p_task_id and status = 'PENDING'
      returning *
    )
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    select
      p_task_id,
      p_actor_id,
      'DEADLINE_CHANGE_REJECTED',
      to_jsonb(cancelled.current_deadline),
      to_jsonb(cancelled.requested_deadline),
      jsonb_build_object('requestId', cancelled.id, 'reason', 'STALE_AFTER_DIRECT_CHANGE')
    from cancelled;
  end if;
  if v_old.publication_at is distinct from v_task.publication_at then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (
      p_task_id,
      p_actor_id,
      'PUBLICATION_DATE_CHANGED',
      to_jsonb(v_old.publication_at),
      to_jsonb(v_task.publication_at)
    );
  end if;

  return v_task;
end;
$$;

create function public.add_task_comment_with_event(
  p_task_id uuid,
  p_author_id uuid,
  p_kind text,
  p_body text default null,
  p_attachment_url text default null
)
returns public.task_comments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor public.users;
  v_task public.tasks;
  v_comment public.task_comments;
  v_body text := nullif(btrim(p_body), '');
  v_attachment_url text := nullif(btrim(p_attachment_url), '');
begin
  select * into v_actor
  from public.users
  where id = p_author_id and is_active;

  if not found then
    raise exception 'author is not active' using errcode = '42501';
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id;

  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if v_actor.role <> 'HEAD_OF_MARKETING'
     and v_task.creator_id <> p_author_id
     and v_task.assignee_id <> p_author_id then
    raise exception 'author cannot view this task' using errcode = '42501';
  end if;

  if p_kind not in ('COMMENT', 'RESULT') then
    raise exception 'comment kind is invalid' using errcode = '22023';
  end if;
  if v_body is null and v_attachment_url is null then
    raise exception 'comment body or attachment is required' using errcode = '22023';
  end if;
  if v_body is not null and char_length(v_body) > 4000 then
    raise exception 'comment body is too long' using errcode = '22023';
  end if;
  if v_attachment_url is not null and (
    char_length(v_attachment_url) > 2048
    or v_attachment_url !~* '^https?://'
  ) then
    raise exception 'attachment URL is invalid' using errcode = '22023';
  end if;

  insert into public.task_comments (task_id, author_id, kind, body, attachment_url)
  values (p_task_id, p_author_id, p_kind, v_body, v_attachment_url)
  returning * into v_comment;

  insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
  values (
    p_task_id,
    p_author_id,
    case when p_kind = 'RESULT' then 'RESULT_SUBMITTED' else 'COMMENT_ADDED' end,
    jsonb_build_object('commentId', v_comment.id),
    jsonb_build_object(
      'kind', p_kind,
      'hasBody', v_body is not null,
      'attachmentUrl', v_attachment_url
    )
  );

  return v_comment;
end;
$$;

alter table public.task_comments enable row level security;

revoke all on table public.task_comments from public, anon, authenticated;
grant select, insert on table public.task_comments to service_role;

revoke all on function public.update_task_with_events(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.add_task_comment_with_event(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_task_with_events(uuid, uuid, jsonb) to service_role;
grant execute on function public.add_task_comment_with_event(uuid, uuid, text, text, text) to service_role;

comment on column public.tasks.publication_at is
  'Optional planned publication time, separate from the work completion deadline.';
comment on table public.task_comments is
  'Append-only task discussion and submitted-result links; mutations are audited in task_events.';
