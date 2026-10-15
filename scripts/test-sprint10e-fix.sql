\set ON_ERROR_STOP on

begin;
set local role service_role;

do $sprint10e$
declare
  v_head uuid := 'd1000000-0000-4000-8000-000000000001';
  v_author uuid := 'd1000000-0000-4000-8000-000000000002';
  v_reviewer uuid := 'd1000000-0000-4000-8000-000000000003';
  v_other uuid := 'd1000000-0000-4000-8000-000000000004';
  v_domain uuid;
  v_category uuid;
  v_part uuid;
  v_node uuid;
  v_blog_entity_head uuid;
  v_blog_entity_regular uuid;
  v_blog_type uuid;
  v_blog_version uuid;
  v_review_type uuid;
  v_review_version uuid;
  v_head_blog public.tasks;
  v_regular_blog public.tasks;
  v_manual public.tasks;
  v_head_review_id uuid;
  v_regular_review_id uuid;
  v_retry_review_id uuid;
  v_legacy_delivery_id uuid;
  v_pending_legacy_id uuid;
  v_worker uuid := 'd2000000-0000-4000-8000-000000000001';
  v_claimed_id uuid;
  v_completed_at timestamptz;
  v_deadline_request public.deadline_change_requests;
  v_reassign_request public.reassign_requests;
begin
  insert into public.users (
    id, telegram_user_id, display_name, role, is_active, deactivated_at
  ) values
    (v_head, 960000001, 'Head Author', 'HEAD_OF_MARKETING', true, null),
    (v_author, 960000002, 'Author', 'CONTENT_MARKETER', true, null),
    (v_reviewer, 960000003, 'Reviewer', 'DIGITAL_MARKETER', true, null),
    (v_other, 960000004, 'Other Reviewer', 'SEO_SPECIALIST', true, null);

  insert into public.content_domains (name) values ('Sprint 10E') returning id into v_domain;
  insert into public.content_problem_categories (domain_id, name)
  values (v_domain, 'Final policy') returning id into v_category;
  insert into public.content_problem_parts (problem_category_id, name)
  values (v_category, 'Independent review') returning id into v_part;
  insert into public.content_knowledge_nodes (problem_part_id, name)
  values (v_part, 'Authority') returning id into v_node;
  insert into public.content_blogs (knowledge_node_id, title)
  values (v_node, 'Head authored') returning id into v_blog_entity_head;
  insert into public.content_blogs (knowledge_node_id, title)
  values (v_node, 'Regular authored') returning id into v_blog_entity_regular;

  insert into public.content_task_types (code) values ('BLOG') returning id into v_blog_type;
  insert into public.content_task_type_versions (
    task_type_id, version, name, definition, review_required
  ) values (v_blog_type, 1, 'Blog', '{}'::jsonb, false)
  returning id into v_blog_version;
  update public.content_task_types set current_version_id = v_blog_version
  where id = v_blog_type;

  insert into public.content_task_types (code) values ('HEAD_REVIEW') returning id into v_review_type;
  insert into public.content_task_type_versions (
    task_type_id, version, name, definition, review_required
  ) values (v_review_type, 1, 'Head Review', '{}'::jsonb, false)
  returning id into v_review_version;
  update public.content_task_types set current_version_id = v_review_version
  where id = v_review_type;

  -- H-1: the old state mutation is still correctly refused, while the fixed
  -- inline completion produces a constraint-valid terminal row. An exact
  -- duplicate claim remains a no-op and no legacy row enters the event worker.
  select * into v_manual from public.create_task_with_event_v2(
    v_author, v_reviewer, 'Legacy assignment', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  insert into public.task_notification_deliveries (dedupe_key, recipient_user_id)
  values ('TASK_ASSIGNED:' || v_manual.id::text, v_reviewer)
  returning id into v_legacy_delivery_id;

  begin
    update public.task_notification_deliveries
    set status = 'SENT', completed_at = statement_timestamp()
    where id = v_legacy_delivery_id;
    raise exception 'legacy SENT without sent_at unexpectedly satisfied the state constraint';
  exception when check_violation then null;
  end;

  v_completed_at := statement_timestamp();
  update public.task_notification_deliveries
  set status = 'SENT', completed_at = v_completed_at, sent_at = v_completed_at,
      failure_reason = null
  where id = v_legacy_delivery_id;
  if not exists (
    select 1 from public.task_notification_deliveries
    where id = v_legacy_delivery_id
      and status = 'SENT'
      and sent_at = v_completed_at
      and completed_at = v_completed_at
      and task_event_id is null
  ) then
    raise exception 'fixed inline assignment did not persist a valid SENT row';
  end if;

  insert into public.task_notification_deliveries (dedupe_key, recipient_user_id)
  values ('TASK_ASSIGNED:' || v_manual.id::text, v_reviewer)
  on conflict (dedupe_key, recipient_user_id) do nothing;
  if (select count(*) from public.task_notification_deliveries
      where dedupe_key = 'TASK_ASSIGNED:' || v_manual.id::text
        and recipient_user_id = v_reviewer) <> 1 then
    raise exception 'exact legacy assignment retry duplicated its claim';
  end if;

  insert into public.task_notification_deliveries (dedupe_key, recipient_user_id)
  values ('TASK_ASSIGNED:PENDING:' || v_manual.id::text, v_reviewer)
  returning id into v_pending_legacy_id;
  select id into v_claimed_id
  from public.claim_task_notification_outbox(v_worker, 100)
  where id = v_pending_legacy_id;
  if v_claimed_id is not null
    or (select status from public.task_notification_deliveries
        where id = v_pending_legacy_id) <> 'PENDING' then
    raise exception 'legacy inline assignment row entered the event outbox';
  end if;

  -- Meaningful workflow notifications still enter the durable task-event
  -- outbox for direct changes and both shared request-resolution paths.
  perform public.reassign_task_with_event(v_manual.id, v_other, v_author);
  if not exists (
    select 1 from public.task_notification_deliveries delivery
    join public.task_events event on event.id = delivery.task_event_id
    where event.task_id = v_manual.id
      and event.event_type = 'ASSIGNEE_CHANGED'
      and delivery.event_type = 'TASK_REASSIGNED'
      and delivery.recipient_user_id = v_other
  ) then
    raise exception 'direct reassignment did not enqueue its durable intent';
  end if;

  perform public.change_task_deadline_with_event(
    v_manual.id, statement_timestamp() + interval '11 days', v_author
  );
  if not exists (
    select 1 from public.task_notification_deliveries delivery
    join public.task_events event on event.id = delivery.task_event_id
    where event.task_id = v_manual.id
      and event.event_type = 'DEADLINE_CHANGED'
      and delivery.event_type = 'DEADLINE_CHANGED'
      and delivery.recipient_user_id = v_other
  ) then
    raise exception 'direct deadline change did not enqueue its durable intent';
  end if;

  select * into v_deadline_request
  from public.create_deadline_change_request_with_event(
    v_manual.id, v_other, statement_timestamp() + interval '12 days', 'Need time'
  );
  perform public.resolve_deadline_change_request_with_events(
    v_deadline_request.id, v_head, true, null
  );
  if not exists (
    select 1 from public.task_notification_deliveries delivery
    join public.task_events event on event.id = delivery.task_event_id
    where event.task_id = v_manual.id
      and event.event_type = 'DEADLINE_CHANGE_APPROVED'
      and delivery.event_type = 'DEADLINE_CHANGE_APPROVED'
      and delivery.recipient_user_id = v_other
  ) then
    raise exception 'deadline-request resolution did not enqueue its durable intent';
  end if;

  select * into v_reassign_request
  from public.create_reassign_request_with_event(
    v_manual.id, v_other, v_reviewer, 'Return assignment'
  );
  perform public.resolve_reassign_request_with_events(
    v_reassign_request.id, v_head, true, null
  );
  if (select count(*) from public.task_notification_deliveries delivery
      join public.task_events event on event.id = delivery.task_event_id
      where event.task_id = v_manual.id
        and event.event_type = 'REASSIGN_APPROVED'
        and delivery.event_type = 'REASSIGN_APPROVED'
        and delivery.recipient_user_id in (v_other, v_reviewer)) <> 2 then
    raise exception 'reassign-request resolution did not enqueue both durable intents';
  end if;

  -- Head-authored Blog: Head cannot self-assign, decide, or become reviewer,
  -- but can select and administratively reassign to another valid reviewer.
  select * into v_head_blog from public.create_task_with_event_v2(
    v_head, v_head, 'Head-authored Blog', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  insert into public.content_task_runtime (task_id, task_type_version_id)
  values (v_head_blog.id, v_blog_version);
  insert into public.content_task_links (task_id, entity_type, entity_id, relation)
  values
    (v_head_blog.id, 'BLOG', v_blog_entity_head, 'PRIMARY'),
    (v_head_blog.id, 'KNOWLEDGE_NODE', v_node, 'RELATED');

  begin
    perform public.transition_task_with_events(v_head_blog.id, v_head, 'DONE', null);
    raise exception 'generic Blog DONE bypass remained open';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.content_os_complete_blog_with_head_review(
      v_head_blog.id, v_head, v_head,
      statement_timestamp() + interval '12 days',
      'Head self review', repeat('1', 64)
    );
    raise exception 'Head author assigned themselves as reviewer';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.tasks where id = v_head_blog.id) <> 'IN_PROGRESS'
    or exists (
      select 1 from public.content_task_runtime where source_task_id = v_head_blog.id
    ) then
    raise exception 'Head-author self-review refusal left partial state';
  end if;

  select head_review_task_id into v_head_review_id
  from public.content_os_complete_blog_with_head_review(
    v_head_blog.id, v_head, v_reviewer,
    statement_timestamp() + interval '12 days',
    'Independent Head Review', repeat('2', 64)
  );
  if public.content_os_head_review_source_author_id(v_head_review_id) <> v_head then
    raise exception 'Head Review source-author provenance lookup is wrong';
  end if;
  begin
    perform public.reassign_task_with_event(v_head_review_id, v_head, v_head);
    raise exception 'Head author reassigned their review to themselves';
  exception when insufficient_privilege then null;
  end;
  perform public.reassign_task_with_event(v_head_review_id, v_other, v_head);
  perform public.reassign_task_with_event(v_head_review_id, v_reviewer, v_head);
  begin
    perform public.content_os_request_head_review_revision(
      v_head_review_id, v_head, 'Head author must be denied'
    );
    raise exception 'Head author requested revision as supervisor';
  exception when insufficient_privilege then null;
  end;

  perform public.content_os_request_head_review_revision(
    v_head_review_id, v_reviewer, 'Independent revision'
  );
  begin
    perform public.content_os_request_head_review_revision(
      v_head_review_id, v_head, 'Unauthorized retry after reviewer decision'
    );
    raise exception 'Head author received revision authority from an existing state';
  exception when insufficient_privilege then null;
  end;
  perform public.content_os_complete_blog_with_head_review(
    v_head_blog.id, v_head, v_other,
    statement_timestamp() + interval '15 days',
    'Retry values ignored', repeat('2', 64)
  );
  select head_review_task_id into v_retry_review_id
  from public.content_os_complete_blog_with_head_review(
    v_head_blog.id, v_head, v_other,
    statement_timestamp() + interval '16 days',
    'Lost response retry', repeat('2', 64)
  );
  if v_retry_review_id <> v_head_review_id
    or (select count(*) from public.content_task_runtime
        where source_task_id = v_head_blog.id) <> 1 then
    raise exception 'resubmit/response-loss retry did not converge on one Head Review';
  end if;
  perform public.transition_task_with_events(v_head_review_id, v_reviewer, 'IN_PROGRESS', null);
  begin
    perform public.transition_task_with_events(v_head_review_id, v_head, 'DONE', null);
    raise exception 'Head author approved an independently assigned review';
  exception when insufficient_privilege then null;
  end;
  perform public.transition_task_with_events(v_head_review_id, v_reviewer, 'DONE', null);
  if not exists (
    select 1 from public.task_notification_deliveries delivery
    join public.task_events event on event.id = delivery.task_event_id
    where event.task_id = v_head_review_id
      and event.event_type = 'TASK_COMPLETED'
      and delivery.event_type = 'TASK_COMPLETED'
      and delivery.recipient_user_id = v_head
  ) then
    raise exception 'Head Review approval did not enqueue its durable intent';
  end if;

  -- Regular author: non-author Head may supervise revision, but cannot approve
  -- until Head is legitimately assigned as the independent reviewer.
  select * into v_regular_blog from public.create_task_with_event_v2(
    v_author, v_author, 'Regular Blog', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  insert into public.content_task_runtime (task_id, task_type_version_id)
  values (v_regular_blog.id, v_blog_version);
  insert into public.content_task_links (task_id, entity_type, entity_id, relation)
  values
    (v_regular_blog.id, 'BLOG', v_blog_entity_regular, 'PRIMARY'),
    (v_regular_blog.id, 'KNOWLEDGE_NODE', v_node, 'RELATED');
  select head_review_task_id into v_regular_review_id
  from public.content_os_complete_blog_with_head_review(
    v_regular_blog.id, v_author, v_reviewer,
    statement_timestamp() + interval '12 days',
    'Regular independent review', repeat('3', 64)
  );

  perform public.content_os_request_head_review_revision(
    v_regular_review_id, v_head, 'Supervisory revision'
  );
  if (select status from public.tasks where id = v_regular_blog.id) <> 'REVISION'
    or (select status from public.tasks where id = v_regular_review_id) <> 'BLOCKED' then
    raise exception 'non-author Head supervisory revision did not preserve coupled state';
  end if;
  if not exists (
    select 1 from public.task_notification_deliveries delivery
    join public.task_events event on event.id = delivery.task_event_id
    where event.task_id = v_regular_blog.id
      and event.event_type = 'REVISION_REQUESTED'
      and delivery.event_type = 'REVISION_REQUESTED'
      and delivery.recipient_user_id = v_author
  ) then
    raise exception 'revision did not enqueue its durable intent';
  end if;
  perform public.content_os_complete_blog_with_head_review(
    v_regular_blog.id, v_author, v_other,
    statement_timestamp() + interval '14 days',
    'Same review resubmit', repeat('3', 64)
  );
  perform public.transition_task_with_events(v_regular_review_id, v_reviewer, 'IN_PROGRESS', null);
  begin
    perform public.transition_task_with_events(v_regular_review_id, v_other, 'DONE', null);
    raise exception 'unrelated user approved a Head Review';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.transition_task_with_events(v_regular_review_id, v_head, 'DONE', null);
    raise exception 'non-assigned Head approved a Head Review';
  exception when insufficient_privilege then null;
  end;
  perform public.reassign_task_with_event(v_regular_review_id, v_head, v_head);
  perform public.transition_task_with_events(v_regular_review_id, v_head, 'DONE', null);
  if (select status from public.tasks where id = v_regular_review_id) <> 'DONE' then
    raise exception 'legitimately assigned independent Head could not approve';
  end if;

  raise notice 'PASS Sprint 10E H-1 and independent Head Review policy contract';
end
$sprint10e$;

rollback;
