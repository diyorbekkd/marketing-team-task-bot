-- Video production is a small brief attached to an ordinary task. A workflow
-- step declares its kind; future steps still do not become tasks early.
alter table public.workflow_template_steps
  add column video_kind text check (video_kind in ('SHOOT', 'EDIT'));
-- Confirmed bookings appear in task lists and the calendar without a second
-- query per task. Proposed times stay only in the brief until confirmed.
alter table public.tasks add column shoot_at timestamptz;

update public.workflow_template_steps s set video_kind = case
  when t.slug = 'instagram-reels' and s.position = 3 then 'SHOOT'
  when t.slug = 'instagram-reels' and s.position = 4 then 'EDIT'
  when t.slug = 'customer-case-video' and s.position = 2 then 'SHOOT'
  when t.slug = 'customer-case-video' and s.position = 3 then 'EDIT'
  else null end
from public.workflow_templates t
where s.template_id = t.id and t.slug in ('instagram-reels', 'customer-case-video');

create table public.task_video_briefs (
  task_id uuid primary key references public.tasks(id) on delete restrict,
  kind text not null check (kind in ('SHOOT', 'EDIT')),
  scenario_url text check (scenario_url is null or char_length(scenario_url) <= 2048),
  on_camera_person text check (on_camera_person is null or char_length(on_camera_person) between 1 and 200),
  location text check (location is null or char_length(location) between 1 and 300),
  scheduled_at timestamptz,
  duration_minutes integer check (duration_minutes between 5 and 1440),
  confirmed_by uuid references public.users(id) on delete restrict,
  confirmed_at timestamptz,
  footage_url text check (footage_url is null or char_length(footage_url) <= 2048),
  output_spec text check (output_spec is null or char_length(output_spec) between 1 and 300),
  edit_level text check (edit_level in ('SIMPLE', 'STANDARD', 'COMPLEX')),
  updated_at timestamptz not null default now(),
  check ((confirmed_by is null) = (confirmed_at is null)),
  check (kind = 'SHOOT' or (scenario_url is null and on_camera_person is null and location is null
    and scheduled_at is null and duration_minutes is null and confirmed_at is null)),
  check (kind = 'EDIT' or (footage_url is null and output_spec is null and edit_level is null))
);
create index task_video_briefs_shoot_schedule_idx on public.task_video_briefs (scheduled_at)
  where kind = 'SHOOT' and confirmed_at is not null;
alter table public.task_video_briefs enable row level security;
revoke all on public.task_video_briefs from public, anon, authenticated;
grant select, insert, update on public.task_video_briefs to service_role;

-- A newly activated workflow step carries the type, never a guessed title.
create function private.attach_video_brief_for_workflow_task() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_kind text;
begin
  if new.workflow_step_id is not null then
    select video_kind into v_kind from public.workflow_template_steps where id = new.workflow_step_id;
    if v_kind is not null then
      insert into public.task_video_briefs(task_id, kind) values (new.id, v_kind);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.attach_video_brief_for_workflow_task() from public, anon, authenticated;
grant execute on function private.attach_video_brief_for_workflow_task() to service_role;
create trigger attach_video_brief_for_workflow_task after insert on public.tasks
  for each row execute function private.attach_video_brief_for_workflow_task();

insert into public.task_video_briefs(task_id, kind)
select task.id, step.video_kind from public.tasks task
join public.workflow_template_steps step on step.id = task.workflow_step_id
where step.video_kind is not null
on conflict (task_id) do nothing;

alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (event_type in (
  'TASK_CREATED','TASK_ACCEPTED','STATUS_CHANGED','TITLE_CHANGED','DESCRIPTION_CHANGED','PRIORITY_CHANGED',
  'DEADLINE_CHANGE_REQUESTED','DEADLINE_CHANGE_APPROVED','DEADLINE_CHANGE_REJECTED','DEADLINE_CHANGED',
  'REASSIGN_REQUESTED','REASSIGN_APPROVED','REASSIGN_REJECTED','ASSIGNEE_CHANGED','TASK_BLOCKED',
  'TASK_UNBLOCKED','REVIEW_REQUESTED','REVISION_REQUESTED','TASK_COMPLETED','TASK_CANCELLED','TASK_REOPENED',
  'POSTING_CHECKLIST_CREATED','POSTING_CHECKLIST_ITEM_TOGGLED','RECURRING_TASK_GENERATED',
  'PUBLICATION_DATE_CHANGED','COMMENT_ADDED','RESULT_SUBMITTED','WORKFLOW_STARTED',
  'WORKFLOW_STEP_ACTIVATED','WORKFLOW_COMPLETED','CHECKPOINT_ADDED','CHECKPOINT_COMPLETED',
  'CHECKPOINT_REOPENED','CHECKPOINT_REMOVED','VIDEO_BRIEF_SAVED','SHOOT_CONFIRMED'
));

create function public.save_task_video_brief(
  p_task_id uuid, p_actor_id uuid, p_kind text, p_brief jsonb, p_confirm boolean default false
) returns public.task_video_briefs
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_existing public.task_video_briefs;
  v_result public.task_video_briefs;
  v_scheduled_at timestamptz;
  v_duration integer;
  v_url text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  if v_task.status in ('DONE','CANCELLED') or
     not exists (select 1 from public.users where id = p_actor_id and is_active) then
    raise exception 'video brief is unavailable' using errcode = '42501';
  end if;
  if p_kind not in ('SHOOT','EDIT') then raise exception 'invalid video kind' using errcode = '22023'; end if;
  select * into v_existing from public.task_video_briefs where task_id = p_task_id for update;
  if v_existing.task_id is not null and v_existing.kind <> p_kind then
    raise exception 'video kind cannot change' using errcode = '22023';
  end if;
  if v_task.workflow_step_id is not null and exists (
    select 1 from public.workflow_template_steps
    where id = v_task.workflow_step_id and video_kind is not null and video_kind <> p_kind
  ) then raise exception 'workflow video kind cannot change' using errcode = '22023'; end if;

  if p_confirm then
    -- Serialize confirmations for one operator before checking overlap.
    perform 1 from public.users where id = v_task.assignee_id for update;
    if p_kind <> 'SHOOT' or p_actor_id <> v_task.assignee_id or v_existing.task_id is null or
       v_existing.scenario_url is null or v_existing.on_camera_person is null or
       v_existing.location is null or v_existing.scheduled_at is null or v_existing.duration_minutes is null or
       v_existing.scheduled_at <= statement_timestamp() then
      raise exception 'shoot brief must be complete before operator confirmation' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.task_video_briefs b join public.tasks t on t.id = b.task_id
      where b.task_id <> p_task_id and b.kind = 'SHOOT' and b.confirmed_at is not null
        and t.assignee_id = v_task.assignee_id and t.status not in ('DONE','CANCELLED')
        and b.scheduled_at < v_existing.scheduled_at + make_interval(mins => v_existing.duration_minutes)
        and v_existing.scheduled_at < b.scheduled_at + make_interval(mins => b.duration_minutes)
    ) then raise exception 'operator already has a confirmed shoot at this time' using errcode = '23505'; end if;
    update public.task_video_briefs set confirmed_by = p_actor_id, confirmed_at = statement_timestamp(),
      updated_at = statement_timestamp() where task_id = p_task_id returning * into v_result;
    update public.tasks set shoot_at = v_result.scheduled_at where id = p_task_id;
    insert into public.task_events(task_id, actor_id, event_type, new_value)
    values (p_task_id, p_actor_id, 'SHOOT_CONFIRMED', jsonb_build_object('scheduledAt', v_result.scheduled_at));
    return v_result;
  end if;

  if p_actor_id <> v_task.creator_id and p_actor_id <> v_task.assignee_id and
     not exists (select 1 from public.users where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active) then
    raise exception 'video brief edit is not allowed' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_brief), '') <> 'object' then
    raise exception 'video brief is required' using errcode = '22023';
  end if;
  if p_kind = 'SHOOT' then
    if p_actor_id = v_task.assignee_id and p_actor_id <> v_task.creator_id and
       not exists (select 1 from public.users where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active) then
      raise exception 'creator proposes the shoot brief' using errcode = '42501';
    end if;
    v_url := btrim(coalesce(p_brief ->> 'scenarioUrl',''));
    if v_url !~ '^https?://[^[:space:]]+$' or char_length(v_url) > 2048 or
       char_length(btrim(coalesce(p_brief ->> 'onCameraPerson',''))) not between 1 and 200 or
       char_length(btrim(coalesce(p_brief ->> 'location',''))) not between 1 and 300 or
       coalesce(p_brief ->> 'scheduledAt','') = '' or
       coalesce(p_brief ->> 'durationMinutes','') !~ '^[0-9]{1,4}$' then
      raise exception 'shoot brief is incomplete' using errcode = '22023';
    end if;
    v_scheduled_at := (p_brief ->> 'scheduledAt')::timestamptz;
    v_duration := (p_brief ->> 'durationMinutes')::integer;
    if v_scheduled_at <= statement_timestamp() or v_duration not between 5 and 1440 then
      raise exception 'shoot time or duration is invalid' using errcode = '22023'; end if;
    insert into public.task_video_briefs(task_id, kind, scenario_url, on_camera_person, location,
      scheduled_at, duration_minutes)
    values (p_task_id, p_kind, v_url, btrim(p_brief ->> 'onCameraPerson'),
      btrim(p_brief ->> 'location'), v_scheduled_at, v_duration)
    on conflict (task_id) do update set scenario_url = excluded.scenario_url,
      on_camera_person = excluded.on_camera_person, location = excluded.location,
      scheduled_at = excluded.scheduled_at, duration_minutes = excluded.duration_minutes,
      confirmed_by = null, confirmed_at = null, updated_at = statement_timestamp()
    returning * into v_result;
    update public.tasks set shoot_at = null where id = p_task_id;
  else
    v_url := btrim(coalesce(p_brief ->> 'footageUrl',''));
    if v_url !~ '^https?://[^[:space:]]+$' or char_length(v_url) > 2048 or
       char_length(btrim(coalesce(p_brief ->> 'outputSpec',''))) not between 1 and 300 or
       coalesce(p_brief ->> 'editLevel','') not in ('SIMPLE','STANDARD','COMPLEX') then
      raise exception 'edit brief is incomplete' using errcode = '22023';
    end if;
    insert into public.task_video_briefs(task_id, kind, footage_url, output_spec, edit_level)
    values (p_task_id, p_kind, v_url, btrim(p_brief ->> 'outputSpec'), p_brief ->> 'editLevel')
    on conflict (task_id) do update set footage_url = excluded.footage_url,
      output_spec = excluded.output_spec, edit_level = excluded.edit_level,
      updated_at = statement_timestamp()
    returning * into v_result;
  end if;
  insert into public.task_events(task_id, actor_id, event_type, new_value)
  values (p_task_id, p_actor_id, 'VIDEO_BRIEF_SAVED', jsonb_build_object('kind', p_kind));
  return v_result;
end;
$$;
revoke all on function public.save_task_video_brief(uuid,uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.save_task_video_brief(uuid,uuid,text,jsonb,boolean) to service_role;

create function private.reset_shoot_confirmation_on_reassignment() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.assignee_id is distinct from old.assignee_id then
    update public.task_video_briefs set confirmed_by = null, confirmed_at = null,
      updated_at = statement_timestamp() where task_id = new.id and kind = 'SHOOT';
    update public.tasks set shoot_at = null where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.reset_shoot_confirmation_on_reassignment() from public, anon, authenticated;
grant execute on function private.reset_shoot_confirmation_on_reassignment() to service_role;
create trigger reset_shoot_confirmation_on_reassignment after update of assignee_id on public.tasks
  for each row execute function private.reset_shoot_confirmation_on_reassignment();

-- Keep the versioned template editor able to declare future video stages.
create or replace function public.save_workflow_template_version(
  p_actor_id uuid, p_source_template_id uuid, p_name text,
  p_description text, p_steps jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_step record;
  v_checkpoint jsonb;
begin
  if not exists (select 1 from public.users where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active) then
    raise exception 'only Head may save workflow templates' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 or
     char_length(coalesce(p_description, '')) > 2000 or
     coalesce(jsonb_typeof(p_steps), '') <> 'array' or
     jsonb_array_length(p_steps) not between 1 and 50 then
    raise exception 'invalid workflow template details' using errcode = '22023';
  end if;
  if p_source_template_id is not null then
    perform 1 from public.workflow_templates where id = p_source_template_id and is_active for update;
    if not found then raise exception 'active source template not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.workflow_templates (id, slug, name, description, is_system, created_by)
  values (v_id, 'custom-' || v_id::text, btrim(p_name), nullif(btrim(p_description), ''), false, p_actor_id);
  for v_step in select value, ordinality from jsonb_array_elements(p_steps) with ordinality loop
    if jsonb_typeof(v_step.value) <> 'object' or
       char_length(btrim(coalesce(v_step.value ->> 'title', ''))) not between 1 and 200 or
       char_length(coalesce(v_step.value ->> 'description', '')) > 5000 or
       coalesce(v_step.value ->> 'assigneeRole', '') not in
         ('OPERATOR_VIDEO_EDITOR', 'CONTENT_MARKETER', 'DIGITAL_MARKETER', 'SMM_MANAGER', 'HEAD_OF_MARKETING') or
       coalesce(v_step.value ->> 'priority', '') not in ('high', 'normal', 'low') or
       coalesce(jsonb_typeof(v_step.value -> 'checkpointTitles'), 'array') <> 'array' or
       jsonb_array_length(coalesce(v_step.value -> 'checkpointTitles', '[]'::jsonb)) > 50 or
       coalesce(v_step.value ->> 'videoKind', '') not in ('', 'SHOOT', 'EDIT') or
       (coalesce(v_step.value ->> 'videoKind', '') <> '' and
        v_step.value ->> 'assigneeRole' <> 'OPERATOR_VIDEO_EDITOR') then
      raise exception 'invalid workflow step' using errcode = '22023';
    end if;
    if v_step.value ->> 'estimatedMinutes' is not null and
      (coalesce(v_step.value ->> 'estimatedMinutes', '') !~ '^[0-9]{1,5}$' or
       (v_step.value ->> 'estimatedMinutes')::integer not between 5 and 10080) then
      raise exception 'invalid estimated minutes' using errcode = '22023';
    end if;
    for v_checkpoint in select value from jsonb_array_elements(coalesce(v_step.value -> 'checkpointTitles', '[]'::jsonb)) loop
      if jsonb_typeof(v_checkpoint) <> 'string' or char_length(btrim(v_checkpoint #>> '{}')) not between 1 and 200 then
        raise exception 'invalid checkpoint title' using errcode = '22023';
      end if;
    end loop;
    insert into public.workflow_template_steps
      (template_id, position, title, description, assignee_role, priority, due_after_hours,
       estimated_minutes, checkpoint_titles, video_kind)
    values (
      v_id, v_step.ordinality, btrim(v_step.value ->> 'title'), nullif(btrim(v_step.value ->> 'description'), ''),
      v_step.value ->> 'assigneeRole', v_step.value ->> 'priority', 24,
      (v_step.value ->> 'estimatedMinutes')::integer,
      array(select btrim(value) from jsonb_array_elements_text(coalesce(v_step.value -> 'checkpointTitles', '[]'::jsonb))),
      nullif(v_step.value ->> 'videoKind', '')
    );
  end loop;
  if p_source_template_id is not null then
    update public.workflow_templates set is_active = false where id = p_source_template_id;
  end if;
  return v_id;
end;
$$;
