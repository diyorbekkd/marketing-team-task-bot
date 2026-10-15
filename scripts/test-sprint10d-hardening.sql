\set ON_ERROR_STOP on

begin;
set local role service_role;

do $sprint10d$
declare
  v_head uuid := 'c1000000-0000-4000-8000-000000000001';
  v_author uuid := 'c1000000-0000-4000-8000-000000000002';
  v_reviewer uuid := 'c1000000-0000-4000-8000-000000000003';
  v_other uuid := 'c1000000-0000-4000-8000-000000000004';
  v_inactive uuid := 'c1000000-0000-4000-8000-000000000005';
  v_domain uuid;
  v_category uuid;
  v_part uuid;
  v_node uuid;
  v_blog_entity_one uuid;
  v_blog_entity_two uuid;
  v_blog_type uuid;
  v_blog_version uuid;
  v_review_type uuid;
  v_review_version uuid;
  v_manual public.tasks;
  v_blog public.tasks;
  v_blog_two public.tasks;
  v_request_task public.tasks;
  v_notify_task public.tasks;
  v_review_id uuid;
  v_review_two_id uuid;
  v_created boolean;
  v_deadline_request public.deadline_change_requests;
  v_reassign_request public.reassign_requests;
  v_count bigint;
  v_before bigint;
  v_after bigint;
  v_status text;
  v_display_code text;
  v_status_code text;
  v_cleanup_id uuid := 'c2000000-0000-4000-8000-000000000001';
  v_worker uuid := 'c3000000-0000-4000-8000-000000000001';
  v_delivery_id uuid;
  v_claimed_id uuid;
  v_attempts integer;
  v_first_deadline timestamptz := statement_timestamp() + interval '20 days';
  v_second_deadline timestamptz := statement_timestamp() + interval '21 days';
  v_third_deadline timestamptz := statement_timestamp() + interval '22 days';
  i integer;
begin
  if not (
    select c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'task_notification_deliveries'
  ) then
    raise exception 'notification outbox does not have RLS enabled';
  end if;
  if has_table_privilege('anon', 'public.task_notification_deliveries', 'SELECT')
    or has_table_privilege('authenticated', 'public.task_notification_deliveries', 'SELECT')
    or has_table_privilege('service_role', 'public.task_notification_deliveries', 'DELETE') then
    raise exception 'notification outbox grants are not least privilege';
  end if;
  if has_function_privilege(
      'anon',
      'public.content_os_complete_blog_with_head_review(uuid,uuid,uuid,timestamptz,text,text)',
      'EXECUTE'
    ) or not has_function_privilege(
      'service_role',
      'public.content_os_complete_blog_with_head_review(uuid,uuid,uuid,timestamptz,text,text)',
      'EXECUTE'
    ) then
    raise exception 'dedicated Blog completion RPC privileges are incorrect';
  end if;

  insert into public.users (
    id, telegram_user_id, display_name, role, is_active, deactivated_at
  ) values
    (v_head, 950000001, 'Head', 'HEAD_OF_MARKETING', true, null),
    (v_author, 950000002, 'Author A', 'CONTENT_MARKETER', true, null),
    (v_reviewer, 950000003, 'Reviewer B', 'DIGITAL_MARKETER', true, null),
    (v_other, 950000004, 'Other', 'SEO_SPECIALIST', true, null),
    (v_inactive, 950000005, 'Inactive', 'SMM_MANAGER', false, statement_timestamp());

  insert into public.content_domains (name) values ('Sprint 10D') returning id into v_domain;
  insert into public.content_problem_categories (domain_id, name)
  values (v_domain, 'Workflow security') returning id into v_category;
  insert into public.content_problem_parts (problem_category_id, name)
  values (v_category, 'Blog review') returning id into v_part;
  insert into public.content_knowledge_nodes (problem_part_id, name)
  values (v_part, 'Hardening') returning id into v_node;
  insert into public.content_blogs (knowledge_node_id, title)
  values (v_node, 'Blog One') returning id into v_blog_entity_one;
  insert into public.content_blogs (knowledge_node_id, title)
  values (v_node, 'Blog Two') returning id into v_blog_entity_two;

  insert into public.content_task_types (code) values ('BLOG') returning id into v_blog_type;
  insert into public.content_task_type_versions (
    task_type_id, version, name, definition, review_required
  ) values (
    v_blog_type, 1, 'Blog', '{}'::jsonb, false
  ) returning id into v_blog_version;
  update public.content_task_types set current_version_id = v_blog_version where id = v_blog_type;

  insert into public.content_task_types (code) values ('HEAD_REVIEW') returning id into v_review_type;
  insert into public.content_task_type_versions (
    task_type_id, version, name, definition, review_required
  ) values (
    v_review_type, 1, 'Head Review', '{}'::jsonb, false
  ) returning id into v_review_version;
  update public.content_task_types set current_version_id = v_review_version where id = v_review_type;

  -- Manual creator behavior remains the Sprint 10B contract.
  select * into v_manual from public.create_task_with_event_v2(
    v_author, v_reviewer, 'Manual task', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  perform public.update_task_content_with_events(
    v_manual.id, v_author, 'Manual task edited', '', 'high'
  );
  perform public.change_task_deadline_with_event(
    v_manual.id, statement_timestamp() + interval '11 days', v_author
  );
  perform public.reassign_task_with_event(v_manual.id, v_other, v_author);

  -- Fresh Content OS Blog: the generic DONE path is closed and cannot leave
  -- a DONE Blog without a Head Review.
  select * into v_blog from public.create_task_with_event_v2(
    v_author, v_author, 'Blog One', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  insert into public.content_task_runtime (task_id, task_type_version_id)
  values (v_blog.id, v_blog_version);
  insert into public.content_task_links (task_id, entity_type, entity_id, relation)
  values
    (v_blog.id, 'BLOG', v_blog_entity_one, 'PRIMARY'),
    (v_blog.id, 'KNOWLEDGE_NODE', v_node, 'RELATED');

  begin
    perform public.transition_task_with_events(v_blog.id, v_author, 'DONE', null);
    raise exception 'generic Blog completion bypass remained open';
  exception when sqlstate 'PT409' then null;
  end;
  if (select status from public.tasks where id = v_blog.id) <> 'IN_PROGRESS'
    or exists (select 1 from public.content_task_runtime where source_task_id = v_blog.id) then
    raise exception 'refused generic Blog completion changed state or created a review';
  end if;

  begin
    perform public.content_os_complete_blog_with_head_review(
      v_blog.id,
      v_author,
      v_author,
      statement_timestamp() + interval '12 days',
      'Self Review - Blog One',
      repeat('f', 64)
    );
    raise exception 'Blog author was assigned to review their own Blog';
  exception when insufficient_privilege then null;
  end;
  if (select status from public.tasks where id = v_blog.id) <> 'IN_PROGRESS'
    or exists (select 1 from public.content_task_runtime where source_task_id = v_blog.id) then
    raise exception 'refused self-review assignment changed Blog/review state';
  end if;

  select head_review_task_id, head_review_created
  into v_review_id, v_created
  from public.content_os_complete_blog_with_head_review(
    v_blog.id,
    v_author,
    v_reviewer,
    statement_timestamp() + interval '12 days',
    'Head Review - Blog One',
    repeat('a', 64)
  );
  if not v_created
    or (select status from public.tasks where id = v_blog.id) <> 'DONE'
    or (select count(*) from public.content_task_runtime where source_task_id = v_blog.id) <> 1
    or not public.content_os_is_source_blog_for_head_review(v_blog.id, v_review_id) then
    raise exception 'dedicated Blog completion did not atomically create exactly one Head Review';
  end if;

  select count(*) into v_before from public.task_events
  where task_id = v_blog.id and event_type = 'TASK_COMPLETED';
  perform public.content_os_complete_blog_with_head_review(
    v_blog.id,
    v_author,
    v_other,
    statement_timestamp() + interval '20 days',
    'Ignored retry values',
    repeat('a', 64)
  );
  select count(*) into v_after from public.task_events
  where task_id = v_blog.id and event_type = 'TASK_COMPLETED';
  if v_before <> 1 or v_after <> v_before
    or (select count(*) from public.content_task_runtime where source_task_id = v_blog.id) <> 1 then
    raise exception 'Blog completion response retry duplicated state, review, or events';
  end if;

  -- HIGH-1 regression: Author A cannot take Reviewer B's review, move its
  -- lifecycle, or approve it merely because creator_id = A.
  begin
    perform public.reassign_task_with_event(v_review_id, v_author, v_author);
    raise exception 'Blog author directly reassigned their Head Review';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_task_content_with_events(
      v_review_id, v_author, 'Author-edited review', '', 'high'
    );
    raise exception 'Blog author edited their Head Review';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.change_task_deadline_with_event(
      v_review_id, statement_timestamp() + interval '30 days', v_author
    );
    raise exception 'Blog author directly changed their Head Review deadline';
  exception when insufficient_privilege then null;
  end;
  -- Source authorship never turns into reviewer authority. Sprint 10E also
  -- prevents constructing the historical bad assignment itself.
  begin
    update public.tasks set assignee_id = v_author where id = v_review_id;
    raise exception 'Blog author became their own Head Review assignee';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.transition_task_with_events(v_review_id, v_author, 'CANCELLED', null);
    raise exception 'Blog author cancelled their Head Review';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.transition_task_with_events(v_review_id, v_author, 'DONE', null);
    raise exception 'Blog author approved their own Head Review';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.transition_task_with_events(v_review_id, v_other, 'REVIEW', null);
    raise exception 'unrelated member moved a Head Review';
  exception when insufficient_privilege then null;
  end;

  perform public.transition_task_with_events(v_review_id, v_reviewer, 'REVIEW', null);
  perform public.transition_task_with_events(v_review_id, v_reviewer, 'DONE', null);
  if (select status from public.tasks where id = v_review_id) <> 'DONE' then
    raise exception 'assigned reviewer could not complete the Head Review';
  end if;
  if not exists (
    select 1 from public.task_notification_deliveries delivery
    where delivery.event_type = 'TASK_COMPLETED'
      and delivery.recipient_user_id = v_author
      and delivery.task_event_id in (
        select id from public.task_events
        where task_id = v_review_id and event_type = 'TASK_COMPLETED'
      )
  ) then
    raise exception 'Head Review approval did not enqueue the author notification';
  end if;

  -- Second pair exercises revision, resubmission, archive guards, and the
  -- same-review invariant.
  select * into v_blog_two from public.create_task_with_event_v2(
    v_author, v_author, 'Blog Two', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  insert into public.content_task_runtime (task_id, task_type_version_id)
  values (v_blog_two.id, v_blog_version);
  insert into public.content_task_links (task_id, entity_type, entity_id, relation)
  values
    (v_blog_two.id, 'BLOG', v_blog_entity_two, 'PRIMARY'),
    (v_blog_two.id, 'KNOWLEDGE_NODE', v_node, 'RELATED');
  select head_review_task_id into v_review_two_id
  from public.content_os_complete_blog_with_head_review(
    v_blog_two.id,
    v_author,
    v_reviewer,
    statement_timestamp() + interval '12 days',
    'Head Review - Blog Two',
    repeat('b', 64)
  );
  begin
    perform public.archive_task_with_event(v_blog_two.id, v_head, null);
    raise exception 'Blog with an active Head Review was archived';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.archive_task_with_event(v_review_two_id, v_head, null);
    raise exception 'active Head Review was archived';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.transition_task_with_events(
    v_blog_two.id, v_reviewer, 'REVISION', 'Tighten the conclusion'
  );
  if (select status from public.tasks where id = v_blog_two.id) <> 'REVISION'
    or (select status from public.tasks where id = v_review_two_id) <> 'BLOCKED' then
    raise exception 'revision did not atomically park the same review';
  end if;
  if not exists (
    select 1 from public.task_notification_deliveries delivery
    where delivery.event_type = 'REVISION_REQUESTED'
      and delivery.recipient_user_id = v_author
      and delivery.task_event_id in (
        select id from public.task_events
        where task_id = v_blog_two.id and event_type = 'REVISION_REQUESTED'
      )
  ) then
    raise exception 'revision did not enqueue the Blog author notification';
  end if;
  begin
    perform public.archive_task_with_event(v_blog_two.id, v_head, null);
    raise exception 'active revision Blog was archived';
  exception when sqlstate 'PT409' then null;
  end;
  begin
    perform public.archive_task_with_event(v_review_two_id, v_head, null);
    raise exception 'active revision Head Review was archived';
  exception when sqlstate 'PT409' then null;
  end;

  perform public.content_os_complete_blog_with_head_review(
    v_blog_two.id,
    v_author,
    v_other,
    statement_timestamp() + interval '30 days',
    'Retry values ignored',
    repeat('b', 64)
  );
  if (select status from public.tasks where id = v_review_two_id) <> 'ASSIGNED'
    or (select count(*) from public.content_task_runtime where source_task_id = v_blog_two.id) <> 1 then
    raise exception 'Blog resubmission did not resume exactly the same review';
  end if;
  perform public.transition_task_with_events(v_review_two_id, v_reviewer, 'IN_PROGRESS', null);

  update public.users set is_active = false, deactivated_at = statement_timestamp()
  where id = v_reviewer;
  begin
    perform public.transition_task_with_events(v_review_two_id, v_reviewer, 'DONE', null);
    raise exception 'inactive reviewer completed a Head Review';
  exception when insufficient_privilege then null;
  end;
  update public.users set is_active = true, deactivated_at = null where id = v_reviewer;
  begin
    perform public.transition_task_with_events(v_review_two_id, v_head, 'DONE', null);
    raise exception 'non-assigned Head approved a Head Review';
  exception when insufficient_privilege then null;
  end;
  perform public.transition_task_with_events(v_review_two_id, v_reviewer, 'DONE', null);

  perform public.archive_task_with_event(v_blog_two.id, v_head, 'Completed cycle');
  update public.tasks set status = 'IN_PROGRESS', completed_at = null where id = v_review_two_id;
  begin
    perform public.transition_task_with_events(v_review_two_id, v_head, 'DONE', null);
    raise exception 'Head Review approved while its source Blog was archived';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.restore_task_with_event(v_blog_two.id, v_head);
  update public.tasks set status = 'DONE', completed_at = statement_timestamp() where id = v_review_two_id;
  perform public.archive_task_with_event(v_review_two_id, v_head, 'Completed review');
  perform public.archive_task_with_event(v_blog_two.id, v_head, 'Completed Blog');

  -- Archive atomically cancels both pending request kinds. Restore never
  -- resurrects them and later resolution cannot win.
  select * into v_request_task from public.create_task_with_event_v2(
    v_author, v_reviewer, 'Archive requests', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  select * into v_deadline_request from public.create_deadline_change_request_with_event(
    v_request_task.id,
    v_reviewer,
    statement_timestamp() + interval '15 days',
    'Need time'
  );
  select * into v_reassign_request from public.create_reassign_request_with_event(
    v_request_task.id,
    v_reviewer,
    v_other,
    'Balance work'
  );
  perform public.archive_task_with_event(v_request_task.id, v_head, 'Stop work');
  if (select status from public.deadline_change_requests where id = v_deadline_request.id) <> 'CANCELLED'
    or (select status from public.reassign_requests where id = v_reassign_request.id) <> 'CANCELLED'
    or (select count(*) from public.task_events where task_id = v_request_task.id and event_type = 'DEADLINE_CHANGE_CANCELLED') <> 1
    or (select count(*) from public.task_events where task_id = v_request_task.id and event_type = 'REASSIGN_CANCELLED') <> 1 then
    raise exception 'archive did not cancel and audit both pending request kinds';
  end if;
  perform public.restore_task_with_event(v_request_task.id, v_head);
  if (select status from public.deadline_change_requests where id = v_deadline_request.id) <> 'CANCELLED'
    or (select status from public.reassign_requests where id = v_reassign_request.id) <> 'CANCELLED' then
    raise exception 'restore resurrected a cancelled request';
  end if;
  begin
    perform public.resolve_deadline_change_request_with_events(
      v_deadline_request.id, v_head, true, null
    );
    raise exception 'cancelled deadline request was approved after restore';
  exception when sqlstate 'PT409' then null;
  end;
  perform public.archive_task_with_event(v_request_task.id, v_head, null);
  begin
    perform public.create_reassign_request_with_event(
      v_request_task.id, v_reviewer, v_author, 'Archived'
    );
    raise exception 'new request was created on an archived task';
  exception when sqlstate 'PT409' then null;
  end;

  -- Display code is shared by start/status, but cannot approve or redeem.
  select challenge_id, display_code into v_cleanup_id, v_display_code
  from public.content_os_auth_create_challenge(repeat('0', 64), repeat('1', 64));
  select status, display_code into v_status, v_status_code
  from public.content_os_auth_get_challenge_status(v_cleanup_id);
  if v_status <> 'PENDING' or v_display_code !~ '^[0-9]{6}$'
    or v_status_code <> v_display_code then
    raise exception 'login display code contract is inconsistent';
  end if;
  select status into v_status
  from public.content_os_auth_redeem_challenge(
    v_cleanup_id, repeat('f', 64), repeat('e', 64)
  );
  if v_status <> 'PENDING' then
    raise exception 'display-code-only challenge unexpectedly redeemed';
  end if;

  -- Three outstanding challenges per server-derived key; creation number six
  -- in a 15-minute window is refused even when earlier rows were cancelled.
  for i in 1..3 loop
    perform public.content_os_auth_create_challenge(
      lpad(to_hex(16 + i), 64, '0'), repeat('2', 64)
    );
  end loop;
  begin
    perform public.content_os_auth_create_challenge(repeat('3', 64), repeat('2', 64));
    raise exception 'outstanding challenge bound was not enforced';
  exception when sqlstate 'PT429' then null;
  end;

  for i in 1..5 loop
    select challenge_id into v_cleanup_id
    from public.content_os_auth_create_challenge(
      lpad(to_hex(32 + i), 64, '0'), repeat('6', 64)
    );
    perform public.content_os_auth_cancel_challenge(v_cleanup_id, 950000002);
  end loop;
  begin
    perform public.content_os_auth_create_challenge(repeat('7', 64), repeat('6', 64));
    raise exception '15-minute creation rate limit was not enforced';
  exception when sqlstate 'PT429' then null;
  end;

  v_cleanup_id := 'c2000000-0000-4000-8000-000000000001';
  insert into private.content_os_login_challenges (
    id, verifier_hash, rate_key_hash, display_code, status,
    created_at, expires_at, cancelled_at
  ) values (
    v_cleanup_id, repeat('8', 64), repeat('8', 64), '654321', 'CANCELLED',
    statement_timestamp() - interval '9 days',
    statement_timestamp() - interval '9 days' + interval '10 minutes',
    statement_timestamp() - interval '8 days'
  );
  perform public.content_os_auth_cleanup_challenges(500);
  if exists (select 1 from private.content_os_login_challenges where id = v_cleanup_id) then
    raise exception 'retained an old cancelled challenge beyond policy';
  end if;

  -- Durable outbox: the task event and intent commit together, an exact
  -- business retry reuses the same semantic row, a later event gets a new row,
  -- transient failure retries, an expired lease is reclaimed, and SENT is not
  -- claimed again.
  update public.task_notification_deliveries
  set status = 'SENT', sent_at = statement_timestamp(), completed_at = statement_timestamp(),
      lease_expires_at = null, worker_id = null
  where status <> 'SENT';

  select * into v_notify_task from public.create_task_with_event_v2(
    v_author, v_reviewer, 'Notify task', '', 'normal',
    statement_timestamp() + interval '19 days', null, null, null
  );
  perform public.change_task_deadline_with_event(v_notify_task.id, v_first_deadline, v_author);
  select count(*) into v_before
  from public.task_notification_deliveries delivery
  where delivery.recipient_user_id = v_reviewer
    and delivery.event_type = 'DEADLINE_CHANGED'
    and delivery.task_event_id in (
      select id from public.task_events
      where task_id = v_notify_task.id and event_type = 'DEADLINE_CHANGED'
    );
  perform public.change_task_deadline_with_event(v_notify_task.id, v_first_deadline, v_author);
  select count(*) into v_after
  from public.task_notification_deliveries delivery
  where delivery.recipient_user_id = v_reviewer
    and delivery.event_type = 'DEADLINE_CHANGED'
    and delivery.task_event_id in (
      select id from public.task_events
      where task_id = v_notify_task.id and event_type = 'DEADLINE_CHANGED'
    );
  if v_before <> 1 or v_after <> v_before then
    raise exception 'exact deadline business retry duplicated its notification intent';
  end if;
  perform public.change_task_deadline_with_event(v_notify_task.id, v_second_deadline, v_author);
  select count(*) into v_after
  from public.task_notification_deliveries delivery
  where delivery.recipient_user_id = v_reviewer
    and delivery.event_type = 'DEADLINE_CHANGED'
    and delivery.task_event_id in (
      select id from public.task_events
      where task_id = v_notify_task.id and event_type = 'DEADLINE_CHANGED'
    );
  if v_after <> 2 then
    raise exception 'later legitimate deadline change did not enqueue a new notification';
  end if;

  select id into v_delivery_id
  from public.task_notification_deliveries delivery
  where delivery.recipient_user_id = v_reviewer
    and delivery.event_type = 'DEADLINE_CHANGED'
    and delivery.status = 'PENDING'
  order by delivery.created_at, delivery.id
  limit 1;
  update public.task_notification_deliveries
  set status = 'SENT', sent_at = statement_timestamp(), completed_at = statement_timestamp()
  where status = 'PENDING' and id <> v_delivery_id;

  select id, attempts into v_claimed_id, v_attempts
  from public.claim_task_notification_outbox(v_worker, 1);
  if v_claimed_id <> v_delivery_id or v_attempts <> 1 then
    raise exception 'first outbox lease did not claim the expected row';
  end if;
  perform public.complete_task_notification_outbox(
    v_delivery_id, v_worker, false, 'sanitized transient failure'
  );
  if (select status from public.task_notification_deliveries where id = v_delivery_id) <> 'PENDING' then
    raise exception 'transient notification failure did not return to PENDING';
  end if;
  update public.task_notification_deliveries
  set next_attempt_at = statement_timestamp() - interval '1 second'
  where id = v_delivery_id;
  select id, attempts into v_claimed_id, v_attempts
  from public.claim_task_notification_outbox(v_worker, 1);
  if v_claimed_id <> v_delivery_id or v_attempts <> 2 then
    raise exception 'notification retry did not reuse the same row';
  end if;

  -- Simulate worker loss after an ambiguous external response. Lease recovery
  -- reuses the same semantic row; Telegram itself has no exactly-once key.
  update public.task_notification_deliveries
  set lease_expires_at = statement_timestamp() - interval '1 second'
  where id = v_delivery_id;
  select id, attempts into v_claimed_id, v_attempts
  from public.claim_task_notification_outbox(v_worker, 1);
  if v_claimed_id <> v_delivery_id or v_attempts <> 3
    or (select count(*) from public.task_notification_deliveries where id = v_delivery_id) <> 1 then
    raise exception 'expired lease did not recover the same semantic row';
  end if;
  perform public.complete_task_notification_outbox(v_delivery_id, v_worker, true, null);
  if (select status from public.task_notification_deliveries where id = v_delivery_id) <> 'SENT'
    or exists (
      select 1 from public.claim_task_notification_outbox(v_worker, 100)
      where id = v_delivery_id
    ) then
    raise exception 'SENT notification was claimable again';
  end if;

  -- Fifth failed attempt is terminal FAILED/dead-letter, never an early fail.
  perform public.change_task_deadline_with_event(v_notify_task.id, v_third_deadline, v_author);
  select delivery.id into v_delivery_id
  from public.task_notification_deliveries delivery
  where delivery.recipient_user_id = v_reviewer
    and delivery.event_type = 'DEADLINE_CHANGED'
    and delivery.status = 'PENDING'
  order by delivery.created_at desc, delivery.id desc
  limit 1;
  for i in 1..5 loop
    select id, attempts into v_claimed_id, v_attempts
    from public.claim_task_notification_outbox(v_worker, 1);
    if v_claimed_id <> v_delivery_id or v_attempts <> i then
      raise exception 'bounded retry attempt % did not claim expected row', i;
    end if;
    perform public.complete_task_notification_outbox(
      v_delivery_id, v_worker, false, 'sanitized transient failure'
    );
    if i < 5 then
      if (select status from public.task_notification_deliveries where id = v_delivery_id) <> 'PENDING' then
        raise exception 'delivery dead-lettered before attempt five';
      end if;
      update public.task_notification_deliveries
      set next_attempt_at = statement_timestamp() - interval '1 second'
      where id = v_delivery_id;
    end if;
  end loop;
  if (select status from public.task_notification_deliveries where id = v_delivery_id) <> 'FAILED' then
    raise exception 'fifth failed attempt did not reach FAILED/dead-letter';
  end if;

  raise notice 'PASS Sprint 10D workflow/auth/outbox/archive hardening contract';
end
$sprint10d$;

rollback;
