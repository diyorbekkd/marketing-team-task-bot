-- Private, idempotent assistant conversations. Only the trusted server may
-- read or mutate these records; browser and Telegram identities are resolved
-- by the application before the service_role client reaches this table.
create table public.assistant_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  request_key text not null check (char_length(request_key) between 1 and 100),
  source text not null check (source in ('WEB', 'TELEGRAM')),
  user_text text not null check (char_length(btrim(user_text)) between 1 and 3000),
  answer_text text check (answer_text is null or char_length(answer_text) between 1 and 10000),
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETE', 'FAILED')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (user_id, request_key),
  check ((status = 'COMPLETE') = (answer_text is not null))
);

create index assistant_turns_user_recent_idx on public.assistant_turns (user_id, created_at desc);

alter table public.assistant_turns enable row level security;
revoke all on table public.assistant_turns from public, anon, authenticated;
grant select, insert, update on table public.assistant_turns to service_role;

-- Lock the user row so concurrent requests cannot cross the daily allowance.
create function public.claim_assistant_turn(
  p_user_id uuid, p_request_key text, p_source text, p_user_text text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_user public.users;
  v_turn public.assistant_turns;
  v_fresh boolean := false;
  v_today timestamptz;
begin
  select * into v_user from public.users where id = p_user_id and is_active for update;
  if not found then raise exception 'active user required' using errcode = '42501'; end if;
  select * into v_turn from public.assistant_turns
    where user_id = p_user_id and request_key = p_request_key;
  if found then
    -- A crashed function must not leave a request permanently stuck.
    if v_turn.status = 'FAILED' or
       (v_turn.status = 'PENDING' and v_turn.created_at < statement_timestamp() - interval '60 seconds') then
      update public.assistant_turns set status = 'PENDING', answer_text = null,
        input_tokens = null, output_tokens = null, completed_at = null, created_at = statement_timestamp()
      where id = v_turn.id returning * into v_turn;
      return jsonb_build_object('turn', to_jsonb(v_turn), 'fresh', true);
    end if;
    return jsonb_build_object('turn', to_jsonb(v_turn), 'fresh', false);
  end if;
  v_today := date_trunc('day', statement_timestamp() at time zone 'Asia/Tashkent') at time zone 'Asia/Tashkent';
  if (select count(*) from public.assistant_turns where user_id = p_user_id and created_at >= v_today) >= 30 then
    raise exception 'daily assistant limit reached' using errcode = 'P0001';
  end if;
  insert into public.assistant_turns (user_id, request_key, source, user_text)
  values (p_user_id, p_request_key, p_source, btrim(p_user_text)) returning * into v_turn;
  v_fresh := true;
  return jsonb_build_object('turn', to_jsonb(v_turn), 'fresh', v_fresh);
end;
$$;

create function public.finish_assistant_turn(
  p_turn_id uuid, p_user_id uuid, p_answer_text text,
  p_input_tokens integer, p_output_tokens integer
) returns public.assistant_turns
language plpgsql security invoker set search_path = '' as $$
declare v_turn public.assistant_turns;
begin
  update public.assistant_turns set
    status = case when nullif(btrim(p_answer_text), '') is null then 'FAILED' else 'COMPLETE' end,
    answer_text = nullif(btrim(p_answer_text), ''),
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    completed_at = statement_timestamp()
  where id = p_turn_id and user_id = p_user_id and status = 'PENDING'
  returning * into v_turn;
  if not found then raise exception 'assistant turn not pending' using errcode = 'P0002'; end if;
  return v_turn;
end;
$$;

revoke all on function public.claim_assistant_turn(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.finish_assistant_turn(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_assistant_turn(uuid, text, text, text) to service_role;
grant execute on function public.finish_assistant_turn(uuid, uuid, text, integer, integer) to service_role;
