-- Browser-initiated, bot-confirmed login. Only token hashes are stored;
-- the raw browser secret remains in an HttpOnly cookie and the short code
-- exists only in the Telegram deep link.
create table public.web_login_challenges (
  id uuid primary key default gen_random_uuid(),
  browser_hash text not null unique check (browser_hash ~ '^[0-9a-f]{64}$'),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'CONSUMED')),
  user_id uuid references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  consumed_at timestamptz,
  check (expires_at > created_at),
  check (
    (status = 'PENDING' and user_id is null and approved_at is null and consumed_at is null) or
    (status = 'APPROVED' and user_id is not null and approved_at is not null and consumed_at is null) or
    (status = 'CONSUMED' and user_id is not null and approved_at is not null and consumed_at is not null)
  )
);

create index web_login_challenges_expires_idx on public.web_login_challenges (expires_at);

alter table public.web_login_challenges enable row level security;
revoke all on table public.web_login_challenges from public, anon, authenticated;
grant select, insert, update on table public.web_login_challenges to service_role;
