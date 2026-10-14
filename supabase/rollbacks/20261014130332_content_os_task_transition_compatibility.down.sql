-- Rollback for 20261014130332_content_os_task_transition_compatibility.sql.
-- NOT a migration. Restores the previous transition function byte-for-byte
-- from 20260909090000_next_product_phase.sql and clears the Sprint 9C comment.
-- Existing task state and append-only history are intentionally untouched.

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

comment on function public.transition_task_with_events(uuid, uuid, text, text) is null;
