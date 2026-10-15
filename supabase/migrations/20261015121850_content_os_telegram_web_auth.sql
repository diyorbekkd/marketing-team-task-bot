-- Telegram-approved, PKCE-like web authentication for Content OS.
--
-- The browser owns the raw verifier and opaque session token. Trusted server
-- runtimes hash both values before calling these RPCs; PostgreSQL persists
-- only fixed-length SHA-256 proofs. public.users remains the sole identity,
-- active-state, and role authority.

create table private.content_os_login_challenges (
  id uuid primary key default gen_random_uuid(),
  verifier_hash text not null check (verifier_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'PENDING' check (
    status in ('PENDING', 'APPROVED', 'CONSUMED', 'CANCELLED')
  ),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '10 minutes'),
  approved_user_id uuid references public.users (id) on delete restrict,
  approved_at timestamptz,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  check (
    (status = 'PENDING'
      and approved_user_id is null and approved_at is null
      and consumed_at is null and cancelled_at is null)
    or
    (status = 'APPROVED'
      and approved_user_id is not null and approved_at is not null
      and consumed_at is null and cancelled_at is null)
    or
    (status = 'CONSUMED'
      and approved_user_id is not null and approved_at is not null
      and consumed_at is not null and cancelled_at is null)
    or
    (status = 'CANCELLED'
      and approved_user_id is null and approved_at is null
      and consumed_at is null and cancelled_at is not null)
  )
);

create table private.content_os_web_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '30 days'),
  revoked_at timestamptz,
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  check (revoked_at is null or revoked_at >= created_at)
);

create index content_os_login_challenges_pending_expiry_idx
  on private.content_os_login_challenges (expires_at)
  where status = 'PENDING';

create index content_os_web_sessions_user_active_idx
  on private.content_os_web_sessions (user_id, expires_at)
  where revoked_at is null;

alter table private.content_os_login_challenges enable row level security;
alter table private.content_os_web_sessions enable row level security;

revoke all on table private.content_os_login_challenges
  from public, anon, authenticated, service_role;
revoke all on table private.content_os_web_sessions
  from public, anon, authenticated, service_role;
grant select, insert, update on table private.content_os_login_challenges to service_role;
grant select, insert, update on table private.content_os_web_sessions to service_role;
grant usage on schema private to service_role;

-- Fixed work for valid SHA-256 proofs. The proofs themselves have 256 bits of
-- entropy; callers reject malformed values before this comparison is reached.
create function private.constant_time_sha256_hex_equal(p_left text, p_right text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_left bytea;
  v_right bytea;
  v_difference integer := 0;
  v_index integer;
begin
  if p_left !~ '^[0-9a-f]{64}$' or p_right !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  v_left := decode(p_left, 'hex');
  v_right := decode(p_right, 'hex');
  for v_index in 0..31 loop
    v_difference := v_difference | (get_byte(v_left, v_index) # get_byte(v_right, v_index));
  end loop;
  return v_difference = 0;
end;
$$;

create function public.content_os_auth_create_challenge(p_verifier_hash text)
returns table (challenge_id uuid, status text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_verifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid verifier proof' using errcode = '22023';
  end if;

  return query
  insert into private.content_os_login_challenges (verifier_hash)
  values (lower(p_verifier_hash))
  returning id, private.content_os_login_challenges.status,
    private.content_os_login_challenges.expires_at;
end;
$$;

create function public.content_os_auth_get_challenge_status(p_challenge_id uuid)
returns table (status text, expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_challenge private.content_os_login_challenges;
begin
  select * into v_challenge
  from private.content_os_login_challenges
  where id = p_challenge_id;

  if not found then
    return query select 'UNAVAILABLE'::text, null::timestamptz;
  elsif v_challenge.status = 'PENDING' and v_challenge.expires_at <= statement_timestamp() then
    return query select 'EXPIRED'::text, v_challenge.expires_at;
  else
    return query select v_challenge.status, v_challenge.expires_at;
  end if;
end;
$$;

create function public.content_os_auth_approve_challenge(
  p_challenge_id uuid,
  p_telegram_user_id bigint
)
returns table (status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_challenge private.content_os_login_challenges;
  v_user public.users;
begin
  select * into v_challenge
  from private.content_os_login_challenges
  where id = p_challenge_id
  for update;

  if not found then
    return query select 'UNAVAILABLE'::text;
    return;
  end if;

  select * into v_user
  from public.users
  where telegram_user_id = p_telegram_user_id and is_active;

  if not found then
    if v_challenge.status = 'PENDING' and v_challenge.expires_at > statement_timestamp() then
      update private.content_os_login_challenges
      set status = 'CANCELLED', cancelled_at = statement_timestamp()
      where id = p_challenge_id;
    end if;
    return query select 'DENIED'::text;
    return;
  end if;

  if v_challenge.status in ('PENDING', 'APPROVED')
    and v_challenge.expires_at <= statement_timestamp() then
    return query select 'EXPIRED'::text;
    return;
  elsif v_challenge.status = 'APPROVED' and v_challenge.approved_user_id = v_user.id then
    return query select 'APPROVED'::text;
    return;
  elsif v_challenge.status <> 'PENDING' then
    return query select 'UNAVAILABLE'::text;
    return;
  end if;

  update private.content_os_login_challenges
  set status = 'APPROVED', approved_user_id = v_user.id,
      approved_at = statement_timestamp()
  where id = p_challenge_id;

  return query select 'APPROVED'::text;
end;
$$;

create function public.content_os_auth_cancel_challenge(
  p_challenge_id uuid,
  p_telegram_user_id bigint
)
returns table (status text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_challenge private.content_os_login_challenges;
begin
  select * into v_challenge
  from private.content_os_login_challenges
  where id = p_challenge_id
  for update;

  if not found then
    return query select 'UNAVAILABLE'::text;
  elsif not exists (
    select 1 from public.users
    where telegram_user_id = p_telegram_user_id and is_active
  ) then
    return query select 'DENIED'::text;
  elsif v_challenge.status = 'CANCELLED' then
    return query select 'CANCELLED'::text;
  elsif v_challenge.status <> 'PENDING' then
    return query select 'UNAVAILABLE'::text;
  elsif v_challenge.expires_at <= statement_timestamp() then
    return query select 'EXPIRED'::text;
  else
    update private.content_os_login_challenges
    set status = 'CANCELLED', cancelled_at = statement_timestamp()
    where id = p_challenge_id;
    return query select 'CANCELLED'::text;
  end if;
end;
$$;

create function public.content_os_auth_redeem_challenge(
  p_challenge_id uuid,
  p_verifier_hash text,
  p_session_token_hash text
)
returns table (
  status text,
  session_id uuid,
  authenticated_user_id uuid,
  display_name text,
  role text,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_challenge private.content_os_login_challenges;
  v_user public.users;
  v_session private.content_os_web_sessions;
begin
  if p_verifier_hash !~ '^[0-9a-f]{64}$'
    or p_session_token_hash !~ '^[0-9a-f]{64}$' then
    return query
    select 'INVALID_PROOF'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  end if;

  select * into v_challenge
  from private.content_os_login_challenges
  where id = p_challenge_id
  for update;

  if not found then
    return query
    select 'UNAVAILABLE'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  elsif v_challenge.status = 'CONSUMED' then
    return query
    select 'ALREADY_CONSUMED'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  elsif v_challenge.status = 'CANCELLED' then
    return query
    select 'CANCELLED'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  elsif v_challenge.status = 'PENDING' then
    return query
    select case when v_challenge.expires_at <= statement_timestamp()
        then 'EXPIRED'::text else 'PENDING'::text end,
      null::uuid, null::uuid, null::text, null::text, null::timestamptz;
    return;
  elsif v_challenge.expires_at <= statement_timestamp() then
    return query
    select 'EXPIRED'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  elsif not private.constant_time_sha256_hex_equal(
    v_challenge.verifier_hash,
    lower(p_verifier_hash)
  ) then
    return query
    select 'INVALID_PROOF'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  end if;

  select * into v_user
  from public.users
  where id = v_challenge.approved_user_id and is_active
  for share;

  if not found then
    return query
    select 'USER_INACTIVE'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  end if;

  insert into private.content_os_web_sessions (token_hash, user_id)
  values (lower(p_session_token_hash), v_user.id)
  returning * into v_session;

  update private.content_os_login_challenges
  set status = 'CONSUMED', consumed_at = statement_timestamp()
  where id = p_challenge_id;

  return query
  select 'REDEEMED'::text, v_session.id, v_user.id, v_user.display_name,
    v_user.role, v_session.expires_at;
end;
$$;

create function public.content_os_auth_validate_session(p_session_token_hash text)
returns table (
  status text,
  session_id uuid,
  authenticated_user_id uuid,
  display_name text,
  role text,
  expires_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_session_token_hash !~ '^[0-9a-f]{64}$' then
    return query
    select 'INVALID'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
    return;
  end if;

  return query
  select 'VALID'::text, s.id, u.id, u.display_name, u.role, s.expires_at
  from private.content_os_web_sessions s
  join public.users u on u.id = s.user_id
  where s.token_hash = lower(p_session_token_hash)
    and s.revoked_at is null
    and s.expires_at > statement_timestamp()
    and u.is_active
  limit 1;

  if not found then
    return query
    select 'INVALID'::text, null::uuid, null::uuid, null::text,
      null::text, null::timestamptz;
  end if;
end;
$$;

create function public.content_os_auth_revoke_session(p_session_token_hash text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_revoked boolean;
begin
  if p_session_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update private.content_os_web_sessions
  set revoked_at = statement_timestamp()
  where token_hash = lower(p_session_token_hash) and revoked_at is null;
  v_revoked := found;
  return v_revoked;
end;
$$;

-- Deactivation invalidates every current session immediately and also makes
-- an already-approved challenge unusable after a later reactivation.
create function private.revoke_content_os_auth_on_user_deactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update private.content_os_web_sessions
  set revoked_at = statement_timestamp()
  where user_id = new.id and revoked_at is null;

  update private.content_os_login_challenges
  set status = 'CANCELLED', approved_user_id = null, approved_at = null,
      cancelled_at = statement_timestamp()
  where approved_user_id = new.id and status = 'APPROVED';

  return new;
end;
$$;

create trigger users_revoke_content_os_auth_on_deactivation
after update of is_active on public.users
for each row
when (old.is_active and not new.is_active)
execute function private.revoke_content_os_auth_on_user_deactivation();

revoke all on function private.revoke_content_os_auth_on_user_deactivation()
  from public, anon, authenticated, service_role;

revoke all on function private.constant_time_sha256_hex_equal(text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.constant_time_sha256_hex_equal(text, text) to service_role;

revoke all on function public.content_os_auth_create_challenge(text)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_get_challenge_status(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_approve_challenge(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_cancel_challenge(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_redeem_challenge(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_validate_session(text)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_revoke_session(text)
  from public, anon, authenticated, service_role;

grant execute on function public.content_os_auth_create_challenge(text) to service_role;
grant execute on function public.content_os_auth_get_challenge_status(uuid) to service_role;
grant execute on function public.content_os_auth_approve_challenge(uuid, bigint) to service_role;
grant execute on function public.content_os_auth_cancel_challenge(uuid, bigint) to service_role;
grant execute on function public.content_os_auth_redeem_challenge(uuid, text, text) to service_role;
grant execute on function public.content_os_auth_validate_session(text) to service_role;
grant execute on function public.content_os_auth_revoke_session(text) to service_role;
