\set ON_ERROR_STOP on

create extension if not exists dblink;

create or replace function public.sprint10b_try_resolve_deadline(
  p_request_id uuid,
  p_head_id uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result public.deadline_change_requests;
begin
  perform pg_catalog.pg_sleep(0.5);
  select * into v_result
  from public.resolve_deadline_change_request_with_events(p_request_id, p_head_id, true, null);
  return v_result.status;
exception when others then
  return sqlstate;
end;
$$;

create or replace function public.sprint10b_try_resolve_reassign(
  p_request_id uuid,
  p_head_id uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result public.reassign_requests;
begin
  perform pg_catalog.pg_sleep(0.5);
  select * into v_result
  from public.resolve_reassign_request_with_events(p_request_id, p_head_id, true, null);
  return v_result.status;
exception when others then
  return sqlstate;
end;
$$;

do $$
declare
  v_head uuid := 'b2000000-0000-4000-8000-000000000001';
  v_creator uuid := 'b2000000-0000-4000-8000-000000000002';
  v_assignee uuid := 'b2000000-0000-4000-8000-000000000003';
  v_target uuid := 'b2000000-0000-4000-8000-000000000004';
  v_deadline_task public.tasks;
  v_reassign_task public.tasks;
  v_deadline_request public.deadline_change_requests;
  v_reassign_request public.reassign_requests;
  v_connection text := format('dbname=%s user=%s', current_database(), current_user);
begin
  insert into public.users (id, telegram_user_id, display_name, role, is_active)
  values
    (v_head, 940000001, 'Race Head', 'HEAD_OF_MARKETING', true),
    (v_creator, 940000002, 'Race Creator', 'CONTENT_MARKETER', true),
    (v_assignee, 940000003, 'Race Assignee', 'OPERATOR_VIDEO_EDITOR', true),
    (v_target, 940000004, 'Race Target', 'SEO_SPECIALIST', true);

  select * into v_deadline_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Deadline race', '', 'normal',
    statement_timestamp() + interval '5 days', null, null, null
  );
  select * into v_reassign_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Reassign race', '', 'normal',
    statement_timestamp() + interval '5 days', null, null, null
  );
  select * into v_deadline_request from public.create_deadline_change_request_with_event(
    v_deadline_task.id, v_assignee, statement_timestamp() + interval '6 days', 'Race'
  );
  select * into v_reassign_request from public.create_reassign_request_with_event(
    v_reassign_task.id, v_assignee, v_target, 'Race'
  );

  perform dblink_connect('deadline_one', v_connection);
  perform dblink_connect('deadline_two', v_connection);
  perform dblink_send_query('deadline_one', format(
    'select public.sprint10b_try_resolve_deadline(%L::uuid, %L::uuid)',
    v_deadline_request.id, v_head
  ));
  perform dblink_send_query('deadline_two', format(
    'select public.sprint10b_try_resolve_deadline(%L::uuid, %L::uuid)',
    v_deadline_request.id, v_head
  ));

  perform dblink_connect('reassign_one', v_connection);
  perform dblink_connect('reassign_two', v_connection);
  perform dblink_send_query('reassign_one', format(
    'select public.sprint10b_try_resolve_reassign(%L::uuid, %L::uuid)',
    v_reassign_request.id, v_head
  ));
  perform dblink_send_query('reassign_two', format(
    'select public.sprint10b_try_resolve_reassign(%L::uuid, %L::uuid)',
    v_reassign_request.id, v_head
  ));

  -- Fixture commit is required before the independent dblink sessions can see
  -- these rows. Results and invariants are checked by the second block below.
end;
$$;

-- Commit the fixtures while keeping the asynchronous sessions alive.
checkpoint;

do $$
declare
  v_deadline_one text;
  v_deadline_two text;
  v_reassign_one text;
  v_reassign_two text;
begin
  select result into v_deadline_one from dblink_get_result('deadline_one') as t(result text);
  select result into v_deadline_two from dblink_get_result('deadline_two') as t(result text);
  select result into v_reassign_one from dblink_get_result('reassign_one') as t(result text);
  select result into v_reassign_two from dblink_get_result('reassign_two') as t(result text);

  if (select count(*) from unnest(array[v_deadline_one, v_deadline_two]) value where value = 'APPROVED') <> 1
    or (select count(*) from unnest(array[v_deadline_one, v_deadline_two]) value where value = 'PT409') <> 1 then
    raise exception 'deadline dual-resolution result was not APPROVED + PT409: %, %', v_deadline_one, v_deadline_two;
  end if;
  if (select count(*) from unnest(array[v_reassign_one, v_reassign_two]) value where value = 'APPROVED') <> 1
    or (select count(*) from unnest(array[v_reassign_one, v_reassign_two]) value where value = 'PT409') <> 1 then
    raise exception 'reassign dual-resolution result was not APPROVED + PT409: %, %', v_reassign_one, v_reassign_two;
  end if;

  if (select count(*) from public.task_events e join public.deadline_change_requests r on r.task_id = e.task_id
      where r.requested_by = 'b2000000-0000-4000-8000-000000000003'::uuid
        and e.event_type = 'DEADLINE_CHANGE_APPROVED') <> 1 then
    raise exception 'deadline dual-resolution emitted duplicate decision events';
  end if;
  if (select count(*) from public.task_events e join public.reassign_requests r on r.task_id = e.task_id
      where r.requested_by = 'b2000000-0000-4000-8000-000000000003'::uuid
        and e.event_type = 'REASSIGN_APPROVED') <> 1 then
    raise exception 'reassign dual-resolution emitted duplicate decision events';
  end if;

  perform dblink_disconnect('deadline_one');
  perform dblink_disconnect('deadline_two');
  perform dblink_disconnect('reassign_one');
  perform dblink_disconnect('reassign_two');
  raise notice 'PASS concurrent Telegram/Content OS request resolution is first-wins and exactly-once';
end;
$$;

drop function public.sprint10b_try_resolve_deadline(uuid, uuid);
drop function public.sprint10b_try_resolve_reassign(uuid, uuid);
