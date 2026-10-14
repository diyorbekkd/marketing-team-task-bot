-- Rollback for 20261014123341_repair_posting_checklist_creation.sql.
-- NOT a migration. Restores the previous helper exactly; under the hardened
-- privilege matrix this also restores the known #posting creation failure.

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

comment on function private.attach_posting_checklist(uuid, timestamptz) is null;
