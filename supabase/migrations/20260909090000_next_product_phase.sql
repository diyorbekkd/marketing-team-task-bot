-- Daily/weekly reports, persistent #posting checklists, and recurring tasks.
-- Asia/Tashkent schedule calculations live in the application; timestamps stay UTC.

create table public.recurring_definitions (
  id uuid primary key default gen_random_uuid(),
  source_task_id uuid not null unique references public.tasks (id) on delete restrict,
  created_by uuid not null references public.users (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  priority text not null check (priority in ('high', 'normal', 'low')),
  assignee_id uuid not null references public.users (id) on delete restrict,
  frequency text not null check (frequency in ('WEEKDAYS', 'WEEKLY', 'MONTHLY')),
  weekday smallint check (weekday between 1 and 7),
  day_of_month smallint check (day_of_month between 1 and 31),
  local_time time not null,
  timezone text not null default 'Asia/Tashkent' check (timezone = 'Asia/Tashkent'),
  ends_on date,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'PAUSED', 'STOPPED')),
  next_occurrence_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (frequency = 'WEEKDAYS' and weekday is null and day_of_month is null)
    or (frequency = 'WEEKLY' and weekday is not null and day_of_month is null)
    or (frequency = 'MONTHLY' and weekday is null and day_of_month is not null)
  )
);

alter table public.tasks
  add column recurring_definition_id uuid references public.recurring_definitions (id) on delete restrict,
  add column scheduled_occurrence_at timestamptz;

create unique index tasks_recurring_occurrence_unique_idx
  on public.tasks (recurring_definition_id, scheduled_occurrence_at)
  where recurring_definition_id is not null and scheduled_occurrence_at is not null;

create index recurring_definitions_due_idx
  on public.recurring_definitions (next_occurrence_at)
  where status = 'ACTIVE';

create table public.task_checklists (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks (id) on delete restrict,
  kind text not null check (kind = 'POSTING'),
  created_at timestamptz not null default now()
);

create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.task_checklists (id) on delete restrict,
  label text not null check (label in ('Telegram', 'Instagram', 'YouTube', 'X / Twitter')),
  position smallint not null check (position between 0 and 3),
  is_completed boolean not null default false,
  completed_by uuid references public.users (id) on delete restrict,
  completed_at timestamptz,
  unique (checklist_id, position),
  check ((is_completed and completed_by is not null and completed_at is not null)
    or (not is_completed and completed_by is null and completed_at is null))
);

create table public.report_deliveries (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('DAILY_MORNING', 'DAILY_EVENING', 'WEEKLY')),
  interval_key text not null check (char_length(interval_key) between 1 and 40),
  recipient_user_id uuid not null references public.users (id) on delete restrict,
  status text not null default 'CLAIMED' check (status in ('CLAIMED', 'SENT', 'FAILED', 'SKIPPED')),
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (report_type, interval_key, recipient_user_id)
);

alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (
  event_type in (
    'TASK_CREATED', 'TASK_ACCEPTED', 'STATUS_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED',
    'PRIORITY_CHANGED', 'DEADLINE_CHANGE_REQUESTED', 'DEADLINE_CHANGE_APPROVED',
    'DEADLINE_CHANGE_REJECTED', 'DEADLINE_CHANGED', 'REASSIGN_REQUESTED', 'REASSIGN_APPROVED',
    'REASSIGN_REJECTED', 'ASSIGNEE_CHANGED', 'TASK_BLOCKED', 'TASK_UNBLOCKED',
    'REVIEW_REQUESTED', 'REVISION_REQUESTED', 'TASK_COMPLETED', 'TASK_CANCELLED',
    'TASK_REOPENED', 'POSTING_CHECKLIST_CREATED', 'POSTING_CHECKLIST_ITEM_TOGGLED',
    'RECURRING_TASK_GENERATED'
  )
);

create trigger recurring_definitions_set_updated_at
before update on public.recurring_definitions
for each row execute function private.set_updated_at();

create function private.attach_posting_checklist(p_task_id uuid, p_created_at timestamptz default statement_timestamp())
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_checklist_id uuid;
begin
  insert into public.task_checklists (task_id, kind, created_at)
  values (p_task_id, 'POSTING', p_created_at)
  on conflict (task_id) do update set task_id = excluded.task_id
  returning id into v_checklist_id;

  insert into public.task_checklist_items (checklist_id, label, position)
  values
    (v_checklist_id, 'Telegram', 0),
    (v_checklist_id, 'Instagram', 1),
    (v_checklist_id, 'YouTube', 2),
    (v_checklist_id, 'X / Twitter', 3)
  on conflict (checklist_id, position) do nothing;

  return v_checklist_id;
end;
$$;

create function public.create_task_with_event_v2(
  p_creator_id uuid,
  p_assignee_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_deadline timestamptz,
  p_source_telegram_update_id bigint default null,
  p_recurring_definition_id uuid default null,
  p_scheduled_occurrence_at timestamptz default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_is_new boolean := true;
  v_is_posting boolean;
begin
  if not exists (select 1 from public.users where id = p_creator_id and is_active) then
    raise exception 'creator is not active' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_assignee_id and is_active) then
    raise exception 'assignee is not active' using errcode = '22023';
  end if;
  if (p_recurring_definition_id is null) <> (p_scheduled_occurrence_at is null) then
    raise exception 'recurring occurrence identity is incomplete' using errcode = '22023';
  end if;

  insert into public.tasks (
    title, description, priority, creator_id, assignee_id, deadline,
    source_telegram_update_id, recurring_definition_id, scheduled_occurrence_at
  ) values (
    btrim(p_title), nullif(btrim(p_description), ''), p_priority, p_creator_id, p_assignee_id,
    p_deadline, p_source_telegram_update_id, p_recurring_definition_id, p_scheduled_occurrence_at
  )
  on conflict do nothing
  returning * into v_task;

  if v_task.id is null then
    v_is_new := false;
    if p_source_telegram_update_id is not null then
      select * into v_task from public.tasks where source_telegram_update_id = p_source_telegram_update_id;
    elsif p_recurring_definition_id is not null then
      select * into v_task from public.tasks
      where recurring_definition_id = p_recurring_definition_id
        and scheduled_occurrence_at = p_scheduled_occurrence_at;
    end if;
  end if;
  if v_task.id is null then
    raise exception 'task conflict could not be resolved' using errcode = '40001';
  end if;
  if not v_is_new then return v_task; end if;

  insert into public.task_events (task_id, actor_id, actor_kind, event_type, new_value, metadata)
  values (
    v_task.id,
    case when p_recurring_definition_id is null then p_creator_id else null end,
    case when p_recurring_definition_id is null then 'USER' else 'SYSTEM' end,
    'TASK_CREATED',
    jsonb_build_object('title', v_task.title, 'assigneeId', v_task.assignee_id,
      'priority', v_task.priority, 'deadline', v_task.deadline),
    jsonb_strip_nulls(jsonb_build_object('telegramUpdateId', p_source_telegram_update_id,
      'recurringDefinitionId', p_recurring_definition_id,
      'scheduledOccurrenceAt', p_scheduled_occurrence_at))
  );

  if p_recurring_definition_id is not null then
    insert into public.task_events (task_id, actor_kind, event_type, new_value, metadata)
    values (v_task.id, 'SYSTEM', 'RECURRING_TASK_GENERATED', to_jsonb(p_scheduled_occurrence_at),
      jsonb_build_object('recurringDefinitionId', p_recurring_definition_id));
  end if;

  v_is_posting := (v_task.title || E'\n' || coalesce(v_task.description, ''))
    ~* '(^|[^[:alnum:]_])#posting([^[:alnum:]_]|$)';
  if v_is_posting then
    perform private.attach_posting_checklist(v_task.id);
    insert into public.task_events (task_id, actor_id, actor_kind, event_type, new_value, metadata)
    values (v_task.id,
      case when p_recurring_definition_id is null then p_creator_id else null end,
      case when p_recurring_definition_id is null then 'USER' else 'SYSTEM' end,
      'POSTING_CHECKLIST_CREATED', to_jsonb('POSTING'::text), '{}'::jsonb);
  end if;

  return v_task;
end;
$$;

-- Enforce checklist completion in the same transaction as REVIEW transition.
create or replace function public.transition_task_with_events(
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
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  v_old_status := v_task.status;
  if v_old_status = p_new_status then return v_task; end if;
  if not (
    (v_old_status = 'ASSIGNED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'IN_PROGRESS' and p_new_status in ('BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status = 'BLOCKED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'REVIEW' and p_new_status in ('DONE', 'REVISION', 'CANCELLED'))
    or (v_old_status = 'REVISION' and p_new_status in ('IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED')
  ) then raise exception 'task status changed concurrently' using errcode = '40001'; end if;
  if p_new_status = 'BLOCKED' and nullif(btrim(p_reason), '') is null then
    raise exception 'blocked reason is required' using errcode = '22023';
  end if;
  if p_new_status = 'REVIEW' and exists (
    select 1 from public.task_checklists c
    join public.task_checklist_items i on i.checklist_id = c.id
    where c.task_id = p_task_id and not i.is_completed
  ) then raise exception 'posting checklist is incomplete' using errcode = '23514'; end if;

  update public.tasks set
    status = p_new_status,
    blocked_reason = case when p_new_status = 'BLOCKED' then btrim(p_reason) else null end,
    completed_at = case when p_new_status = 'DONE' then statement_timestamp() else null end,
    cancelled_at = case when p_new_status = 'CANCELLED' then statement_timestamp() else null end
  where id = p_task_id returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (p_task_id, p_actor_id, 'STATUS_CHANGED', to_jsonb(v_old_status), to_jsonb(p_new_status),
    case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);
  v_special_event := case
    when v_old_status = 'ASSIGNED' and p_new_status = 'IN_PROGRESS' then 'TASK_ACCEPTED'
    when p_new_status = 'BLOCKED' then 'TASK_BLOCKED'
    when v_old_status = 'BLOCKED' then 'TASK_UNBLOCKED'
    when p_new_status = 'REVIEW' then 'REVIEW_REQUESTED'
    when p_new_status = 'REVISION' then 'REVISION_REQUESTED'
    when p_new_status = 'DONE' then 'TASK_COMPLETED'
    when p_new_status = 'CANCELLED' then 'TASK_CANCELLED'
    when v_old_status in ('DONE', 'CANCELLED') then 'TASK_REOPENED'
    else null end;
  if v_special_event is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (p_task_id, p_actor_id, v_special_event, to_jsonb(v_old_status), to_jsonb(p_new_status),
      case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end);
  end if;
  if p_new_status = 'REVISION' then
    insert into public.task_revisions (task_id, requested_by, reason)
    values (p_task_id, p_actor_id, nullif(btrim(p_reason), ''));
  end if;
  return v_task;
end;
$$;

create function public.toggle_posting_checklist_item(p_item_id uuid, p_actor_id uuid)
returns public.task_checklist_items
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item public.task_checklist_items;
  v_task public.tasks;
begin
  select t.* into v_task from public.tasks t
  join public.task_checklists c on c.task_id = t.id
  join public.task_checklist_items i on i.checklist_id = c.id
  where i.id = p_item_id for update of t;
  if not found then raise exception 'checklist item not found' using errcode = 'P0002'; end if;
  if v_task.assignee_id <> p_actor_id or not exists (
    select 1 from public.users where id = p_actor_id and is_active
  ) then raise exception 'only active assignee may update checklist' using errcode = '42501'; end if;
  if v_task.status not in ('IN_PROGRESS', 'REVISION') then
    raise exception 'checklist cannot be changed in this status' using errcode = '40001';
  end if;
  update public.task_checklist_items set
    is_completed = not is_completed,
    completed_by = case when not is_completed then p_actor_id else null end,
    completed_at = case when not is_completed then statement_timestamp() else null end
  where id = p_item_id returning * into v_item;
  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (v_task.id, p_actor_id, 'POSTING_CHECKLIST_ITEM_TOGGLED', to_jsonb(not v_item.is_completed),
    to_jsonb(v_item.is_completed), jsonb_build_object('itemId', v_item.id, 'label', v_item.label));
  return v_item;
end;
$$;

create function public.generate_recurring_task(
  p_definition_id uuid,
  p_scheduled_occurrence_at timestamptz,
  p_next_occurrence_at timestamptz
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_definition public.recurring_definitions;
  v_task public.tasks;
begin
  select * into v_definition from public.recurring_definitions
  where id = p_definition_id for update;
  if not found then raise exception 'recurring definition not found' using errcode = 'P0002'; end if;
  if v_definition.status <> 'ACTIVE'
    or v_definition.next_occurrence_at is distinct from p_scheduled_occurrence_at then
    return null;
  end if;

  select * into v_task from public.create_task_with_event_v2(
    v_definition.created_by, v_definition.assignee_id, v_definition.title,
    coalesce(v_definition.description, ''), v_definition.priority,
    p_scheduled_occurrence_at, null, v_definition.id, p_scheduled_occurrence_at
  );
  update public.recurring_definitions set next_occurrence_at = p_next_occurrence_at
  where id = p_definition_id;
  return v_task;
end;
$$;

-- Attach persistent checklists to pre-existing tagged tasks. Removing #posting
-- later never deletes a checklist once attached.
do $$
declare v_task record;
begin
  for v_task in select id from public.tasks
    where (title || E'\n' || coalesce(description, '')) ~* '(^|[^[:alnum:]_])#posting([^[:alnum:]_]|$)'
  loop
    perform private.attach_posting_checklist(v_task.id);
    insert into public.task_events (task_id, actor_kind, event_type, new_value, metadata)
    values (v_task.id, 'SYSTEM', 'POSTING_CHECKLIST_CREATED', to_jsonb('POSTING'::text),
      jsonb_build_object('backfilled', true));
  end loop;
end $$;

alter table public.recurring_definitions enable row level security;
alter table public.task_checklists enable row level security;
alter table public.task_checklist_items enable row level security;
alter table public.report_deliveries enable row level security;

revoke all on table public.recurring_definitions from public, anon, authenticated;
revoke all on table public.task_checklists from public, anon, authenticated;
revoke all on table public.task_checklist_items from public, anon, authenticated;
revoke all on table public.report_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.recurring_definitions to service_role;
grant select, insert on table public.task_checklists to service_role;
grant select, insert, update on table public.task_checklist_items to service_role;
grant select, insert, update on table public.report_deliveries to service_role;

revoke all on function public.create_task_with_event_v2(uuid, uuid, text, text, text, timestamptz, bigint, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.toggle_posting_checklist_item(uuid, uuid) from public, anon, authenticated;
revoke all on function public.generate_recurring_task(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.create_task_with_event_v2(uuid, uuid, text, text, text, timestamptz, bigint, uuid, timestamptz) to service_role;
grant execute on function public.toggle_posting_checklist_item(uuid, uuid) to service_role;
grant execute on function public.generate_recurring_task(uuid, timestamptz, timestamptz) to service_role;
grant usage on schema private to service_role;
grant execute on function private.attach_posting_checklist(uuid, timestamptz) to service_role;

comment on table public.report_deliveries is 'Idempotency ledger for scheduled report delivery.';
comment on column public.recurring_definitions.day_of_month is 'If absent in a shorter month, the occurrence uses that month''s final day.';
comment on table public.task_checklists is 'Persistent workflow classification: removing #posting later does not remove an attached checklist.';
