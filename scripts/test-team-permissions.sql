\set ON_ERROR_STOP on

begin;
set local role service_role;

do $$
declare
  v_head uuid := 'b1000000-0000-4000-8000-000000000001';
  v_creator uuid := 'b1000000-0000-4000-8000-000000000002';
  v_assignee uuid := 'b1000000-0000-4000-8000-000000000003';
  v_target uuid := 'b1000000-0000-4000-8000-000000000004';
  v_unrelated uuid := 'b1000000-0000-4000-8000-000000000005';
  v_inactive uuid := 'b1000000-0000-4000-8000-000000000006';
  v_task public.tasks;
  v_archive_task public.tasks;
  v_deadline_request public.deadline_change_requests;
  v_reassign_request public.reassign_requests;
  v_archive public.task_archives;
  v_before_events bigint;
  v_after_events bigint;
  v_function regprocedure;
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('task_archives', 'task_notification_deliveries')
      and not c.relrowsecurity
  ) then raise exception 'a Sprint 10B table does not have RLS enabled'; end if;

  if has_table_privilege('anon', 'public.task_archives', 'SELECT')
    or has_table_privilege('authenticated', 'public.task_archives', 'SELECT')
    or has_table_privilege('anon', 'public.task_notification_deliveries', 'SELECT')
    or has_table_privilege('authenticated', 'public.task_notification_deliveries', 'SELECT') then
    raise exception 'browser role can read a Sprint 10B table';
  end if;
  if not has_table_privilege('service_role', 'public.task_archives', 'SELECT')
    or not has_table_privilege('service_role', 'public.task_archives', 'INSERT')
    or not has_table_privilege('service_role', 'public.task_archives', 'DELETE')
    or has_table_privilege('service_role', 'public.task_archives', 'UPDATE')
    or not has_table_privilege('service_role', 'public.task_notification_deliveries', 'SELECT')
    or not has_table_privilege('service_role', 'public.task_notification_deliveries', 'INSERT')
    or not has_table_privilege('service_role', 'public.task_notification_deliveries', 'UPDATE')
    or has_table_privilege('service_role', 'public.task_notification_deliveries', 'DELETE') then
    raise exception 'Sprint 10B table grants are not least privilege';
  end if;

  foreach v_function in array array[
    'public.update_task_content_with_events(uuid,uuid,text,text,text)'::regprocedure,
    'public.reassign_task_with_event(uuid,uuid,uuid)'::regprocedure,
    'public.change_task_deadline_with_event(uuid,timestamptz,uuid)'::regprocedure,
    'public.create_deadline_change_request_with_event(uuid,uuid,timestamptz,text)'::regprocedure,
    'public.resolve_deadline_change_request_with_events(uuid,uuid,boolean,text)'::regprocedure,
    'public.create_reassign_request_with_event(uuid,uuid,uuid,text)'::regprocedure,
    'public.resolve_reassign_request_with_events(uuid,uuid,boolean,text)'::regprocedure,
    'public.archive_task_with_event(uuid,uuid,text)'::regprocedure,
    'public.restore_task_with_event(uuid,uuid)'::regprocedure
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
      or has_function_privilege('authenticated', v_function, 'EXECUTE')
      or not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'RPC execute privileges are not server-only for %', v_function;
    end if;
  end loop;

  insert into public.users (id, telegram_user_id, display_name, role, is_active, deactivated_at)
  values
    (v_head, 930000001, 'Head', 'HEAD_OF_MARKETING', true, null),
    (v_creator, 930000002, 'Creator', 'CONTENT_MARKETER', true, null),
    (v_assignee, 930000003, 'Assignee', 'OPERATOR_VIDEO_EDITOR', true, null),
    (v_target, 930000004, 'Target', 'SEO_SPECIALIST', true, null),
    (v_unrelated, 930000005, 'Unrelated', 'DIGITAL_MARKETER', true, null),
    (v_inactive, 930000006, 'Inactive', 'SMM_MANAGER', false, statement_timestamp());

  select * into v_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Permission task', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  select * into v_archive_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Archive task', '', 'normal',
    statement_timestamp() + interval '11 days', null, null, null
  );

  begin
    perform public.reassign_task_with_event(v_task.id, v_target, v_unrelated);
    raise exception 'unrelated direct reassignment was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.reassign_task_with_event(v_task.id, v_inactive, v_creator);
    raise exception 'inactive direct assignee was accepted';
  exception when invalid_parameter_value then null;
  end;

  perform public.reassign_task_with_event(v_task.id, v_target, v_creator);
  perform public.reassign_task_with_event(v_task.id, v_assignee, v_head);
  if (select count(*) from public.task_events where task_id = v_task.id and event_type = 'ASSIGNEE_CHANGED') <> 2 then
    raise exception 'direct reassignment did not create exactly one event per actual change';
  end if;

  perform public.change_task_deadline_with_event(
    v_task.id, statement_timestamp() + interval '12 days', v_creator
  );
  if (select count(*) from public.task_events where task_id = v_task.id and event_type = 'DEADLINE_CHANGED') <> 1 then
    raise exception 'direct deadline change event missing or duplicated';
  end if;

  begin
    perform public.create_deadline_change_request_with_event(
      v_task.id, v_creator, statement_timestamp() + interval '13 days', 'Creator must use direct path'
    );
    raise exception 'creator deadline request was accepted';
  exception when insufficient_privilege then null;
  end;

  select * into v_deadline_request from public.create_deadline_change_request_with_event(
    v_task.id, v_assignee, statement_timestamp() + interval '13 days', 'Need more time'
  );
  begin
    perform public.resolve_deadline_change_request_with_events(v_deadline_request.id, v_creator, true, null);
    raise exception 'non-Head deadline resolution was accepted';
  exception when insufficient_privilege then null;
  end;
  perform public.resolve_deadline_change_request_with_events(v_deadline_request.id, v_head, true, 'Approved');
  begin
    perform public.resolve_deadline_change_request_with_events(v_deadline_request.id, v_head, false, null);
    raise exception 'deadline request resolved twice';
  exception when sqlstate 'PT409' then null;
  end;
  if (select count(*) from public.task_events where task_id = v_task.id and event_type = 'DEADLINE_CHANGE_APPROVED') <> 1 then
    raise exception 'deadline resolution event was not exactly once';
  end if;

  select * into v_reassign_request from public.create_reassign_request_with_event(
    v_task.id, v_assignee, v_target, 'Balance workload'
  );
  begin
    perform public.resolve_reassign_request_with_events(v_reassign_request.id, v_unrelated, true, null);
    raise exception 'non-Head reassign resolution was accepted';
  exception when insufficient_privilege then null;
  end;
  perform public.resolve_reassign_request_with_events(v_reassign_request.id, v_head, true, 'Approved');
  begin
    perform public.resolve_reassign_request_with_events(v_reassign_request.id, v_head, false, null);
    raise exception 'reassign request resolved twice';
  exception when sqlstate 'PT409' then null;
  end;
  if (select assignee_id from public.tasks where id = v_task.id) <> v_target
    or (select count(*) from public.task_events where task_id = v_task.id and event_type = 'REASSIGN_APPROVED') <> 1 then
    raise exception 'approved reassignment did not update/event exactly once';
  end if;

  begin
    perform public.archive_task_with_event(v_archive_task.id, v_creator, null);
    raise exception 'non-Head archive was accepted';
  exception when insufficient_privilege then null;
  end;
  select * into v_archive from public.archive_task_with_event(v_archive_task.id, v_head, 'Cleanup');
  if v_archive.task_id <> v_archive_task.id
    or (select status from public.tasks where id = v_archive_task.id) <> v_archive_task.status then
    raise exception 'archive changed task identity or workflow status';
  end if;

  select count(*) into v_before_events from public.task_events where task_id = v_archive_task.id;
  perform public.archive_task_with_event(v_archive_task.id, v_head, 'Retry');
  select count(*) into v_after_events from public.task_events where task_id = v_archive_task.id;
  if v_after_events <> v_before_events then raise exception 'archive retry duplicated history'; end if;

  begin
    perform public.change_task_deadline_with_event(
      v_archive_task.id, statement_timestamp() + interval '20 days', v_head
    );
    raise exception 'archived task mutation was accepted';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    delete from public.tasks where id = v_archive_task.id;
    raise exception 'hard task delete was accepted';
  exception when sqlstate 'PT409' then null;
  end;

  perform public.restore_task_with_event(v_archive_task.id, v_head);
  if not exists (select 1 from public.tasks where id = v_archive_task.id and status = v_archive_task.status)
    or exists (select 1 from public.task_archives where task_id = v_archive_task.id)
    or (select count(*) from public.task_events where task_id = v_archive_task.id and event_type = 'TASK_ARCHIVED') <> 1
    or (select count(*) from public.task_events where task_id = v_archive_task.id and event_type = 'TASK_RESTORED') <> 1 then
    raise exception 'restore did not preserve the same task/status/history';
  end if;

  insert into public.task_notification_deliveries (dedupe_key, recipient_user_id)
  values ('TEST:' || v_task.id, v_assignee);
  begin
    insert into public.task_notification_deliveries (dedupe_key, recipient_user_id)
    values ('TEST:' || v_task.id, v_assignee);
    raise exception 'notification retry acquired a duplicate delivery claim';
  exception when unique_violation then null;
  end;

  raise notice 'PASS Sprint 10B permission, request, archive, and notification contract';
end;
$$;

rollback;
