-- Fast-track MVP transactional workflow functions.

alter table public.tasks
  add column blocked_reason text,
  add column source_telegram_update_id bigint unique,
  add constraint tasks_blocked_reason_matches_status_check check (
    (status = 'BLOCKED' and blocked_reason is not null and char_length(btrim(blocked_reason)) between 1 and 2000)
    or (status <> 'BLOCKED' and blocked_reason is null)
  );

create function public.register_telegram_user(
  p_telegram_user_id bigint,
  p_telegram_username text,
  p_display_name text
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users;
  v_has_head boolean;
begin
  if p_telegram_user_id <= 0 or char_length(btrim(p_display_name)) = 0 then
    raise exception 'invalid Telegram identity' using errcode = '22023';
  end if;

  lock table public.users in share row exclusive mode;

  select * into v_user
  from public.users
  where telegram_user_id = p_telegram_user_id;

  if found then
    update public.users
    set telegram_username = nullif(lower(btrim(p_telegram_username)), ''),
        display_name = btrim(p_display_name)
    where id = v_user.id
    returning * into v_user;
    return v_user;
  end if;

  select exists (
    select 1 from public.users
    where role = 'HEAD_OF_MARKETING' and is_active
  ) into v_has_head;

  insert into public.users (
    telegram_user_id,
    telegram_username,
    display_name,
    role,
    is_active
  ) values (
    p_telegram_user_id,
    nullif(lower(btrim(p_telegram_username)), ''),
    btrim(p_display_name),
    case when v_has_head then 'SMM_MANAGER' else 'HEAD_OF_MARKETING' end,
    not v_has_head
  )
  returning * into v_user;

  return v_user;
end;
$$;

create function public.create_task_with_event(
  p_creator_id uuid,
  p_assignee_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_deadline timestamptz,
  p_source_telegram_update_id bigint default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if not exists (select 1 from public.users where id = p_creator_id and is_active) then
    raise exception 'creator is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_assignee_id and is_active) then
    raise exception 'assignee is not active' using errcode = '22023';
  end if;

  insert into public.tasks (
    title,
    description,
    priority,
    creator_id,
    assignee_id,
    deadline,
    source_telegram_update_id
  ) values (
    btrim(p_title),
    nullif(btrim(p_description), ''),
    p_priority,
    p_creator_id,
    p_assignee_id,
    p_deadline,
    p_source_telegram_update_id
  )
  on conflict (source_telegram_update_id) do nothing
  returning * into v_task;

  if v_task.id is null and p_source_telegram_update_id is not null then
    select * into v_task
    from public.tasks
    where source_telegram_update_id = p_source_telegram_update_id;
    return v_task;
  end if;

  insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
  values (
    v_task.id,
    p_creator_id,
    'TASK_CREATED',
    jsonb_build_object(
      'title', v_task.title,
      'assigneeId', v_task.assignee_id,
      'priority', v_task.priority,
      'deadline', v_task.deadline
    ),
    case
      when p_source_telegram_update_id is null then '{}'::jsonb
      else jsonb_build_object('telegramUpdateId', p_source_telegram_update_id)
    end
  );

  return v_task;
end;
$$;

create function public.transition_task_with_events(
  p_task_id uuid,
  p_actor_id uuid,
  p_new_status text,
  p_reason text default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_old_status text;
  v_special_event text;
begin
  if not exists (select 1 from public.users where id = p_actor_id and is_active) then
    raise exception 'actor is not active' using errcode = '42501';
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  v_old_status := v_task.status;
  if v_old_status = p_new_status then
    return v_task;
  end if;

  if not (
    (v_old_status = 'ASSIGNED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'IN_PROGRESS' and p_new_status in ('BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status = 'BLOCKED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'REVIEW' and p_new_status in ('DONE', 'REVISION', 'CANCELLED'))
    or (v_old_status = 'REVISION' and p_new_status in ('IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED')
  ) then
    raise exception 'task status changed concurrently' using errcode = '40001';
  end if;

  if p_new_status = 'BLOCKED' and nullif(btrim(p_reason), '') is null then
    raise exception 'blocked reason is required' using errcode = '22023';
  end if;

  update public.tasks
  set status = p_new_status,
      blocked_reason = case when p_new_status = 'BLOCKED' then btrim(p_reason) else null end,
      completed_at = case when p_new_status = 'DONE' then statement_timestamp() else null end,
      cancelled_at = case when p_new_status = 'CANCELLED' then statement_timestamp() else null end
  where id = p_task_id
  returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id,
    p_actor_id,
    'STATUS_CHANGED',
    to_jsonb(v_old_status),
    to_jsonb(p_new_status),
    case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end
  );

  v_special_event := case
    when v_old_status = 'ASSIGNED' and p_new_status = 'IN_PROGRESS' then 'TASK_ACCEPTED'
    when p_new_status = 'BLOCKED' then 'TASK_BLOCKED'
    when v_old_status = 'BLOCKED' then 'TASK_UNBLOCKED'
    when p_new_status = 'REVIEW' then 'REVIEW_REQUESTED'
    when p_new_status = 'REVISION' then 'REVISION_REQUESTED'
    when p_new_status = 'DONE' then 'TASK_COMPLETED'
    when p_new_status = 'CANCELLED' then 'TASK_CANCELLED'
    when v_old_status in ('DONE', 'CANCELLED') then 'TASK_REOPENED'
    else null
  end;

  if v_special_event is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_task_id,
      p_actor_id,
      v_special_event,
      to_jsonb(v_old_status),
      to_jsonb(p_new_status),
      case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end
    );
  end if;

  if p_new_status = 'REVISION' then
    insert into public.task_revisions (task_id, requested_by, reason)
    values (p_task_id, p_actor_id, nullif(btrim(p_reason), ''));
  end if;

  return v_task;
end;
$$;

create function public.create_deadline_change_request_with_event(
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
begin
  select * into v_task
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.users where id = p_requested_by and is_active) then
    raise exception 'requester is not active' using errcode = '42501';
  end if;
  if v_task.assignee_id <> p_requested_by then
    raise exception 'only assignee may request deadline change' using errcode = '42501';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task cannot change deadline' using errcode = '40001';
  end if;

  insert into public.deadline_change_requests (
    task_id,
    requested_by,
    current_deadline,
    requested_deadline,
    reason
  ) values (
    p_task_id,
    p_requested_by,
    v_task.deadline,
    p_requested_deadline,
    btrim(p_reason)
  )
  returning * into v_request;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id,
    p_requested_by,
    'DEADLINE_CHANGE_REQUESTED',
    to_jsonb(v_task.deadline),
    to_jsonb(p_requested_deadline),
    jsonb_build_object('requestId', v_request.id, 'reason', v_request.reason)
  );

  return v_request;
end;
$$;

create function public.resolve_deadline_change_request_with_events(
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
  select * into v_request
  from public.deadline_change_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'deadline request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'deadline request is already resolved' using errcode = '40001';
  end if;

  select * into v_task
  from public.tasks
  where id = v_request.task_id
  for update;

  select * into v_resolver
  from public.users
  where id = p_resolved_by and is_active;

  if not found or (v_resolver.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_resolved_by) then
    raise exception 'resolver is not authorized' using errcode = '42501';
  end if;

  update public.deadline_change_requests
  set status = case when p_approve then 'APPROVED' else 'REJECTED' end,
      resolved_by = p_resolved_by,
      resolved_at = statement_timestamp(),
      resolution_note = nullif(btrim(p_resolution_note), '')
  where id = p_request_id and status = 'PENDING'
  returning * into v_request;

  if v_request.id is null then
    raise exception 'deadline request was concurrently resolved' using errcode = '40001';
  end if;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    v_task.id,
    p_resolved_by,
    case when p_approve then 'DEADLINE_CHANGE_APPROVED' else 'DEADLINE_CHANGE_REJECTED' end,
    to_jsonb(v_request.current_deadline),
    to_jsonb(v_request.requested_deadline),
    jsonb_build_object('requestId', v_request.id, 'resolutionNote', v_request.resolution_note)
  );

  if p_approve then
    update public.tasks
    set deadline = v_request.requested_deadline
    where id = v_task.id;

    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      v_task.id,
      p_resolved_by,
      'DEADLINE_CHANGED',
      to_jsonb(v_request.current_deadline),
      to_jsonb(v_request.requested_deadline),
      jsonb_build_object('requestId', v_request.id)
    );
  end if;

  return v_request;
end;
$$;

revoke all on function public.register_telegram_user(bigint, text, text) from public, anon, authenticated;
revoke all on function public.create_task_with_event(uuid, uuid, text, text, text, timestamptz, bigint) from public, anon, authenticated;
revoke all on function public.transition_task_with_events(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_deadline_change_request_with_event(uuid, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.resolve_deadline_change_request_with_events(uuid, uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.register_telegram_user(bigint, text, text) to service_role;
grant execute on function public.create_task_with_event(uuid, uuid, text, text, text, timestamptz, bigint) to service_role;
grant execute on function public.transition_task_with_events(uuid, uuid, text, text) to service_role;
grant execute on function public.create_deadline_change_request_with_event(uuid, uuid, timestamptz, text) to service_role;
grant execute on function public.resolve_deadline_change_request_with_events(uuid, uuid, boolean, text) to service_role;

comment on function public.register_telegram_user(bigint, text, text) is
  'Idempotent onboarding. The first registered user becomes Head; later users remain pending until activated.';
comment on function public.resolve_deadline_change_request_with_events(uuid, uuid, boolean, text) is
  'First-resolution-wins deadline decision with atomic task and event updates.';
