-- Optional personal day planning and shared task checkpoints.
-- The browser never accesses these tables directly.

create table public.user_task_plans (
  user_id uuid not null references public.users (id) on delete restrict,
  task_id uuid not null references public.tasks (id) on delete restrict,
  is_important boolean,
  urgent_override boolean,
  planned_on date,
  estimated_minutes integer check (estimated_minutes between 5 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

create index user_task_plans_day_idx on public.user_task_plans (user_id, planned_on)
  where planned_on is not null;
create trigger user_task_plans_set_updated_at before update on public.user_task_plans
  for each row execute function private.set_updated_at();

create table public.task_checkpoints (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  due_at timestamptz,
  position integer not null check (position between 1 and 50),
  created_by uuid not null references public.users (id) on delete restrict,
  completed_by uuid references public.users (id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (task_id, position),
  check ((completed_by is null) = (completed_at is null))
);

create index task_checkpoints_task_position_idx on public.task_checkpoints (task_id, position);

alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (
  event_type in (
    'TASK_CREATED', 'TASK_ACCEPTED', 'STATUS_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED',
    'PRIORITY_CHANGED', 'DEADLINE_CHANGE_REQUESTED', 'DEADLINE_CHANGE_APPROVED',
    'DEADLINE_CHANGE_REJECTED', 'DEADLINE_CHANGED', 'REASSIGN_REQUESTED', 'REASSIGN_APPROVED',
    'REASSIGN_REJECTED', 'ASSIGNEE_CHANGED', 'TASK_BLOCKED', 'TASK_UNBLOCKED',
    'REVIEW_REQUESTED', 'REVISION_REQUESTED', 'TASK_COMPLETED', 'TASK_CANCELLED',
    'TASK_REOPENED', 'POSTING_CHECKLIST_CREATED', 'POSTING_CHECKLIST_ITEM_TOGGLED',
    'RECURRING_TASK_GENERATED', 'PUBLICATION_DATE_CHANGED', 'COMMENT_ADDED', 'RESULT_SUBMITTED',
    'WORKFLOW_STARTED', 'WORKFLOW_STEP_ACTIVATED', 'WORKFLOW_COMPLETED',
    'CHECKPOINT_ADDED', 'CHECKPOINT_COMPLETED', 'CHECKPOINT_REOPENED', 'CHECKPOINT_REMOVED'
  )
);

create function public.add_task_checkpoint_with_event(
  p_task_id uuid, p_actor_id uuid, p_title text, p_due_at timestamptz default null
) returns public.task_checkpoints
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_checkpoint public.task_checkpoints;
  v_position integer;
begin
  select * into v_actor from public.users where id = p_actor_id and is_active;
  select * into v_task from public.tasks where id = p_task_id for update;
  if v_actor.id is null or v_task.id is null or
     (v_actor.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_actor_id and v_task.assignee_id <> p_actor_id) then
    raise exception 'checkpoint actor is not authorized' using errcode = '42501';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task cannot add checkpoints' using errcode = '40001';
  end if;
  select coalesce(max(position), 0) + 1 into v_position from public.task_checkpoints where task_id = p_task_id;
  if v_position > 50 then raise exception 'checkpoint limit reached' using errcode = '22023'; end if;
  insert into public.task_checkpoints (task_id, title, due_at, position, created_by)
  values (p_task_id, btrim(p_title), p_due_at, v_position, p_actor_id)
  returning * into v_checkpoint;
  insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
  values (p_task_id, p_actor_id, 'CHECKPOINT_ADDED',
    jsonb_build_object('title', v_checkpoint.title, 'dueAt', v_checkpoint.due_at),
    jsonb_build_object('checkpointId', v_checkpoint.id));
  return v_checkpoint;
end;
$$;

create function public.toggle_task_checkpoint_with_event(p_checkpoint_id uuid, p_actor_id uuid)
returns public.task_checkpoints
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_checkpoint public.task_checkpoints;
  v_old_completed boolean;
begin
  select * into v_actor from public.users where id = p_actor_id and is_active;
  select t.* into v_task from public.tasks t join public.task_checkpoints c on c.task_id = t.id
    where c.id = p_checkpoint_id for update of t;
  if v_actor.id is null or v_task.id is null or
     (v_actor.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_actor_id and v_task.assignee_id <> p_actor_id) then
    raise exception 'checkpoint actor is not authorized' using errcode = '42501';
  end if;
  select * into v_checkpoint from public.task_checkpoints where id = p_checkpoint_id for update;
  if v_checkpoint.id is null then raise exception 'checkpoint not found' using errcode = 'P0002'; end if;
  v_old_completed := v_checkpoint.completed_at is not null;
  update public.task_checkpoints set
    completed_by = case when v_old_completed then null else p_actor_id end,
    completed_at = case when v_old_completed then null else statement_timestamp() end
    where id = p_checkpoint_id returning * into v_checkpoint;
  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (v_task.id, p_actor_id,
    case when v_old_completed then 'CHECKPOINT_REOPENED' else 'CHECKPOINT_COMPLETED' end,
    to_jsonb(v_old_completed), to_jsonb(not v_old_completed),
    jsonb_build_object('checkpointId', p_checkpoint_id, 'title', v_checkpoint.title));
  return v_checkpoint;
end;
$$;

create function public.remove_task_checkpoint_with_event(p_checkpoint_id uuid, p_actor_id uuid)
returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_checkpoint public.task_checkpoints;
begin
  select * into v_actor from public.users where id = p_actor_id and is_active;
  select t.* into v_task from public.tasks t join public.task_checkpoints c on c.task_id = t.id
    where c.id = p_checkpoint_id for update of t;
  if v_actor.id is null or v_task.id is null or
     (v_actor.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_actor_id and v_task.assignee_id <> p_actor_id) then
    raise exception 'checkpoint actor is not authorized' using errcode = '42501';
  end if;
  select * into v_checkpoint from public.task_checkpoints where id = p_checkpoint_id for update;
  if v_checkpoint.id is null then raise exception 'checkpoint not found' using errcode = 'P0002'; end if;
  delete from public.task_checkpoints where id = p_checkpoint_id;
  insert into public.task_events (task_id, actor_id, event_type, old_value, metadata)
  values (v_task.id, p_actor_id, 'CHECKPOINT_REMOVED',
    jsonb_build_object('title', v_checkpoint.title, 'dueAt', v_checkpoint.due_at),
    jsonb_build_object('checkpointId', v_checkpoint.id));
end;
$$;

alter table public.user_task_plans enable row level security;
alter table public.task_checkpoints enable row level security;
revoke all on table public.user_task_plans, public.task_checkpoints from public, anon, authenticated;
grant select, insert, update, delete on table public.user_task_plans, public.task_checkpoints to service_role;
revoke all on function public.add_task_checkpoint_with_event(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.toggle_task_checkpoint_with_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.remove_task_checkpoint_with_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.add_task_checkpoint_with_event(uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.toggle_task_checkpoint_with_event(uuid, uuid) to service_role;
grant execute on function public.remove_task_checkpoint_with_event(uuid, uuid) to service_role;
