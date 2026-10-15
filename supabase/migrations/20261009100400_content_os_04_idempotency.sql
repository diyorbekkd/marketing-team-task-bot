-- DRAFT (Sprint 8B) — NOT APPLIED TO PRODUCTION. Dry-run only.
-- Durable idempotency for Content OS-originated task creation (contract §M).
-- Does NOT use tasks.source_telegram_update_id and does not modify any
-- task-bot function: it calls the existing create_task_with_event_v2.

create table public.content_os_idempotency_keys (
  purpose text not null check (purpose in ('CREATE_TASK', 'PUBLISH_CHECK', 'MATERIAL_LEARNING')),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  -- SHA-256 hex of the canonical request; same key + different hash = conflict.
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  task_id uuid not null unique references public.tasks (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (purpose, idempotency_key)
);

create trigger content_os_idempotency_keys_immutable before update or delete on public.content_os_idempotency_keys
  for each row execute function private.content_os_prevent_mutation();

alter table public.content_os_idempotency_keys enable row level security;
revoke all on table public.content_os_idempotency_keys from public, anon, authenticated, service_role;
grant select, insert on table public.content_os_idempotency_keys to service_role;

-- One transaction: lock the key, return the existing task for an identical
-- retry, reject a different request under the same key, otherwise create the
-- task through the shared task-bot creation path and record the key.
-- Purposes use deterministic keys: PUBLISH_CHECK = scheduled publish task id,
-- MATERIAL_LEARNING = material id (one Learning per Material).
create function public.content_os_create_task_idempotent(
  p_purpose text,
  p_idempotency_key text,
  p_request_hash text,
  p_creator_id uuid,
  p_assignee_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_deadline timestamptz
)
returns table (task_id uuid, created boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_existing public.content_os_idempotency_keys;
  v_task public.tasks;
begin
  if p_purpose is null or p_idempotency_key is null or p_request_hash is null then
    raise exception 'idempotency purpose, key and request hash are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_purpose || ':' || p_idempotency_key, 0));

  select * into v_existing
  from public.content_os_idempotency_keys
  where purpose = p_purpose and idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'IDEMPOTENCY_KEY_REUSED: % key % was used for a different request', p_purpose, p_idempotency_key
        using errcode = '23505';
    end if;
    return query select v_existing.task_id, false;
    return;
  end if;

  select * into v_task from public.create_task_with_event_v2(
    p_creator_id, p_assignee_id, p_title, p_description, p_priority, p_deadline, null, null, null
  );

  insert into public.content_os_idempotency_keys (purpose, idempotency_key, request_hash, task_id)
  values (p_purpose, p_idempotency_key, p_request_hash, v_task.id);

  return query select v_task.id, true;
end;
$$;

revoke all on function public.content_os_create_task_idempotent(text, text, text, uuid, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.content_os_create_task_idempotent(text, text, text, uuid, uuid, text, text, text, timestamptz)
  to service_role;

comment on function public.content_os_create_task_idempotent(text, text, text, uuid, uuid, text, text, text, timestamptz) is
  'DRAFT. Content OS idempotent task creation. Retry with the same key+hash returns the same task; a different hash conflicts. Concurrent duplicates serialize on an advisory lock; the ledger PK is the backstop.';
