-- AI can propose a write, but only a verified user confirmation may execute it.
-- The action is claimed once before any task mutation to prevent double creation.
alter table public.assistant_turns
  add column action_proposal jsonb,
  add column action_status text,
  add column action_expires_at timestamptz,
  add column action_result text,
  add constraint assistant_turn_action_shape_check check (
    (action_proposal is null and action_status is null and action_expires_at is null)
    or (jsonb_typeof(action_proposal) = 'object' and action_status in ('PENDING', 'CLAIMED', 'DONE', 'FAILED')
      and action_expires_at is not null)
  );

create function public.claim_assistant_action(p_turn_id uuid, p_user_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_turn public.assistant_turns;
begin
  if not exists (select 1 from public.users where id = p_user_id and is_active) then
    raise exception 'active user required' using errcode = '42501';
  end if;
  select * into v_turn from public.assistant_turns
    where id = p_turn_id and user_id = p_user_id for update;
  if not found or v_turn.status <> 'COMPLETE' or v_turn.action_proposal is null then
    raise exception 'action not found' using errcode = 'P0002';
  end if;
  if v_turn.action_status = 'DONE' then
    return jsonb_build_object('fresh', false, 'result', v_turn.action_result);
  end if;
  if v_turn.action_status <> 'PENDING' or v_turn.action_expires_at <= statement_timestamp() then
    raise exception 'action already claimed or expired' using errcode = 'P0002';
  end if;
  update public.assistant_turns set action_status = 'CLAIMED'
    where id = p_turn_id returning * into v_turn;
  return jsonb_build_object('fresh', true, 'proposal', v_turn.action_proposal);
end;
$$;

create function public.finish_assistant_action(
  p_turn_id uuid, p_user_id uuid, p_result text, p_success boolean
) returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.assistant_turns set action_status = case when p_success then 'DONE' else 'FAILED' end,
    action_result = p_result
  where id = p_turn_id and user_id = p_user_id and action_status = 'CLAIMED';
  if not found then raise exception 'action not claimed' using errcode = 'P0002'; end if;
  return true;
end;
$$;

revoke all on function public.claim_assistant_action(uuid,uuid) from public, anon, authenticated;
revoke all on function public.finish_assistant_action(uuid,uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_assistant_action(uuid,uuid) to service_role;
grant execute on function public.finish_assistant_action(uuid,uuid,text,boolean) to service_role;
