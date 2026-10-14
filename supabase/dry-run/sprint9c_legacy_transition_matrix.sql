-- LOCAL DRY-RUN ONLY. Verifies all 42 non-identity status cells for an
-- assignee and the active Head. Safe to run before Content OS exists, after
-- it is installed, and after it is rolled back.

drop schema if exists sprint9c_legacy cascade;
create schema sprint9c_legacy;

create function sprint9c_legacy.ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

create table sprint9c_legacy.ids (key text primary key, value uuid not null);
create table sprint9c_legacy.results (
  actor_key text not null,
  from_status text not null,
  to_status text not null,
  result text not null,
  expected text not null,
  primary key (actor_key, from_status, to_status)
);

insert into public.users (telegram_user_id, display_name, role, is_active) values
  (92001, 'Sprint 9C Head', 'HEAD_OF_MARKETING', true),
  (92002, 'Sprint 9C creator', 'CONTENT_MARKETER', true),
  (92003, 'Sprint 9C assignee', 'DIGITAL_MARKETER', true)
on conflict (telegram_user_id) do nothing;

insert into sprint9c_legacy.ids
select 'head', id from public.users where telegram_user_id = 92001
union all select 'creator', id from public.users where telegram_user_id = 92002
union all select 'assignee', id from public.users where telegram_user_id = 92003;

create function sprint9c_legacy.id(p_key text)
returns uuid language sql stable as $$
  select value from sprint9c_legacy.ids where key = p_key
$$;

create function sprint9c_legacy.task_in(p_status text)
returns uuid language plpgsql as $$
declare v_task_id uuid;
begin
  select id into v_task_id
  from public.create_task_with_event_v2(
    sprint9c_legacy.id('creator'),
    sprint9c_legacy.id('assignee'),
    'Sprint 9C legacy matrix ' || p_status,
    '',
    'normal',
    now() + interval '2 days'
  );
  update public.tasks set
    status = p_status,
    blocked_reason = case when p_status = 'BLOCKED' then 'matrix fixture' end,
    completed_at = case when p_status = 'DONE' then now() end,
    cancelled_at = case when p_status = 'CANCELLED' then now() end
  where id = v_task_id;
  return v_task_id;
end $$;

create function sprint9c_legacy.try_transition(p_task_id uuid, p_actor_id uuid, p_to text)
returns text language plpgsql as $$
begin
  perform public.transition_task_with_events(
    p_task_id,
    p_actor_id,
    p_to,
    case when p_to = 'BLOCKED' then 'matrix reason' end
  );
  return 'OK';
exception when others then
  return sqlstate;
end $$;

create function sprint9c_legacy.record_matrix(p_actor_key text)
returns void language plpgsql as $$
declare
  statuses text[] := array['ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'REVISION', 'DONE', 'CANCELLED'];
  from_status text;
  to_status text;
  task_id uuid;
  expected_result text;
begin
  foreach from_status in array statuses loop
    foreach to_status in array statuses loop
      continue when from_status = to_status;
      task_id := sprint9c_legacy.task_in(from_status);
      expected_result := case when
        (from_status = 'ASSIGNED' and to_status in ('IN_PROGRESS', 'CANCELLED'))
        or (from_status = 'IN_PROGRESS' and to_status in ('BLOCKED', 'REVIEW', 'CANCELLED'))
        or (from_status = 'BLOCKED' and to_status in ('IN_PROGRESS', 'CANCELLED'))
        or (from_status = 'REVIEW' and to_status in ('DONE', 'REVISION', 'CANCELLED'))
        or (from_status = 'REVISION' and to_status in ('IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CANCELLED'))
        or (from_status in ('DONE', 'CANCELLED') and to_status = 'ASSIGNED')
        then 'OK' else '40001' end;
      insert into sprint9c_legacy.results values (
        p_actor_key,
        from_status,
        to_status,
        sprint9c_legacy.try_transition(task_id, sprint9c_legacy.id(p_actor_key), to_status),
        expected_result
      );
    end loop;
  end loop;
end $$;

grant usage on schema sprint9c_legacy to service_role;
grant select, insert on all tables in schema sprint9c_legacy to service_role;
grant execute on all functions in schema sprint9c_legacy to service_role;

set role service_role;
select sprint9c_legacy.record_matrix('assignee');
select sprint9c_legacy.record_matrix('head');
select sprint9c_legacy.ok(
  (select count(*) from sprint9c_legacy.results where actor_key = 'assignee') = 42
  and not exists (select 1 from sprint9c_legacy.results where actor_key = 'assignee' and result <> expected),
  'legacy assignee matrix: all 42 non-identity transitions unchanged'
);
select sprint9c_legacy.ok(
  (select count(*) from sprint9c_legacy.results where actor_key = 'head') = 42
  and not exists (select 1 from sprint9c_legacy.results where actor_key = 'head' and result <> expected),
  'legacy Head matrix: all 42 non-identity transitions unchanged'
);
reset role;

\echo 'ALL SPRINT 9C LEGACY MATRIX TESTS PASSED'
