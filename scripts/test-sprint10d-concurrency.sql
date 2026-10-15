\set ON_ERROR_STOP on

create extension if not exists dblink;

create table public.sprint10d_race_ids (
  key text primary key,
  value uuid not null
);

create function public.sprint10d_try_archive(p_task_id uuid, p_head_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_sleep(0.5);
  perform public.archive_task_with_event(p_task_id, p_head_id, 'Race');
  return 'ARCHIVED';
exception when others then return sqlstate;
end;
$$;

create function public.sprint10d_try_resolve(
  p_request_id uuid,
  p_head_id uuid,
  p_approve boolean
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
  from public.resolve_deadline_change_request_with_events(
    p_request_id, p_head_id, p_approve, null
  );
  return v_result.status;
exception when others then return sqlstate;
end;
$$;

create function public.sprint10d_try_create_request(
  p_task_id uuid,
  p_assignee_id uuid
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
  from public.create_deadline_change_request_with_event(
    p_task_id,
    p_assignee_id,
    statement_timestamp() + interval '20 days',
    'Race'
  );
  return v_result.status;
exception when others then return sqlstate;
end;
$$;

create function public.sprint10d_try_complete_blog(
  p_blog_task_id uuid,
  p_author_id uuid,
  p_reviewer_id uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_review_id uuid;
begin
  perform pg_catalog.pg_sleep(0.5);
  select head_review_task_id into v_review_id
  from public.content_os_complete_blog_with_head_review(
    p_blog_task_id,
    p_author_id,
    p_reviewer_id,
    statement_timestamp() + interval '20 days',
    'Concurrent Head Review',
    repeat('c', 64)
  );
  return v_review_id::text;
exception when others then return sqlstate;
end;
$$;

create function public.sprint10d_try_claim_outbox(p_worker_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_catalog.pg_sleep(0.5);
  select id into v_id from public.claim_task_notification_outbox(p_worker_id, 1);
  return coalesce(v_id::text, 'NONE');
exception when others then return sqlstate;
end;
$$;

do $fixtures$
declare
  v_head uuid := 'd1000000-0000-4000-8000-000000000001';
  v_creator uuid := 'd1000000-0000-4000-8000-000000000002';
  v_assignee uuid := 'd1000000-0000-4000-8000-000000000003';
  v_reviewer uuid := 'd1000000-0000-4000-8000-000000000004';
  v_approve_task public.tasks;
  v_reject_task public.tasks;
  v_create_task public.tasks;
  v_notify_task public.tasks;
  v_approve_request public.deadline_change_requests;
  v_reject_request public.deadline_change_requests;
  v_domain uuid;
  v_category uuid;
  v_part uuid;
  v_node uuid;
  v_blog_entity uuid;
  v_blog_type uuid;
  v_blog_version uuid;
  v_review_type uuid;
  v_review_version uuid;
  v_blog public.tasks;
  v_outbox_id uuid;
  v_connection text := format('dbname=%s user=%s', current_database(), current_user);
begin
  insert into public.users (id, telegram_user_id, display_name, role, is_active)
  values
    (v_head, 960000001, 'Race Head', 'HEAD_OF_MARKETING', true),
    (v_creator, 960000002, 'Race Creator', 'CONTENT_MARKETER', true),
    (v_assignee, 960000003, 'Race Assignee', 'OPERATOR_VIDEO_EDITOR', true),
    (v_reviewer, 960000004, 'Race Reviewer', 'SEO_SPECIALIST', true);

  select * into v_approve_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Archive vs approve', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  select * into v_approve_request from public.create_deadline_change_request_with_event(
    v_approve_task.id, v_assignee,
    statement_timestamp() + interval '11 days', 'Approve race'
  );

  select * into v_reject_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Archive vs reject', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  select * into v_reject_request from public.create_deadline_change_request_with_event(
    v_reject_task.id, v_assignee,
    statement_timestamp() + interval '11 days', 'Reject race'
  );

  select * into v_create_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Archive vs create', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );

  insert into public.content_domains (name) values ('Sprint 10D races') returning id into v_domain;
  insert into public.content_problem_categories (domain_id, name)
  values (v_domain, 'Race') returning id into v_category;
  insert into public.content_problem_parts (problem_category_id, name)
  values (v_category, 'Race') returning id into v_part;
  insert into public.content_knowledge_nodes (problem_part_id, name)
  values (v_part, 'Race') returning id into v_node;
  insert into public.content_blogs (knowledge_node_id, title)
  values (v_node, 'Concurrent Blog') returning id into v_blog_entity;
  insert into public.content_task_types (code) values ('BLOG') returning id into v_blog_type;
  insert into public.content_task_type_versions (
    task_type_id, version, name, definition, review_required
  ) values (v_blog_type, 1, 'Blog', '{}'::jsonb, false) returning id into v_blog_version;
  update public.content_task_types set current_version_id = v_blog_version where id = v_blog_type;
  insert into public.content_task_types (code) values ('HEAD_REVIEW') returning id into v_review_type;
  insert into public.content_task_type_versions (
    task_type_id, version, name, definition, review_required
  ) values (v_review_type, 1, 'Head Review', '{}'::jsonb, false) returning id into v_review_version;
  update public.content_task_types set current_version_id = v_review_version where id = v_review_type;
  select * into v_blog from public.create_task_with_event_v2(
    v_creator, v_creator, 'Concurrent Blog', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  insert into public.content_task_runtime (task_id, task_type_version_id)
  values (v_blog.id, v_blog_version);
  insert into public.content_task_links (task_id, entity_type, entity_id, relation)
  values (v_blog.id, 'BLOG', v_blog_entity, 'PRIMARY');

  update public.task_notification_deliveries
  set status = 'SENT', sent_at = statement_timestamp(), completed_at = statement_timestamp(),
      lease_expires_at = null, worker_id = null
  where status <> 'SENT';
  select * into v_notify_task from public.create_task_with_event_v2(
    v_creator, v_assignee, 'Outbox race', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  perform public.change_task_deadline_with_event(
    v_notify_task.id, statement_timestamp() + interval '12 days', v_creator
  );
  select id into v_outbox_id
  from public.task_notification_deliveries where status = 'PENDING'
  order by created_at, id limit 1;

  insert into public.sprint10d_race_ids (key, value) values
    ('approve_task', v_approve_task.id),
    ('approve_request', v_approve_request.id),
    ('reject_task', v_reject_task.id),
    ('reject_request', v_reject_request.id),
    ('create_task', v_create_task.id),
    ('blog', v_blog.id),
    ('outbox', v_outbox_id),
    ('head', v_head),
    ('creator', v_creator),
    ('assignee', v_assignee),
    ('reviewer', v_reviewer);

  perform dblink_connect('archive_approve', v_connection);
  perform dblink_connect('resolve_approve', v_connection);
  perform dblink_connect('archive_reject', v_connection);
  perform dblink_connect('resolve_reject', v_connection);
  perform dblink_connect('archive_create', v_connection);
  perform dblink_connect('request_create', v_connection);
  perform dblink_connect('blog_one', v_connection);
  perform dblink_connect('blog_two', v_connection);
  perform dblink_connect('outbox_one', v_connection);
  perform dblink_connect('outbox_two', v_connection);

  perform dblink_send_query('archive_approve', format(
    'select public.sprint10d_try_archive(%L::uuid,%L::uuid)', v_approve_task.id, v_head
  ));
  perform dblink_send_query('resolve_approve', format(
    'select public.sprint10d_try_resolve(%L::uuid,%L::uuid,true)', v_approve_request.id, v_head
  ));
  perform dblink_send_query('archive_reject', format(
    'select public.sprint10d_try_archive(%L::uuid,%L::uuid)', v_reject_task.id, v_head
  ));
  perform dblink_send_query('resolve_reject', format(
    'select public.sprint10d_try_resolve(%L::uuid,%L::uuid,false)', v_reject_request.id, v_head
  ));
  perform dblink_send_query('archive_create', format(
    'select public.sprint10d_try_archive(%L::uuid,%L::uuid)', v_create_task.id, v_head
  ));
  perform dblink_send_query('request_create', format(
    'select public.sprint10d_try_create_request(%L::uuid,%L::uuid)', v_create_task.id, v_assignee
  ));
  perform dblink_send_query('blog_one', format(
    'select public.sprint10d_try_complete_blog(%L::uuid,%L::uuid,%L::uuid)',
    v_blog.id, v_creator, v_reviewer
  ));
  perform dblink_send_query('blog_two', format(
    'select public.sprint10d_try_complete_blog(%L::uuid,%L::uuid,%L::uuid)',
    v_blog.id, v_creator, v_reviewer
  ));
  perform dblink_send_query('outbox_one', format(
    'select public.sprint10d_try_claim_outbox(%L::uuid)',
    'd2000000-0000-4000-8000-000000000001'
  ));
  perform dblink_send_query('outbox_two', format(
    'select public.sprint10d_try_claim_outbox(%L::uuid)',
    'd2000000-0000-4000-8000-000000000002'
  ));
end
$fixtures$;

checkpoint;

do $assertions$
declare
  v_archive_approve text;
  v_resolve_approve text;
  v_archive_reject text;
  v_resolve_reject text;
  v_archive_create text;
  v_request_create text;
  v_blog_one text;
  v_blog_two text;
  v_outbox_one text;
  v_outbox_two text;
  v_task uuid;
  v_request uuid;
  v_outbox uuid;
begin
  select result into v_archive_approve from dblink_get_result('archive_approve') as t(result text);
  select result into v_resolve_approve from dblink_get_result('resolve_approve') as t(result text);
  select result into v_archive_reject from dblink_get_result('archive_reject') as t(result text);
  select result into v_resolve_reject from dblink_get_result('resolve_reject') as t(result text);
  select result into v_archive_create from dblink_get_result('archive_create') as t(result text);
  select result into v_request_create from dblink_get_result('request_create') as t(result text);
  select result into v_blog_one from dblink_get_result('blog_one') as t(result text);
  select result into v_blog_two from dblink_get_result('blog_two') as t(result text);
  select result into v_outbox_one from dblink_get_result('outbox_one') as t(result text);
  select result into v_outbox_two from dblink_get_result('outbox_two') as t(result text);

  if v_archive_approve <> 'ARCHIVED' or v_resolve_approve not in ('APPROVED', 'PT409') then
    raise exception 'archive/approve race was incoherent: %, %', v_archive_approve, v_resolve_approve;
  end if;
  select value into v_task from public.sprint10d_race_ids where key = 'approve_task';
  select value into v_request from public.sprint10d_race_ids where key = 'approve_request';
  if not exists (select 1 from public.task_archives where task_id = v_task)
    or (select status from public.deadline_change_requests where id = v_request) not in ('APPROVED', 'CANCELLED')
    or (select count(*) from public.task_events where task_id = v_task
      and event_type in ('DEADLINE_CHANGE_APPROVED', 'DEADLINE_CHANGE_CANCELLED')) <> 1 then
    raise exception 'archive/approve final state or audit is incoherent';
  end if;
  if (select status from public.deadline_change_requests where id = v_request) = 'APPROVED'
    and (select count(*)
      from public.task_notification_deliveries delivery
      join public.task_events event on event.id = delivery.task_event_id
      where event.task_id = v_task
        and event.event_type = 'DEADLINE_CHANGE_APPROVED'
        and delivery.event_type = 'DEADLINE_CHANGE_APPROVED') <> 1 then
    raise exception 'approve-race winner did not create exactly one notification intent';
  end if;
  if (select status from public.deadline_change_requests where id = v_request) = 'CANCELLED'
    and exists (
      select 1
      from public.task_notification_deliveries delivery
      join public.task_events event on event.id = delivery.task_event_id
      where event.task_id = v_task
        and delivery.event_type = 'DEADLINE_CHANGE_APPROVED'
    ) then
    raise exception 'losing approve race created a notification intent';
  end if;

  if v_archive_reject <> 'ARCHIVED' or v_resolve_reject not in ('REJECTED', 'PT409') then
    raise exception 'archive/reject race was incoherent: %, %', v_archive_reject, v_resolve_reject;
  end if;
  select value into v_task from public.sprint10d_race_ids where key = 'reject_task';
  select value into v_request from public.sprint10d_race_ids where key = 'reject_request';
  if not exists (select 1 from public.task_archives where task_id = v_task)
    or (select status from public.deadline_change_requests where id = v_request) not in ('REJECTED', 'CANCELLED')
    or (select count(*) from public.task_events where task_id = v_task
      and event_type in ('DEADLINE_CHANGE_REJECTED', 'DEADLINE_CHANGE_CANCELLED')) <> 1 then
    raise exception 'archive/reject final state or audit is incoherent';
  end if;
  if (select status from public.deadline_change_requests where id = v_request) = 'REJECTED'
    and (select count(*)
      from public.task_notification_deliveries delivery
      join public.task_events event on event.id = delivery.task_event_id
      where event.task_id = v_task
        and event.event_type = 'DEADLINE_CHANGE_REJECTED'
        and delivery.event_type = 'DEADLINE_CHANGE_REJECTED') <> 1 then
    raise exception 'reject-race winner did not create exactly one notification intent';
  end if;
  if (select status from public.deadline_change_requests where id = v_request) = 'CANCELLED'
    and exists (
      select 1
      from public.task_notification_deliveries delivery
      join public.task_events event on event.id = delivery.task_event_id
      where event.task_id = v_task
        and delivery.event_type = 'DEADLINE_CHANGE_REJECTED'
    ) then
    raise exception 'losing reject race created a notification intent';
  end if;

  select value into v_task from public.sprint10d_race_ids where key = 'create_task';
  if v_archive_create <> 'ARCHIVED' or v_request_create not in ('PENDING', 'PT409')
    or not exists (select 1 from public.task_archives where task_id = v_task)
    or exists (select 1 from public.deadline_change_requests where task_id = v_task and status = 'PENDING') then
    raise exception 'archive/request-create race left pending work: %, %', v_archive_create, v_request_create;
  end if;

  if v_blog_one <> v_blog_two or v_blog_one in ('PT409', '42501') then
    raise exception 'concurrent Blog completion did not return the same review: %, %', v_blog_one, v_blog_two;
  end if;
  select value into v_task from public.sprint10d_race_ids where key = 'blog';
  if (select status from public.tasks where id = v_task) <> 'DONE'
    or (select count(*) from public.content_task_runtime runtime
      join public.content_task_type_versions version on version.id = runtime.task_type_version_id
      join public.content_task_types task_type on task_type.id = version.task_type_id
      where runtime.source_task_id = v_task and task_type.code = 'HEAD_REVIEW') <> 1 then
    raise exception 'concurrent Blog completion duplicated or omitted its Head Review';
  end if;

  select value into v_outbox from public.sprint10d_race_ids where key = 'outbox';
  if (select count(*) from unnest(array[v_outbox_one, v_outbox_two]) result
      where result = v_outbox::text) <> 1
    or (select count(*) from unnest(array[v_outbox_one, v_outbox_two]) result
      where result = 'NONE') <> 1
    or (select attempts from public.task_notification_deliveries where id = v_outbox) <> 1 then
    raise exception 'concurrent workers did not lease one outbox row exactly once: %, %', v_outbox_one, v_outbox_two;
  end if;

  perform dblink_disconnect('archive_approve');
  perform dblink_disconnect('resolve_approve');
  perform dblink_disconnect('archive_reject');
  perform dblink_disconnect('resolve_reject');
  perform dblink_disconnect('archive_create');
  perform dblink_disconnect('request_create');
  perform dblink_disconnect('blog_one');
  perform dblink_disconnect('blog_two');
  perform dblink_disconnect('outbox_one');
  perform dblink_disconnect('outbox_two');

  raise notice 'PASS Sprint 10D archive/request, Blog completion, and outbox concurrency';
end
$assertions$;

drop function public.sprint10d_try_archive(uuid, uuid);
drop function public.sprint10d_try_resolve(uuid, uuid, boolean);
drop function public.sprint10d_try_create_request(uuid, uuid);
drop function public.sprint10d_try_complete_blog(uuid, uuid, uuid);
drop function public.sprint10d_try_claim_outbox(uuid);
drop table public.sprint10d_race_ids;
