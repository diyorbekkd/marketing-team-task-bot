-- Bind initial Head activation to the configured Telegram identity instead of
-- allowing the first arbitrary /start sender to claim the privileged role.

drop function public.register_telegram_user(bigint, text, text);

create function public.register_telegram_user(
  p_telegram_user_id bigint,
  p_telegram_username text,
  p_display_name text,
  p_expected_head_telegram_user_id bigint
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users;
  v_head_id uuid;
  v_is_expected_head boolean;
begin
  if p_telegram_user_id <= 0
    or p_expected_head_telegram_user_id <= 0
    or char_length(btrim(p_display_name)) = 0 then
    raise exception 'invalid Telegram identity' using errcode = '22023';
  end if;

  v_is_expected_head := p_telegram_user_id = p_expected_head_telegram_user_id;
  lock table public.users in share row exclusive mode;

  select id into v_head_id
  from public.users
  where role = 'HEAD_OF_MARKETING' and is_active;

  select * into v_user
  from public.users
  where telegram_user_id = p_telegram_user_id;

  if found then
    if v_is_expected_head and v_head_id is not null and v_head_id <> v_user.id then
      raise exception 'configured Head conflicts with the active Head' using errcode = '23505';
    end if;

    update public.users
    set telegram_username = nullif(lower(btrim(p_telegram_username)), ''),
        display_name = btrim(p_display_name),
        role = case when v_is_expected_head then 'HEAD_OF_MARKETING' else role end,
        is_active = case when v_is_expected_head then true else is_active end
    where id = v_user.id
    returning * into v_user;
    return v_user;
  end if;

  if v_is_expected_head and v_head_id is not null then
    raise exception 'configured Head conflicts with the active Head' using errcode = '23505';
  end if;

  insert into public.users (
    telegram_user_id,
    telegram_username,
    display_name,
    role,
    is_active
  ) values (
    p_telegram_user_id,
    nullif(lower(btrim(p_telegram_username)), ''),
    btrim(p_display_name),
    case when v_is_expected_head then 'HEAD_OF_MARKETING' else 'SMM_MANAGER' end,
    v_is_expected_head
  )
  returning * into v_user;

  return v_user;
end;
$$;

revoke all on function public.register_telegram_user(bigint, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.register_telegram_user(bigint, text, text, bigint)
  to service_role;

comment on function public.register_telegram_user(bigint, text, text, bigint) is
  'Idempotent onboarding. Only the configured Telegram identity can become the initial active Head; all other new users remain pending.';
