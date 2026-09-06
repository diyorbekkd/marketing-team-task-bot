-- Revision records are historical evidence and must be append-only.

create function private.prevent_revision_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'task_revisions are immutable; append a new revision instead'
    using errcode = '55000';
end;
$$;

create trigger task_revisions_prevent_update_or_delete
before update or delete on public.task_revisions
for each row execute function private.prevent_revision_mutation();

revoke update, delete on table public.task_revisions from service_role;

comment on table public.task_revisions is
  'Append-only revision history. UPDATE and DELETE are rejected by a trigger.';
