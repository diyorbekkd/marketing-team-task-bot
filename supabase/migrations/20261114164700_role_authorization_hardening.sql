-- Defence in depth for organizational authorization: the service-layer guard
-- remains the primary policy, while PostgreSQL independently verifies that
-- the recorded actor is the active Head before changing another user's role.

create or replace function public.update_user_role_with_event(
  p_user_id uuid,
  p_actor_id uuid,
  p_role text
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user public.users;
  v_old_role text;
begin
  if not exists (
    select 1 from public.users
    where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active
  ) then
    raise exception 'only active Head may change team roles' using errcode = '42501';
  end if;

  if p_role not in ('OPERATOR_VIDEO_EDITOR', 'CONTENT_MARKETER', 'DIGITAL_MARKETER', 'SMM_MANAGER') then
    raise exception 'head role transfer is outside this flow' using errcode = '22023';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if not v_user.is_active then
    raise exception 'user is not active' using errcode = '40001';
  end if;
  if v_user.role = 'HEAD_OF_MARKETING' then
    raise exception 'head role cannot change through this flow' using errcode = '42501';
  end if;
  if v_user.role = p_role then return v_user; end if;

  v_old_role := v_user.role;
  update public.users set role = p_role where id = p_user_id returning * into v_user;
  insert into public.user_events (user_id, actor_id, event_type, old_value, new_value)
  values (p_user_id, p_actor_id, 'USER_ROLE_CHANGED', to_jsonb(v_old_role), to_jsonb(p_role));
  return v_user;
end;
$$;

revoke all on function public.update_user_role_with_event(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.update_user_role_with_event(uuid, uuid, text)
  to service_role;
