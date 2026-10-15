-- DRAFT (Sprint 8B) — NOT APPLIED TO PRODUCTION. Dry-run only.
-- Content OS persistence: shared private trigger helpers.
-- Depends on the task-bot baseline (schema `private`, private.set_updated_at()).

create function private.content_os_prevent_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% rows are immutable; insert a new version instead', tg_table_name
    using errcode = '55000';
end;
$$;

comment on function private.content_os_prevent_mutation() is
  'Content OS: rejects UPDATE/DELETE on immutable history/config rows (same pattern as task_events).';
