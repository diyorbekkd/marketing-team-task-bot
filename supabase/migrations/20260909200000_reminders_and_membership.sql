-- Deadline reminder scheduling and team-member deactivation/reactivation.

-- ── Team membership ─────────────────────────────────────────────────────────

alter table public.users
  add column deactivated_at timestamptz,
  add column deactivated_by uuid references public.users (id) on delete restrict,
  add constraint users_deactivated_at_matches_state check (
    (is_active and deactivated_at is null and deactivated_by is null)
    or (not is_active)
  );

create table public.user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  actor_id uuid references public.users (id) on delete restrict,
  event_type text not null check (event_type in (
    'USER_ACTIVATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'USER_ROLE_CHANGED'
  )),
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index user_events_user_id_idx on public.user_events (user_id, created_at);

alter table public.recurring_definitions add column pause_reason text;
comment on column public.recurring_definitions.pause_reason is
  'Set when PAUSED was applied automatically (e.g. assignee deactivated) rather than by a Head choice; cleared on resume/stop/manual pause.';

-- Atomic user-state transitions with an audit trail, mirroring the existing
-- transition_task_with_events pattern for tasks.

create function public.activate_user_with_event(
  p_user_id uuid, p_actor_id uuid, p_role text
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_user.is_active then
    raise exception 'user is already active' using errcode = '40001';
  end if;
  if p_role = 'HEAD_OF_MARKETING' then
    raise exception 'head role transfer is outside this flow' using errcode = '22023';
  end if;

  update public.users
  set role = p_role, is_active = true, deactivated_at = null, deactivated_by = null
  where id = p_user_id
  returning * into v_user;

  insert into public.user_events (user_id, actor_id, event_type, new_value)
  values (p_user_id, p_actor_id, 'USER_ACTIVATED', to_jsonb(p_role));

  return v_user;
end;
$$;

create function public.update_user_role_with_event(
  p_user_id uuid, p_actor_id uuid, p_role text
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users;
  v_old_role text;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if not v_user.is_active then
    raise exception 'user is not active' using errcode = '40001';
  end if;
  if v_user.role = 'HEAD_OF_MARKETING' then
    raise exception 'head role cannot change through this flow' using errcode = '42501';
  end if;
  if p_role = 'HEAD_OF_MARKETING' then
    raise exception 'head role transfer is outside this flow' using errcode = '22023';
  end if;
  if v_user.role = p_role then
    return v_user;
  end if;

  v_old_role := v_user.role;

  update public.users set role = p_role where id = p_user_id returning * into v_user;

  insert into public.user_events (user_id, actor_id, event_type, old_value, new_value)
  values (p_user_id, p_actor_id, 'USER_ROLE_CHANGED', to_jsonb(v_old_role), to_jsonb(p_role));

  return v_user;
end;
$$;

create function public.deactivate_user_with_event(
  p_user_id uuid, p_actor_id uuid
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users;
begin
  if p_user_id = p_actor_id then
    raise exception 'cannot deactivate yourself' using errcode = '42501';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if not v_user.is_active then
    raise exception 'user is already inactive' using errcode = '40001';
  end if;
  if v_user.role = 'HEAD_OF_MARKETING' then
    raise exception 'head cannot be deactivated through this flow' using errcode = '42501';
  end if;

  update public.users
  set is_active = false, deactivated_at = statement_timestamp(), deactivated_by = p_actor_id
  where id = p_user_id
  returning * into v_user;

  insert into public.user_events (user_id, actor_id, event_type, old_value, new_value)
  values (p_user_id, p_actor_id, 'USER_DEACTIVATED', to_jsonb(true), to_jsonb(false));

  return v_user;
end;
$$;

create function public.reactivate_user_with_event(
  p_user_id uuid, p_actor_id uuid
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users;
begin
  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if v_user.is_active then
    raise exception 'user is already active' using errcode = '40001';
  end if;
  if v_user.deactivated_at is null then
    raise exception 'user was never an active member; use activation instead' using errcode = '22023';
  end if;

  update public.users
  set is_active = true, deactivated_at = null, deactivated_by = null
  where id = p_user_id
  returning * into v_user;

  insert into public.user_events (user_id, actor_id, event_type, old_value, new_value)
  values (p_user_id, p_actor_id, 'USER_REACTIVATED', to_jsonb(false), to_jsonb(true));

  return v_user;
end;
$$;

create function public.reassign_task_with_event(
  p_task_id uuid, p_new_assignee_id uuid, p_actor_id uuid
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_old_assignee uuid;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'a terminal task cannot be reassigned' using errcode = '40001';
  end if;
  if not exists (select 1 from public.users where id = p_new_assignee_id and is_active) then
    raise exception 'new assignee must be an active team member' using errcode = '22023';
  end if;
  if v_task.assignee_id = p_new_assignee_id then
    return v_task;
  end if;

  v_old_assignee := v_task.assignee_id;

  update public.tasks set assignee_id = p_new_assignee_id where id = p_task_id returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
  values (p_task_id, p_actor_id, 'ASSIGNEE_CHANGED', to_jsonb(v_old_assignee), to_jsonb(p_new_assignee_id));

  return v_task;
end;
$$;

-- ── Deadline reminders ───────────────────────────────────────────────────────

create table public.task_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  deadline timestamptz not null,
  reminder_type text not null check (reminder_type in (
    'H24_BEFORE', 'H3_BEFORE', 'AT_DEADLINE', 'H1_OVERDUE', 'H24_OVERDUE'
  )),
  status text not null default 'CLAIMED' check (status in ('CLAIMED', 'SENT', 'FAILED')),
  failure_reason text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (task_id, deadline, reminder_type)
);

comment on table public.task_reminder_deliveries is
  'Idempotency ledger for deadline reminders, keyed by (task, deadline, reminder_type) so a deadline change starts a fresh reminder cycle without resending for the old deadline.';

alter table public.user_events enable row level security;
alter table public.task_reminder_deliveries enable row level security;

revoke all on table public.user_events from public, anon, authenticated;
revoke all on table public.task_reminder_deliveries from public, anon, authenticated;
grant select, insert on table public.user_events to service_role;
grant select, insert, update on table public.task_reminder_deliveries to service_role;

revoke all on function public.activate_user_with_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.update_user_role_with_event(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.deactivate_user_with_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reactivate_user_with_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reassign_task_with_event(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_user_with_event(uuid, uuid, text) to service_role;
grant execute on function public.update_user_role_with_event(uuid, uuid, text) to service_role;
grant execute on function public.deactivate_user_with_event(uuid, uuid) to service_role;
grant execute on function public.reactivate_user_with_event(uuid, uuid) to service_role;
grant execute on function public.reassign_task_with_event(uuid, uuid, uuid) to service_role;
