-- DRAFT (Sprint 8B) — NOT APPLIED, NOT ENABLED. Dry-run only.
-- OWNER: task-bot track (Codex). Drafted here so the contract can be tested;
-- it may land in marketing-team-task-bot instead. Service auth stays OFF:
-- nothing reads this table yet (SchemaNotReadyExternalActorResolver).

create table public.external_identity_links (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider = 'OPENAI_SIWC'),
  tenant_key text not null check (char_length(btrim(tenant_key)) between 1 and 200),
  external_subject text not null check (char_length(btrim(external_subject)) between 1 and 200),
  user_id uuid not null references public.users (id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  linked_by uuid not null references public.users (id) on delete restrict,
  linked_at timestamptz not null default now(),
  verified_at timestamptz,
  revoked_by uuid references public.users (id) on delete restrict,
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(btrim(revoke_reason)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_identity_links_revocation_check check (
    (status = 'ACTIVE' and revoked_by is null and revoked_at is null and revoke_reason is null)
    or (status = 'REVOKED' and revoked_by is not null and revoked_at is not null and revoke_reason is not null)
  )
);

-- One active mapping per provider/tenant/subject; history = revoked rows.
create unique index external_identity_links_one_active_idx
  on public.external_identity_links (provider, tenant_key, external_subject) where status = 'ACTIVE';
create index external_identity_links_user_idx on public.external_identity_links (user_id);

-- Only allowed changes: set verified_at on an ACTIVE link, or ACTIVE -> REVOKED.
create function private.content_os_guard_identity_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'identity links are never deleted; revoke instead' using errcode = '55000';
  end if;
  if old.status = 'REVOKED' then
    raise exception 'a revoked identity link is immutable' using errcode = '55000';
  end if;
  if new.provider <> old.provider or new.tenant_key <> old.tenant_key or new.external_subject <> old.external_subject
    or new.user_id <> old.user_id or new.linked_by <> old.linked_by or new.linked_at <> old.linked_at then
    raise exception 'identity link mapping cannot be rewritten; revoke and link again' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger external_identity_links_guard before update or delete on public.external_identity_links
  for each row execute function private.content_os_guard_identity_link();
create trigger external_identity_links_set_updated_at before update on public.external_identity_links
  for each row execute function private.set_updated_at();

alter table public.external_identity_links enable row level security;
revoke all on table public.external_identity_links from public, anon, authenticated, service_role;
grant select, insert, update on table public.external_identity_links to service_role;

comment on table public.external_identity_links is
  'DRAFT, not enabled. Maps an OPENAI_SIWC subject to an existing public.users row. Linking is Head-controlled (future RPC); resolution must also require users.is_active.';
