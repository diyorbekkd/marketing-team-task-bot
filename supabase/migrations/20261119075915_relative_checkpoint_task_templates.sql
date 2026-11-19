-- One-task templates with dated checkpoints. Existing workflow templates remain separate.
create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  replaces_id uuid references public.task_templates(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  deadline_offset_days integer not null check (deadline_offset_days between -365 and 365),
  deadline_local_time time not null default '18:00',
  checkpoints jsonb not null check (jsonb_typeof(checkpoints) = 'array' and jsonb_array_length(checkpoints) between 1 and 50),
  is_active boolean not null default true,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index task_templates_active_idx on public.task_templates(name) where is_active;

create table public.task_template_instances (
  task_id uuid primary key references public.tasks(id) on delete restrict,
  template_id uuid not null references public.task_templates(id) on delete restrict,
  event_on date not null,
  deadline_is_auto boolean not null,
  created_at timestamptz not null default now()
);
alter table public.task_checkpoints
  add column template_offset_days integer check (template_offset_days between -365 and 365),
  add column template_local_time time,
  add column due_is_manual boolean not null default false;
alter table public.task_checkpoints add constraint template_checkpoint_schedule_pair
  check ((template_offset_days is null) = (template_local_time is null));

create function public.save_task_template_version(
  p_actor_id uuid, p_source_template_id uuid, p_name text,
  p_deadline_offset_days integer, p_deadline_local_time time, p_checkpoints jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
  v_item jsonb;
  v_source public.task_templates;
begin
  if not exists(select 1 from public.users where id = p_actor_id and is_active and role = 'HEAD_OF_MARKETING') then
    raise exception 'only Head can edit task templates' using errcode = '42501';
  end if;
  if char_length(btrim(p_name)) not between 1 and 120 or p_deadline_offset_days not between -365 and 365
     or p_deadline_local_time is null or jsonb_typeof(p_checkpoints) is distinct from 'array'
     or jsonb_array_length(p_checkpoints) not between 1 and 50 then
    raise exception 'invalid task template' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_checkpoints) loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or char_length(btrim(coalesce(v_item->>'title', ''))) not between 1 and 200
       or (v_item - array['title', 'offsetDays', 'localTime']) <> '{}'::jsonb
       or coalesce(v_item->>'offsetDays', '') !~ '^-?[0-9]{1,3}$'
       or (v_item->>'offsetDays')::integer not between -365 and 365
       or coalesce(v_item->>'localTime', '18:00') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'invalid template checkpoint' using errcode = '22023';
    end if;
  end loop;
  if p_source_template_id is not null then
    select * into v_source from public.task_templates where id = p_source_template_id and is_active for update;
    if v_source.id is null then raise exception 'active template not found' using errcode = 'P0002'; end if;
    update public.task_templates set is_active = false where id = p_source_template_id;
  end if;
  insert into public.task_templates(replaces_id, name, deadline_offset_days, deadline_local_time, checkpoints, created_by)
    values (p_source_template_id, btrim(p_name), p_deadline_offset_days, p_deadline_local_time, p_checkpoints, p_actor_id)
    returning id into v_id;
  return v_id;
end;
$$;

create function public.archive_task_template(p_actor_id uuid, p_template_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.users where id = p_actor_id and is_active and role = 'HEAD_OF_MARKETING') then
    raise exception 'only Head can archive task templates' using errcode = '42501';
  end if;
  update public.task_templates set is_active = false where id = p_template_id and is_active;
  return found;
end;
$$;

create function public.create_task_from_template(
  p_creator_id uuid, p_assignee_id uuid, p_template_id uuid, p_event_on date,
  p_title text, p_description text, p_priority text, p_deadline_override timestamptz default null
) returns public.tasks language plpgsql security invoker set search_path = '' as $$
declare
  v_template public.task_templates;
  v_task public.tasks;
  v_due timestamptz;
  v_item jsonb;
  v_position integer := 0;
  v_local_time time;
begin
  select * into v_template from public.task_templates where id = p_template_id and is_active;
  if v_template.id is null then raise exception 'active template not found' using errcode = 'P0002'; end if;
  if p_event_on is null then raise exception 'event date required' using errcode = '22023'; end if;
  v_due := coalesce(p_deadline_override,
    ((p_event_on + v_template.deadline_offset_days)::timestamp + v_template.deadline_local_time) at time zone 'Asia/Tashkent');
  if v_due <= statement_timestamp() then raise exception 'deadline must be future' using errcode = '22023'; end if;
  select * into v_task from public.create_task_with_event_v2(
    p_creator_id, p_assignee_id, p_title, p_description, p_priority, v_due,
    null::bigint, null::uuid, null::timestamptz);
  insert into public.task_template_instances(task_id, template_id, event_on, deadline_is_auto)
    values (v_task.id, v_template.id, p_event_on, p_deadline_override is null);
  for v_item in select value from jsonb_array_elements(v_template.checkpoints) loop
    v_position := v_position + 1;
    v_local_time := coalesce(v_item->>'localTime', '18:00')::time;
    insert into public.task_checkpoints(task_id, title, due_at, position, created_by,
      template_offset_days, template_local_time)
    values (v_task.id, v_item->>'title',
      ((p_event_on + (v_item->>'offsetDays')::integer)::timestamp + v_local_time) at time zone 'Asia/Tashkent',
      v_position, p_creator_id, (v_item->>'offsetDays')::integer, v_local_time);
  end loop;
  insert into public.task_events(task_id, actor_id, event_type, new_value, metadata)
    values(v_task.id, p_creator_id, 'TASK_TEMPLATE_APPLIED',
      jsonb_build_object('templateId', v_template.id, 'eventOn', p_event_on), '{}'::jsonb);
  return v_task;
end;
$$;

create function public.rebase_task_template_event(
  p_task_id uuid, p_actor_id uuid, p_event_on date
) returns public.task_template_instances language plpgsql security invoker set search_path = '' as $$
declare
  v_instance public.task_template_instances;
  v_task public.tasks;
  v_template public.task_templates;
  v_checkpoint public.task_checkpoints;
  v_due timestamptz;
  v_old_event date;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  select * into v_instance from public.task_template_instances where task_id = p_task_id for update;
  if v_task.id is null or v_instance.task_id is null then raise exception 'template task not found' using errcode = 'P0002'; end if;
  if not exists(select 1 from public.users where id = p_actor_id and is_active and
    (role = 'HEAD_OF_MARKETING' or id = v_task.creator_id)) then
    raise exception 'event date actor is not authorized' using errcode = '42501';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') or p_event_on is null then
    raise exception 'event date cannot be changed' using errcode = '22023';
  end if;
  select * into v_template from public.task_templates where id = v_instance.template_id;
  v_old_event := v_instance.event_on;
  if v_instance.deadline_is_auto then
    v_due := ((p_event_on + v_template.deadline_offset_days)::timestamp + v_template.deadline_local_time) at time zone 'Asia/Tashkent';
    if v_due <= statement_timestamp() then raise exception 'deadline must be future' using errcode = '22023'; end if;
    if v_task.deadline is distinct from v_due then
      update public.tasks set deadline = v_due where id = p_task_id;
      update public.task_template_instances set deadline_is_auto = true where task_id = p_task_id;
      insert into public.task_events(task_id, actor_id, event_type, old_value, new_value, metadata)
        values(p_task_id, p_actor_id, 'DEADLINE_CHANGED', to_jsonb(v_task.deadline), to_jsonb(v_due),
          jsonb_build_object('reason', 'template_event_rebased'));
    end if;
  end if;
  for v_checkpoint in select * from public.task_checkpoints where task_id = p_task_id
    and template_offset_days is not null and not due_is_manual and completed_at is null for update loop
    v_due := ((p_event_on + v_checkpoint.template_offset_days)::timestamp + v_checkpoint.template_local_time) at time zone 'Asia/Tashkent';
    if v_due is distinct from v_checkpoint.due_at then
      update public.task_checkpoints set due_at = v_due where id = v_checkpoint.id;
      insert into public.task_events(task_id, actor_id, event_type, old_value, new_value, metadata)
        values(p_task_id, p_actor_id, 'CHECKPOINT_DUE_CHANGED', to_jsonb(v_checkpoint.due_at), to_jsonb(v_due),
          jsonb_build_object('checkpointId', v_checkpoint.id));
    end if;
  end loop;
  update public.task_template_instances set event_on = p_event_on where task_id = p_task_id returning * into v_instance;
  insert into public.task_events(task_id, actor_id, event_type, old_value, new_value, metadata)
    values(p_task_id, p_actor_id, 'TASK_TEMPLATE_EVENT_CHANGED', to_jsonb(v_old_event), to_jsonb(p_event_on), '{}'::jsonb);
  return v_instance;
end;
$$;

create function public.set_task_checkpoint_due(p_checkpoint_id uuid, p_actor_id uuid, p_due_at timestamptz)
returns public.task_checkpoints language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_checkpoint public.task_checkpoints;
  v_old_due timestamptz;
begin
  select t.* into v_task from public.tasks t join public.task_checkpoints c on c.task_id = t.id
    where c.id = p_checkpoint_id for update of t;
  if v_task.id is null then raise exception 'checkpoint not found' using errcode = 'P0002'; end if;
  if not exists(select 1 from public.users where id = p_actor_id and is_active and
    (role = 'HEAD_OF_MARKETING' or id = v_task.creator_id or id = v_task.assignee_id)) then
    raise exception 'checkpoint actor is not authorized' using errcode = '42501';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then raise exception 'terminal task cannot change checkpoints' using errcode = '22023'; end if;
  select due_at into v_old_due from public.task_checkpoints where id = p_checkpoint_id;
  update public.task_checkpoints set due_at = p_due_at, due_is_manual = true
    where id = p_checkpoint_id returning * into v_checkpoint;
  insert into public.task_events(task_id, actor_id, event_type, old_value, new_value, metadata)
    values(v_task.id, p_actor_id, 'CHECKPOINT_DUE_CHANGED', to_jsonb(v_old_due), to_jsonb(p_due_at),
      jsonb_build_object('checkpointId', p_checkpoint_id));
  return v_checkpoint;
end;
$$;

create function private.mark_template_deadline_override() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.task_template_instances set deadline_is_auto = false where task_id = new.id;
  return new;
end;
$$;
create trigger task_template_manual_deadline before update of deadline on public.tasks
  for each row when (old.deadline is distinct from new.deadline)
  execute function private.mark_template_deadline_override();

alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (event_type in (
  'TASK_CREATED', 'TASK_ACCEPTED', 'STATUS_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED',
  'PRIORITY_CHANGED', 'DEADLINE_CHANGE_REQUESTED', 'DEADLINE_CHANGE_APPROVED',
  'DEADLINE_CHANGE_REJECTED', 'DEADLINE_CHANGED', 'REASSIGN_REQUESTED', 'REASSIGN_APPROVED',
  'REASSIGN_REJECTED', 'ASSIGNEE_CHANGED', 'TASK_BLOCKED', 'TASK_UNBLOCKED',
  'REVIEW_REQUESTED', 'REVISION_REQUESTED', 'TASK_COMPLETED', 'TASK_CANCELLED',
  'TASK_REOPENED', 'POSTING_CHECKLIST_CREATED', 'POSTING_CHECKLIST_ITEM_TOGGLED',
  'RECURRING_TASK_GENERATED', 'PUBLICATION_DATE_CHANGED', 'COMMENT_ADDED', 'RESULT_SUBMITTED',
  'WORKFLOW_STARTED', 'WORKFLOW_STEP_ACTIVATED', 'WORKFLOW_COMPLETED',
  'CHECKPOINT_ADDED', 'CHECKPOINT_COMPLETED', 'CHECKPOINT_REOPENED', 'CHECKPOINT_REMOVED',
  'VIDEO_BRIEF_SAVED', 'SHOOT_CONFIRMED',
  'TASK_TEMPLATE_APPLIED', 'TASK_TEMPLATE_EVENT_CHANGED', 'CHECKPOINT_DUE_CHANGED'
));

alter table public.task_templates enable row level security;
alter table public.task_template_instances enable row level security;
revoke all on table public.task_templates, public.task_template_instances from public, anon, authenticated;
grant select, insert, update on table public.task_templates, public.task_template_instances to service_role;
revoke all on function public.save_task_template_version(uuid, uuid, text, integer, time, jsonb) from public, anon, authenticated;
revoke all on function public.archive_task_template(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_task_from_template(uuid, uuid, uuid, date, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.rebase_task_template_event(uuid, uuid, date) from public, anon, authenticated;
revoke all on function public.set_task_checkpoint_due(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.save_task_template_version(uuid, uuid, text, integer, time, jsonb) to service_role;
grant execute on function public.archive_task_template(uuid, uuid) to service_role;
grant execute on function public.create_task_from_template(uuid, uuid, uuid, date, text, text, text, timestamptz) to service_role;
grant execute on function public.rebase_task_template_event(uuid, uuid, date) to service_role;
grant execute on function public.set_task_checkpoint_due(uuid, uuid, timestamptz) to service_role;
