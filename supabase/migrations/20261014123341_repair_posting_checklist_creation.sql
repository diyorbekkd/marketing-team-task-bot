-- Repair #posting task creation under the intended least-privilege table
-- grants. The original helper used ON CONFLICT DO UPDATE only to recover an
-- existing checklist id. PostgreSQL checks UPDATE privilege for that clause,
-- so service_role could not call create_task_with_event_v2 for #posting tasks
-- while task_checklists correctly exposed only SELECT and INSERT.
--
-- Keep the operation idempotent without widening privileges: INSERT ... DO
-- NOTHING first, then resolve the pre-existing row with a separate SELECT.
-- Rollback: supabase/rollbacks/20261014123341_repair_posting_checklist_creation.down.sql

create or replace function private.attach_posting_checklist(
  p_task_id uuid,
  p_created_at timestamptz default statement_timestamp()
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_checklist_id uuid;
begin
  insert into public.task_checklists (task_id, kind, created_at)
  values (p_task_id, 'POSTING', p_created_at)
  on conflict (task_id) do nothing
  returning id into v_checklist_id;

  if v_checklist_id is null then
    select id into v_checklist_id
    from public.task_checklists
    where task_id = p_task_id;
  end if;

  if v_checklist_id is null then
    raise exception 'posting checklist conflict could not be resolved'
      using errcode = '40001';
  end if;

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

comment on function private.attach_posting_checklist(uuid, timestamptz) is
  'Idempotently attaches the persistent posting checklist using only SELECT/INSERT on task_checklists.';
