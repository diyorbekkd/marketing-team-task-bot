-- New workflow runs use explicit handoff deadlines. Existing runs (null
-- step_assignments) keep their old duration-based advancement path.
alter table public.workflow_template_steps
  add column estimated_minutes integer check (estimated_minutes between 5 and 10080),
  add column checkpoint_titles text[] not null default '{}';
alter table public.workflow_runs add column step_assignments jsonb;
alter table public.tasks
  add column participant_ids uuid[] not null default '{}',
  add column workflow_next_deadline timestamptz;

-- A template version remains immutable once used by a run. The old
-- due_after_hours column stays for historical runs only.
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
       jsonb_array_length(coalesce(v_step.value -> 'checkpointTitles', '[]'::jsonb)) > 50 then
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
      (template_id, position, title, description, assignee_role, priority, due_after_hours, estimated_minutes, checkpoint_titles)
    values (
      v_id, v_step.ordinality, btrim(v_step.value ->> 'title'), nullif(btrim(v_step.value ->> 'description'), ''),
      v_step.value ->> 'assigneeRole', v_step.value ->> 'priority', 24,
      (v_step.value ->> 'estimatedMinutes')::integer,
      array(select btrim(value) from jsonb_array_elements_text(coalesce(v_step.value -> 'checkpointTitles', '[]'::jsonb)))
    );
  end loop;
  if p_source_template_id is not null then
    update public.workflow_templates set is_active = false where id = p_source_template_id;
  end if;
  return v_id;
end;
$$;

-- All planned owners and participants are checked while the plan is created.
-- Future steps are metadata, not tasks, until the preceding step is approved.
create function public.start_workflow_run_v2(
  p_template_id uuid, p_actor_id uuid, p_subject text,
  p_first_deadline timestamptz, p_step_assignments jsonb
) returns public.tasks
language plpgsql security invoker set search_path = '' as $$
declare
  v_step public.workflow_template_steps;
  v_run public.workflow_runs;
  v_task public.tasks;
  v_owner uuid;
  v_participants uuid[];
  v_title text;
  v_position integer;
begin
  if not exists (select 1 from public.users where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active) then
    raise exception 'only Head may start workflows' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workflow_templates where id = p_template_id and is_active) or
     char_length(btrim(coalesce(p_subject, ''))) not between 1 and 200 or
     p_first_deadline is null or p_first_deadline <= statement_timestamp() or
     coalesce(jsonb_typeof(p_step_assignments), '') <> 'object' then
    raise exception 'invalid workflow start' using errcode = '22023';
  end if;
  for v_step in select * from public.workflow_template_steps where template_id = p_template_id order by position loop
    if coalesce(jsonb_typeof(p_step_assignments -> v_step.id::text), '') <> 'object' or
       coalesce(jsonb_typeof(p_step_assignments -> v_step.id::text -> 'participantIds'), '') <> 'array' then
      raise exception 'every step needs an owner and participants list' using errcode = '22023';
    end if;
    v_owner := (p_step_assignments -> v_step.id::text ->> 'ownerId')::uuid;
    if not exists (select 1 from public.users where id = v_owner and is_active) or
       exists (
         select 1 from jsonb_array_elements_text(p_step_assignments -> v_step.id::text -> 'participantIds') member
         where not exists (select 1 from public.users where id = member.value::uuid and is_active)
       ) then
      raise exception 'workflow owner or participant is inactive' using errcode = '22023';
    end if;
  end loop;
  select * into v_step from public.workflow_template_steps where template_id = p_template_id order by position limit 1;
  if not found then raise exception 'workflow has no steps' using errcode = '22023'; end if;
  v_owner := (p_step_assignments -> v_step.id::text ->> 'ownerId')::uuid;
  v_participants := array(
    select distinct member.value::uuid from jsonb_array_elements_text(p_step_assignments -> v_step.id::text -> 'participantIds') member
    where member.value::uuid <> v_owner
  );
  insert into public.workflow_runs (template_id, created_by, subject, assignee_map, step_assignments, current_position)
  values (p_template_id, p_actor_id, btrim(p_subject), '{}'::jsonb, p_step_assignments, v_step.position)
  returning * into v_run;
  insert into public.tasks
    (title, description, priority, status, creator_id, assignee_id, participant_ids, deadline, workflow_run_id, workflow_step_id)
  values
    (v_run.subject || ' — ' || v_step.title, v_step.description, v_step.priority, 'IN_PROGRESS',
     p_actor_id, v_owner, v_participants, p_first_deadline, v_run.id, v_step.id)
  returning * into v_task;
  insert into public.task_events (task_id, actor_id, event_type, new_value, metadata) values
    (v_task.id, p_actor_id, 'TASK_CREATED', jsonb_build_object('title', v_task.title, 'assigneeId', v_owner, 'deadline', v_task.deadline), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id)),
    (v_task.id, p_actor_id, 'WORKFLOW_STARTED', to_jsonb(v_run.subject), jsonb_build_object('workflowRunId', v_run.id, 'templateId', p_template_id)),
    (v_task.id, p_actor_id, 'WORKFLOW_STEP_ACTIVATED', to_jsonb(v_step.position), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id));
  for v_title, v_position in select title, ordinality from unnest(v_step.checkpoint_titles) with ordinality as checkpoint(title, ordinality) loop
    insert into public.task_checkpoints (task_id, title, position, created_by)
    values (v_task.id, v_title, v_position, p_actor_id);
    insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
    values (v_task.id, p_actor_id, 'CHECKPOINT_ADDED', jsonb_build_object('title', v_title), jsonb_build_object('source', 'WORKFLOW_TEMPLATE'));
  end loop;
  if (v_task.title || E'\n' || coalesce(v_task.description, '')) ~* '(^|[^[:alnum:]_])#posting([^[:alnum:]_]|$)' then
    perform private.attach_posting_checklist(v_task.id);
    insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
    values (v_task.id, p_actor_id, 'POSTING_CHECKLIST_CREATED', to_jsonb('POSTING'::text), jsonb_build_object('workflowRunId', v_run.id));
  end if;
  return v_task;
end;
$$;

revoke all on function public.start_workflow_run_v2(uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.start_workflow_run_v2(uuid, uuid, text, timestamptz, jsonb) to service_role;

-- The next deadline is supplied by the previous owner before approval.
-- Historical runs retain the old duration rule; new runs never read it.
create or replace function public.advance_workflow_run(p_completed_task_id uuid, p_actor_id uuid)
returns public.tasks
language plpgsql security invoker set search_path = '' as $$
declare
  v_completed public.tasks;
  v_run public.workflow_runs;
  v_step public.workflow_template_steps;
  v_task public.tasks;
  v_owner uuid;
  v_participants uuid[];
  v_deadline timestamptz;
  v_title text;
  v_position integer;
begin
  select * into v_completed from public.tasks where id = p_completed_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  if v_completed.workflow_run_id is null or v_completed.status <> 'DONE' then return null; end if;
  select * into v_run from public.workflow_runs where id = v_completed.workflow_run_id for update;
  if v_run.status <> 'ACTIVE' then return null; end if;
  if not exists (select 1 from public.users where id = p_actor_id and is_active) then
    raise exception 'actor is not active' using errcode = '42501';
  end if;
  select * into v_step from public.workflow_template_steps
  where template_id = v_run.template_id and position > v_run.current_position
  order by position limit 1;
  if not found then
    update public.workflow_runs set status = 'COMPLETED', completed_at = statement_timestamp() where id = v_run.id;
    insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
    values (v_completed.id, p_actor_id, 'WORKFLOW_COMPLETED', to_jsonb(v_run.subject), jsonb_build_object('workflowRunId', v_run.id));
    return null;
  end if;
  if v_run.step_assignments is null then
    v_owner := private.workflow_assignee(v_step.assignee_role, v_run.assignee_map);
    v_participants := '{}'::uuid[];
    v_deadline := statement_timestamp() + make_interval(hours => v_step.due_after_hours);
  else
    v_owner := (v_run.step_assignments -> v_step.id::text ->> 'ownerId')::uuid;
    if not exists (select 1 from public.users where id = v_owner and is_active) then
      raise exception 'next workflow owner is inactive' using errcode = '22023';
    end if;
    v_participants := array(
      select distinct member.value::uuid
      from jsonb_array_elements_text(v_run.step_assignments -> v_step.id::text -> 'participantIds') member
      join public.users u on u.id = member.value::uuid and u.is_active
      where u.id <> v_owner
    );
    v_deadline := v_completed.workflow_next_deadline;
    if v_deadline is null then raise exception 'next workflow deadline is missing' using errcode = '22023'; end if;
  end if;
  insert into public.tasks
    (title, description, priority, status, creator_id, assignee_id, participant_ids, deadline, workflow_run_id, workflow_step_id)
  values
    (v_run.subject || ' — ' || v_step.title, v_step.description, v_step.priority, 'IN_PROGRESS',
     v_run.created_by, v_owner, v_participants, v_deadline, v_run.id, v_step.id)
  on conflict (workflow_run_id, workflow_step_id) where workflow_run_id is not null do nothing
  returning * into v_task;
  if v_task.id is null then return null; end if;
  update public.workflow_runs set current_position = v_step.position where id = v_run.id;
  insert into public.task_events (task_id, actor_kind, event_type, new_value, metadata) values
    (v_task.id, 'SYSTEM', 'TASK_CREATED', jsonb_build_object('title', v_task.title, 'assigneeId', v_owner, 'deadline', v_deadline), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id)),
    (v_task.id, 'SYSTEM', 'WORKFLOW_STEP_ACTIVATED', to_jsonb(v_step.position), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id, 'previousTaskId', v_completed.id));
  if v_run.step_assignments is not null then
    for v_title, v_position in select title, ordinality from unnest(v_step.checkpoint_titles) with ordinality as checkpoint(title, ordinality) loop
      insert into public.task_checkpoints (task_id, title, position, created_by)
      values (v_task.id, v_title, v_position, v_run.created_by);
      insert into public.task_events (task_id, actor_kind, event_type, new_value, metadata)
      values (v_task.id, 'SYSTEM', 'CHECKPOINT_ADDED', jsonb_build_object('title', v_title), jsonb_build_object('source', 'WORKFLOW_TEMPLATE'));
    end loop;
  end if;
  if (v_task.title || E'\n' || coalesce(v_task.description, '')) ~* '(^|[^[:alnum:]_])#posting([^[:alnum:]_]|$)' then
    perform private.attach_posting_checklist(v_task.id);
    insert into public.task_events (task_id, actor_kind, event_type, new_value, metadata)
    values (v_task.id, 'SYSTEM', 'POSTING_CHECKLIST_CREATED', to_jsonb('POSTING'::text), jsonb_build_object('workflowRunId', v_run.id));
  end if;
  return v_task;
end;
$$;

create function public.submit_workflow_step_for_review(
  p_task_id uuid, p_actor_id uuid, p_next_deadline timestamptz
) returns public.tasks
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_old_status text;
  v_run public.workflow_runs;
  v_has_next boolean;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  v_old_status := v_task.status;
  select * into v_run from public.workflow_runs where id = v_task.workflow_run_id;
  if v_run.step_assignments is null or v_run.status <> 'ACTIVE' or
     v_task.status not in ('IN_PROGRESS', 'REVISION') or v_task.assignee_id <> p_actor_id or
     not exists (select 1 from public.users where id = p_actor_id and is_active) then
    raise exception 'workflow handoff is not allowed' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.workflow_template_steps
    where template_id = v_run.template_id and position > v_run.current_position
  ) into v_has_next;
  if v_has_next and (p_next_deadline is null or p_next_deadline <= statement_timestamp()) then
    raise exception 'next workflow deadline must be in the future' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.task_checklists c join public.task_checklist_items i on i.checklist_id = c.id
    where c.task_id = p_task_id and not i.is_completed
  ) then raise exception 'posting checklist is incomplete' using errcode = '23514'; end if;
  update public.tasks set status = 'REVIEW', workflow_next_deadline = case when v_has_next then p_next_deadline else null end,
    blocked_reason = null where id = p_task_id returning * into v_task;
  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata) values
    (p_task_id, p_actor_id, 'STATUS_CHANGED', to_jsonb(v_old_status), to_jsonb('REVIEW'::text),
      jsonb_build_object('nextDeadline', v_task.workflow_next_deadline)),
    (p_task_id, p_actor_id, 'REVIEW_REQUESTED', to_jsonb(v_old_status), to_jsonb('REVIEW'::text),
      jsonb_build_object('nextDeadline', v_task.workflow_next_deadline));
  return v_task;
end;
$$;

create function public.complete_self_owned_task(
  p_task_id uuid, p_actor_id uuid, p_next_deadline timestamptz
) returns public.tasks
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_old_status text;
  v_run public.workflow_runs;
  v_has_next boolean := false;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  v_old_status := v_task.status;
  if v_old_status not in ('IN_PROGRESS', 'REVISION') or
     v_task.creator_id <> p_actor_id or v_task.assignee_id <> p_actor_id or
     not exists (select 1 from public.users where id = p_actor_id and is_active) then
    raise exception 'self completion is not allowed' using errcode = '42501';
  end if;
  if v_task.workflow_run_id is not null then
    select * into v_run from public.workflow_runs where id = v_task.workflow_run_id;
    if v_run.step_assignments is not null then
      select exists (
        select 1 from public.workflow_template_steps
        where template_id = v_run.template_id and position > v_run.current_position
      ) into v_has_next;
    end if;
  end if;
  if v_has_next and (p_next_deadline is null or p_next_deadline <= statement_timestamp()) then
    raise exception 'next workflow deadline must be in the future' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.task_checklists c join public.task_checklist_items i on i.checklist_id = c.id
    where c.task_id = p_task_id and not i.is_completed
  ) then raise exception 'posting checklist is incomplete' using errcode = '23514'; end if;
  update public.tasks set status = 'DONE', completed_at = statement_timestamp(),
    workflow_next_deadline = case when v_has_next then p_next_deadline else null end,
    blocked_reason = null where id = p_task_id returning * into v_task;
  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata) values
    (p_task_id, p_actor_id, 'STATUS_CHANGED', to_jsonb(v_old_status), to_jsonb('DONE'::text),
      jsonb_build_object('nextDeadline', v_task.workflow_next_deadline)),
    (p_task_id, p_actor_id, 'TASK_COMPLETED', to_jsonb(v_old_status), to_jsonb('DONE'::text),
      jsonb_build_object('nextDeadline', v_task.workflow_next_deadline));
  return v_task;
end;
$$;

revoke all on function public.submit_workflow_step_for_review(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_self_owned_task(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.submit_workflow_step_for_review(uuid, uuid, timestamptz) to service_role;
grant execute on function public.complete_self_owned_task(uuid, uuid, timestamptz) to service_role;
