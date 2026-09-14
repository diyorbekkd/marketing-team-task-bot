-- New tasks no longer require the assignee to Accept: every task created
-- through the one shared creation function now starts IN_PROGRESS. This is
-- the only change in this migration. Legacy ASSIGNED rows are untouched —
-- transition_task_with_events still allows ASSIGNED -> IN_PROGRESS (ACCEPT)
-- for them, and the Mini App only shows the Accept action for a task whose
-- current status is ASSIGNED, so old records remain fully functional.
--
-- Bulk task creation needs no schema change: it reuses the existing unique
-- `tasks.source_telegram_update_id` column with an application-computed
-- synthetic key (update_id * 100 + block_index), so ON CONFLICT DO NOTHING
-- already protects each block exactly the way it already protects a single
-- task on a duplicated webhook delivery.

create or replace function public.create_task_with_event_v2(
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
    title, description, priority, status, creator_id, assignee_id, deadline,
    source_telegram_update_id, recurring_definition_id, scheduled_occurrence_at
  ) values (
    btrim(p_title), nullif(btrim(p_description), ''), p_priority, 'IN_PROGRESS', p_creator_id, p_assignee_id,
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
      'priority', v_task.priority, 'deadline', v_task.deadline, 'status', v_task.status),
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

comment on function public.create_task_with_event_v2 is
  'Single shared creation path for every transport (group, private bot, Mini App, recurring generation, bulk). New tasks start IN_PROGRESS -- acceptance is no longer required. Idempotent on source_telegram_update_id (bulk callers pass a synthetic update_id*100+block_index) and on (recurring_definition_id, scheduled_occurrence_at).';
