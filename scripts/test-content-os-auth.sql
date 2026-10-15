\set ON_ERROR_STOP on

begin;
set local role service_role;

do $$
declare
  v_active_id uuid := 'a0000000-0000-4000-8000-000000000001';
  v_pending_id uuid := 'a0000000-0000-4000-8000-000000000002';
  v_inactive_id uuid := 'a0000000-0000-4000-8000-000000000003';
  v_challenge uuid;
  v_challenge_two uuid;
  v_challenge_three uuid;
  v_approved_before_deactivation uuid;
  v_status text;
  v_display_code text;
  v_status_display_code text;
  v_session_id uuid;
  v_session_two_id uuid;
  v_session_three_id uuid;
  v_user_id uuid;
  v_role text;
  v_count bigint;
  v_task_count bigint;
  v_created_at timestamptz;
  v_expires_at timestamptz;
  v_function regprocedure;
  v_verifier_hash text := repeat('a', 64);
  v_session_hash text := repeat('b', 64);
  v_session_two_hash text := repeat('c', 64);
  v_session_three_hash text := repeat('d', 64);
  v_session_four_hash text := repeat('e', 64);
  v_raw_verifier text := 'raw-verifier-must-never-be-persisted';
  v_raw_session text := 'raw-session-token-must-never-be-persisted';
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private'
      and c.relname in ('content_os_login_challenges', 'content_os_web_sessions')
      and not c.relrowsecurity
  ) then raise exception 'an auth table does not have RLS enabled'; end if;

  if has_table_privilege('anon', 'private.content_os_login_challenges', 'SELECT')
    or has_table_privilege('authenticated', 'private.content_os_login_challenges', 'SELECT')
    or has_table_privilege('anon', 'private.content_os_web_sessions', 'SELECT')
    or has_table_privilege('authenticated', 'private.content_os_web_sessions', 'SELECT') then
    raise exception 'a browser role can read private auth tables';
  end if;
  if not has_table_privilege('service_role', 'private.content_os_login_challenges', 'SELECT')
    or not has_table_privilege('service_role', 'private.content_os_login_challenges', 'INSERT')
    or not has_table_privilege('service_role', 'private.content_os_login_challenges', 'UPDATE')
    or has_table_privilege('service_role', 'private.content_os_login_challenges', 'DELETE')
    or not has_table_privilege('service_role', 'private.content_os_web_sessions', 'SELECT')
    or not has_table_privilege('service_role', 'private.content_os_web_sessions', 'INSERT')
    or not has_table_privilege('service_role', 'private.content_os_web_sessions', 'UPDATE')
    or has_table_privilege('service_role', 'private.content_os_web_sessions', 'DELETE') then
    raise exception 'service_role auth-table privileges are not least-privilege';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'private' and table_name = 'content_os_web_sessions'
      and column_name = 'role'
  ) then raise exception 'session table persists role authority'; end if;

  foreach v_function in array array[
    'public.content_os_auth_create_challenge(text,text)'::regprocedure,
    'public.content_os_auth_get_challenge_status(uuid)'::regprocedure,
    'public.content_os_auth_approve_challenge(uuid,bigint)'::regprocedure,
    'public.content_os_auth_cancel_challenge(uuid,bigint)'::regprocedure,
    'public.content_os_auth_redeem_challenge(uuid,text,text)'::regprocedure,
    'public.content_os_auth_validate_session(text)'::regprocedure,
    'public.content_os_auth_revoke_session(text)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'RPC execute privileges are not server-only for %', v_function;
    end if;
  end loop;

  insert into public.users (
    id, telegram_user_id, telegram_username, display_name, role, is_active,
    deactivated_at
  ) values
    (v_active_id, 910000001, 'auth_active', 'Auth Active', 'CONTENT_MARKETER', true, null),
    (v_pending_id, 910000002, 'auth_pending', 'Auth Pending', 'SMM_MANAGER', false, null),
    (v_inactive_id, 910000003, 'auth_inactive', 'Auth Inactive', 'DIGITAL_MARKETER', false, statement_timestamp());

  select count(*) into v_task_count from public.tasks;

  -- Challenge ids are random UUIDs and separate browser tabs do not alias.
  select challenge_id, display_code into v_challenge, v_display_code
  from public.content_os_auth_create_challenge(v_verifier_hash, v_verifier_hash);
  select challenge_id into v_challenge_two
  from public.content_os_auth_create_challenge(repeat('1', 64), repeat('1', 64));
  if v_challenge = v_challenge_two
    or v_challenge::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or v_display_code !~ '^[0-9]{6}$' then
    raise exception 'challenge ids are not independent random UUIDv4 values';
  end if;
  select display_code into v_status_display_code
  from public.content_os_auth_get_challenge_status(v_challenge);
  if v_status_display_code <> v_display_code then
    raise exception 'browser and Telegram status contracts returned different display codes';
  end if;

  -- Unknown, pending, and inactive Telegram identities all fail closed.
  select challenge_id into v_challenge_three
  from public.content_os_auth_create_challenge(repeat('2', 64), repeat('2', 64));
  select status into v_status
  from public.content_os_auth_approve_challenge(v_challenge_three, 919999999);
  if v_status <> 'DENIED' then raise exception 'unknown user approval was not denied'; end if;

  select challenge_id into v_challenge_three
  from public.content_os_auth_create_challenge(repeat('3', 64), repeat('3', 64));
  select status into v_status
  from public.content_os_auth_approve_challenge(v_challenge_three, 910000002);
  if v_status <> 'DENIED' then raise exception 'pending user approval was not denied'; end if;

  select challenge_id into v_challenge_three
  from public.content_os_auth_create_challenge(repeat('4', 64), repeat('4', 64));
  select status into v_status
  from public.content_os_auth_approve_challenge(v_challenge_three, 910000003);
  if v_status <> 'DENIED' then raise exception 'inactive user approval was not denied'; end if;

  -- Expiry and cancellation are terminal for approval/redeem.
  select challenge_id into v_challenge_three
  from public.content_os_auth_create_challenge(repeat('5', 64), repeat('5', 64));
  update private.content_os_login_challenges
  set created_at = statement_timestamp() - interval '20 minutes',
      expires_at = statement_timestamp() - interval '10 minutes'
  where id = v_challenge_three;
  select status into v_status
  from public.content_os_auth_approve_challenge(v_challenge_three, 910000001);
  if v_status <> 'EXPIRED' then raise exception 'expired challenge was not denied'; end if;

  select challenge_id into v_challenge_three
  from public.content_os_auth_create_challenge(repeat('6', 64), repeat('6', 64));
  select status into v_status
  from public.content_os_auth_cancel_challenge(v_challenge_three, 910000001);
  if v_status <> 'CANCELLED' then raise exception 'challenge cancellation failed'; end if;
  select status into v_status
  from public.content_os_auth_redeem_challenge(v_challenge_three, repeat('6', 64), repeat('7', 64));
  if v_status <> 'CANCELLED' then raise exception 'cancelled challenge was redeemable'; end if;

  -- Active Telegram approval binds the challenge to public.users.
  select status into v_status
  from public.content_os_auth_approve_challenge(v_challenge, 910000001);
  if v_status <> 'APPROVED' then raise exception 'active user approval failed'; end if;
  select approved_user_id into v_user_id
  from private.content_os_login_challenges where id = v_challenge;
  if v_user_id <> v_active_id then raise exception 'approval bound the wrong user'; end if;

  -- Wrong proof fails, correct proof creates exactly one 30-day session, and
  -- replay returns no session.
  select status into v_status
  from public.content_os_auth_redeem_challenge(v_challenge, repeat('f', 64), v_session_hash);
  if v_status <> 'INVALID_PROOF' then raise exception 'wrong verifier was accepted'; end if;

  select status, session_id, authenticated_user_id, expires_at
  into v_status, v_session_id, v_user_id, v_expires_at
  from public.content_os_auth_redeem_challenge(v_challenge, v_verifier_hash, v_session_hash);
  if v_status <> 'REDEEMED' or v_user_id <> v_active_id or v_session_id is null then
    raise exception 'correct verifier did not create a session';
  end if;
  select created_at into v_created_at
  from private.content_os_web_sessions where id = v_session_id;
  if v_expires_at <> v_created_at + interval '30 days' then
    raise exception 'session lifetime is not exactly 30 days';
  end if;

  select status into v_status
  from public.content_os_auth_redeem_challenge(v_challenge, v_verifier_hash, repeat('8', 64));
  if v_status <> 'ALREADY_CONSUMED' then raise exception 'challenge replay was not rejected'; end if;
  select count(*) into v_count
  from private.content_os_web_sessions where user_id = v_active_id;
  if v_count <> 1 then raise exception 'challenge replay created a duplicate session'; end if;

  -- A second independent challenge produces a second device session.
  select status into v_status
  from public.content_os_auth_approve_challenge(v_challenge_two, 910000001);
  if v_status <> 'APPROVED' then raise exception 'second-device approval failed'; end if;
  select status, session_id into v_status, v_session_two_id
  from public.content_os_auth_redeem_challenge(v_challenge_two, repeat('1', 64), v_session_two_hash);
  if v_status <> 'REDEEMED' or v_session_two_id = v_session_id then
    raise exception 'second-device session was not independent';
  end if;

  -- Revoking one device leaves the other alive.
  if not public.content_os_auth_revoke_session(v_session_hash) then
    raise exception 'specific session revoke failed';
  end if;
  select status into v_status from public.content_os_auth_validate_session(v_session_hash);
  if v_status <> 'INVALID' then raise exception 'revoked session remained valid'; end if;
  select status into v_status from public.content_os_auth_validate_session(v_session_two_hash);
  if v_status <> 'VALID' then raise exception 'one-device revoke affected another device'; end if;

  -- Current role is read from public.users on every validation.
  update public.users set role = 'SEO_SPECIALIST' where id = v_active_id;
  select status, role into v_status, v_role
  from public.content_os_auth_validate_session(v_session_two_hash);
  if v_status <> 'VALID' or v_role <> 'SEO_SPECIALIST' then
    raise exception 'role change was not visible on next validation';
  end if;

  -- Expired sessions fail closed.
  select challenge_id into v_challenge_three
  from public.content_os_auth_create_challenge(repeat('9', 64), repeat('9', 64));
  perform public.content_os_auth_approve_challenge(v_challenge_three, 910000001);
  select status, session_id into v_status, v_session_three_id
  from public.content_os_auth_redeem_challenge(v_challenge_three, repeat('9', 64), v_session_three_hash);
  update private.content_os_web_sessions
  set created_at = statement_timestamp() - interval '31 days',
      expires_at = statement_timestamp() - interval '1 day'
  where id = v_session_three_id;
  select status into v_status from public.content_os_auth_validate_session(v_session_three_hash);
  if v_status <> 'INVALID' then raise exception 'expired session remained valid'; end if;

  -- Deactivation immediately revokes every live session and cancels an
  -- approved challenge. Reactivation does not revive either one.
  select challenge_id into v_approved_before_deactivation
  from public.content_os_auth_create_challenge(repeat('0', 64), repeat('0', 64));
  perform public.content_os_auth_approve_challenge(v_approved_before_deactivation, 910000001);
  update public.users
  set is_active = false, deactivated_at = statement_timestamp()
  where id = v_active_id;
  select status into v_status from public.content_os_auth_validate_session(v_session_two_hash);
  if v_status <> 'INVALID' then raise exception 'deactivated user session remained valid'; end if;
  select status into v_status
  from public.content_os_auth_get_challenge_status(v_approved_before_deactivation);
  if v_status <> 'CANCELLED' then raise exception 'approved challenge survived deactivation'; end if;

  update public.users set is_active = true, deactivated_at = null where id = v_active_id;
  select status into v_status from public.content_os_auth_validate_session(v_session_two_hash);
  if v_status <> 'INVALID' then raise exception 'reactivation revived an old session'; end if;

  select challenge_id into v_challenge_three
  from public.content_os_auth_create_challenge(repeat('7', 64), repeat('7', 64));
  perform public.content_os_auth_approve_challenge(v_challenge_three, 910000001);
  select status into v_status
  from public.content_os_auth_redeem_challenge(v_challenge_three, repeat('7', 64), v_session_four_hash);
  if v_status <> 'REDEEMED' then raise exception 'fresh login after reactivation failed'; end if;

  -- The database contains proofs only, never the browser's raw secrets.
  if exists (
    select 1 from private.content_os_login_challenges c
    where to_jsonb(c)::text like '%' || v_raw_verifier || '%'
  ) then raise exception 'raw verifier reached the database'; end if;
  if exists (
    select 1 from private.content_os_web_sessions s
    where to_jsonb(s)::text like '%' || v_raw_session || '%'
  ) then raise exception 'raw session token reached the database'; end if;

  -- Normal Telegram onboarding remains pending for a non-Head identity.
  perform public.register_telegram_user(910000004, 'auth_new', 'Auth New', 999999999);
  if not exists (
    select 1 from public.users
    where telegram_user_id = 910000004 and not is_active and deactivated_at is null
  ) then raise exception 'normal Telegram onboarding no longer creates a pending user'; end if;

  select count(*) into v_count from public.tasks;
  if v_count <> v_task_count then raise exception 'login flow created or changed task rows'; end if;

  raise notice 'PASS Content OS auth lifecycle contract';
end;
$$;

rollback;
