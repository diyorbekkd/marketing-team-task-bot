-- LOCAL DRY-RUN ONLY. Run on a disposable PostgreSQL 17 database after all
-- Task Bot migrations and Content OS migrations 00..06.

drop schema if exists sprint9c cascade;
create schema sprint9c;

create function sprint9c.ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

create function sprint9c.try_transition(p_task uuid, p_actor uuid, p_to text, p_reason text default null)
returns text language plpgsql as $$
begin
  perform public.transition_task_with_events(p_task, p_actor, p_to, p_reason);
  return 'OK';
exception when others then
  return sqlstate;
end $$;

create table sprint9c.ids (key text primary key, value uuid not null);
create function sprint9c.id(p_key text)
returns uuid language sql stable as $$ select value from sprint9c.ids where key = p_key $$;
create function sprint9c.put(p_key text, p_value uuid)
returns uuid language sql as $$ insert into sprint9c.ids values (p_key, p_value) returning value $$;

-- Reuse an active Head if another dry-run already created one.
insert into public.users (telegram_user_id, display_name, role, is_active)
select 93001, 'Sprint 9C Head', 'HEAD_OF_MARKETING', true
where not exists (select 1 from public.users where role = 'HEAD_OF_MARKETING' and is_active)
on conflict (telegram_user_id) do nothing;
insert into public.users (telegram_user_id, display_name, role, is_active) values
  (93002, 'Sprint 9C Blog author', 'CONTENT_MARKETER', true),
  (93003, 'Sprint 9C reviewer', 'DIGITAL_MARKETER', true),
  (93004, 'Sprint 9C unrelated', 'SMM_MANAGER', true),
  (93005, 'Sprint 9C inactive reviewer', 'OPERATOR_VIDEO_EDITOR', true)
on conflict (telegram_user_id) do nothing;

select sprint9c.put('head', id) from public.users where role = 'HEAD_OF_MARKETING' and is_active order by created_at limit 1;
select sprint9c.put('author', id) from public.users where telegram_user_id = 93002;
select sprint9c.put('reviewer', id) from public.users where telegram_user_id = 93003;
select sprint9c.put('other', id) from public.users where telegram_user_id = 93004;
select sprint9c.put('inactive', id) from public.users where telegram_user_id = 93005;

create function sprint9c.task(p_key text, p_assignee_key text, p_title text default null)
returns uuid language plpgsql as $$
declare v_task uuid;
begin
  select id into v_task from public.create_task_with_event_v2(
    sprint9c.id('author'),
    sprint9c.id(p_assignee_key),
    coalesce(p_title, p_key),
    '',
    'normal',
    now() + interval '3 days'
  );
  return sprint9c.put(p_key, v_task);
end $$;

create function sprint9c.force(p_key text, p_status text)
returns void language sql as $$
  update public.tasks set
    status = p_status,
    blocked_reason = case when p_status = 'BLOCKED' then 'fixture blocked' end,
    completed_at = case when p_status = 'DONE' then now() end,
    cancelled_at = case when p_status = 'CANCELLED' then now() end
  where id = sprint9c.id(p_key)
$$;

create function sprint9c.version(p_code text, p_review_required boolean)
returns uuid language plpgsql as $$
declare
  v_type uuid;
  v_version uuid;
  v_number integer;
begin
  insert into public.content_task_types (code) values (p_code)
  on conflict (code) do update set code = excluded.code
  returning id into v_type;

  select id into v_version
  from public.content_task_type_versions
  where task_type_id = v_type and review_required = p_review_required
  order by version
  limit 1;

  if v_version is null then
    select coalesce(max(version), 0) + 1 into v_number
    from public.content_task_type_versions where task_type_id = v_type;
    insert into public.content_task_type_versions (task_type_id, version, name, definition, review_required)
    values (v_type, v_number, p_code || ' Sprint 9C', '{}', p_review_required)
    returning id into v_version;
  end if;
  return sprint9c.put('version_' || p_code || '_' || p_review_required::text, v_version);
end $$;

-- A test-only failure injector proves the coupled updates are atomic.
create table sprint9c.fail_updates (task_id uuid primary key, target_status text not null);
create function sprint9c.fail_selected_task_update()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from sprint9c.fail_updates
    where task_id = new.id and target_status = new.status
  ) then
    raise exception 'injected review update failure';
  end if;
  return new;
end $$;
create trigger sprint9c_fail_selected_task_update
before update on public.tasks
for each row execute function sprint9c.fail_selected_task_update();

grant usage on schema sprint9c to service_role;
grant select, insert on sprint9c.ids to service_role;
grant select on sprint9c.fail_updates to service_role;
grant execute on all functions in schema sprint9c to service_role;

select sprint9c.version('BLOG', false);
select sprint9c.version('HEAD_REVIEW', false);
select sprint9c.version('RESEARCH', false);
select sprint9c.version('REVIEW_REQUIRED', true);

-- Stable content entities used by PRIMARY-link provenance.
insert into public.content_domains (name) values ('Sprint 9C domain');
insert into public.content_problem_categories (domain_id, name)
select id, 'Sprint 9C category' from public.content_domains where name = 'Sprint 9C domain';
insert into public.content_problem_parts (problem_category_id, name)
select id, 'Sprint 9C part' from public.content_problem_categories where name = 'Sprint 9C category';
with inserted as (
  insert into public.content_knowledge_nodes (problem_part_id, name)
  select id, 'Sprint 9C node' from public.content_problem_parts where name = 'Sprint 9C part'
  returning id
) select sprint9c.put('node', id) from inserted;
with inserted as (
  insert into public.content_blogs (knowledge_node_id, title) values (sprint9c.id('node'), 'Sprint 9C Blog A') returning id
) select sprint9c.put('blog_entity_a', id) from inserted;
with inserted as (
  insert into public.content_blogs (knowledge_node_id, title) values (sprint9c.id('node'), 'Sprint 9C Blog B') returning id
) select sprint9c.put('blog_entity_b', id) from inserted;

-- Operational tasks.
select sprint9c.task('normal', 'author');
select sprint9c.task('normal_wrong_actor', 'author');
select sprint9c.task('review_required', 'author');
select sprint9c.task('research', 'author');
select sprint9c.task('blog', 'author');
select sprint9c.task('head_review', 'reviewer');
select sprint9c.task('head_blog', 'author');
select sprint9c.task('head_review_for_head', 'reviewer');
select sprint9c.task('lonely_blog', 'author');
select sprint9c.task('bad_blog', 'author');
select sprint9c.task('bad_head_review', 'reviewer');
select sprint9c.task('blocked_blog', 'author');
select sprint9c.task('blocked_head_review', 'reviewer');
select sprint9c.task('done_blog', 'author');
select sprint9c.task('done_head_review', 'reviewer');
select sprint9c.task('inactive_blog', 'author');
select sprint9c.task('inactive_head_review', 'inactive');
select sprint9c.task('posting', 'author', 'Sprint 9C explicit checklist #posting');

-- The creation RPC correctly refuses inactive assignees, so create the
-- historical review first and then model membership deactivation.
update public.users set is_active = false where id = sprint9c.id('inactive');

insert into public.content_task_runtime (task_id, task_type_version_id, source_task_id) values
  (sprint9c.id('normal'), sprint9c.id('version_RESEARCH_false'), null),
  (sprint9c.id('normal_wrong_actor'), sprint9c.id('version_RESEARCH_false'), null),
  (sprint9c.id('review_required'), sprint9c.id('version_REVIEW_REQUIRED_true'), null),
  (sprint9c.id('research'), sprint9c.id('version_RESEARCH_false'), null),
  (sprint9c.id('blog'), sprint9c.id('version_BLOG_false'), sprint9c.id('research')),
  (sprint9c.id('head_review'), sprint9c.id('version_HEAD_REVIEW_false'), sprint9c.id('blog')),
  (sprint9c.id('head_blog'), sprint9c.id('version_BLOG_false'), sprint9c.id('research')),
  (sprint9c.id('head_review_for_head'), sprint9c.id('version_HEAD_REVIEW_false'), sprint9c.id('head_blog')),
  (sprint9c.id('lonely_blog'), sprint9c.id('version_BLOG_false'), sprint9c.id('research')),
  (sprint9c.id('bad_blog'), sprint9c.id('version_BLOG_false'), sprint9c.id('research')),
  (sprint9c.id('bad_head_review'), sprint9c.id('version_HEAD_REVIEW_false'), sprint9c.id('bad_blog')),
  (sprint9c.id('blocked_blog'), sprint9c.id('version_BLOG_false'), sprint9c.id('research')),
  (sprint9c.id('blocked_head_review'), sprint9c.id('version_HEAD_REVIEW_false'), sprint9c.id('blocked_blog')),
  (sprint9c.id('done_blog'), sprint9c.id('version_BLOG_false'), sprint9c.id('research')),
  (sprint9c.id('done_head_review'), sprint9c.id('version_HEAD_REVIEW_false'), sprint9c.id('done_blog')),
  (sprint9c.id('inactive_blog'), sprint9c.id('version_BLOG_false'), sprint9c.id('research')),
  (sprint9c.id('inactive_head_review'), sprint9c.id('version_HEAD_REVIEW_false'), sprint9c.id('inactive_blog')),
  (sprint9c.id('posting'), sprint9c.id('version_RESEARCH_false'), null);

insert into public.content_task_links (task_id, entity_type, entity_id, relation) values
  (sprint9c.id('research'), 'KNOWLEDGE_NODE', sprint9c.id('node'), 'PRIMARY'),
  (sprint9c.id('blog'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('head_review'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('head_blog'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('head_review_for_head'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('lonely_blog'), 'BLOG', sprint9c.id('blog_entity_b'), 'PRIMARY'),
  (sprint9c.id('bad_blog'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('bad_head_review'), 'BLOG', sprint9c.id('blog_entity_b'), 'PRIMARY'),
  (sprint9c.id('blocked_blog'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('blocked_head_review'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('done_blog'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('done_head_review'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('inactive_blog'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY'),
  (sprint9c.id('inactive_head_review'), 'BLOG', sprint9c.id('blog_entity_a'), 'PRIMARY');

select sprint9c.force('research', 'DONE');
select sprint9c.force('head_blog', 'DONE');
select sprint9c.force('lonely_blog', 'DONE');
select sprint9c.force('bad_blog', 'DONE');
select sprint9c.force('blocked_blog', 'DONE');
select sprint9c.force('blocked_head_review', 'BLOCKED');
select sprint9c.force('done_blog', 'DONE');
select sprint9c.force('done_head_review', 'DONE');
select sprint9c.force('inactive_blog', 'DONE');

set role service_role;

-- Normal and review-required paths.
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('normal_wrong_actor'), sprint9c.id('other'), 'DONE') = '42501',
  'normal Content OS direct completion rejects the wrong actor');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('normal'), sprint9c.id('author'), 'DONE') = 'OK',
  'normal Content OS task completes IN_PROGRESS -> DONE by its assignee');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('review_required'), sprint9c.id('author'), 'DONE') = '40001',
  'review-required Content OS task has no direct DONE shortcut');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('review_required'), sprint9c.id('author'), 'REVIEW') = 'OK',
  'review-required Content OS task keeps IN_PROGRESS -> REVIEW');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('review_required'), sprint9c.id('head'), 'DONE') = 'OK',
  'review-required Content OS task keeps REVIEW -> DONE');

-- Exact Blog revision authorization failures.
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('research'), sprint9c.id('head'), 'REVISION', 'x') = '42501',
  'unrelated Content OS DONE task cannot enter REVISION');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('lonely_blog'), sprint9c.id('head'), 'REVISION', 'x') = '42501',
  'Blog without its own Head Review cannot enter REVISION');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('bad_blog'), sprint9c.id('reviewer'), 'REVISION', 'x') = '42501',
  'wrong PRIMARY Blog relationship cannot authorize revision');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blocked_blog'), sprint9c.id('reviewer'), 'REVISION', 'x') = '42501',
  'a BLOCKED Head Review cannot request revision');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('done_blog'), sprint9c.id('reviewer'), 'REVISION', 'x') = '42501',
  'a DONE Head Review cannot request revision');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('inactive_blog'), sprint9c.id('inactive'), 'REVISION', 'x') = '42501',
  'inactive Head Review assignee cannot request revision');

-- Main lifecycle, including transactional failure injection and retries.
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('author'), 'DONE') = 'OK',
  'source Blog completes directly before review');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('other'), 'REVISION', 'x') = '42501',
  'unrelated active member cannot request Blog revision');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('author'), 'REVISION', 'x') = '42501',
  'Blog author cannot request their own revision');
reset role;

insert into sprint9c.fail_updates values (sprint9c.id('head_review'), 'BLOCKED');
set role service_role;
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('reviewer'), 'REVISION', 'atomic failure') = 'P0001',
  'injected Head Review BLOCKED failure aborts the revision request');
select sprint9c.ok(
  (select status = 'DONE' from public.tasks where id = sprint9c.id('blog'))
  and (select status = 'IN_PROGRESS' from public.tasks where id = sprint9c.id('head_review'))
  and not exists (select 1 from public.task_revisions where task_id = sprint9c.id('blog')),
  'failed coupled revision rolls back Blog, Head Review, events, and revision history');
reset role;
delete from sprint9c.fail_updates;

create table sprint9c.task_count_before as select count(*) as value from public.tasks;
grant select on sprint9c.task_count_before to service_role;
set role service_role;
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('reviewer'), 'REVISION', 'Tighten the intro') = 'OK',
  'Head Review assignee requests revision');
select sprint9c.ok(
  (select status = 'REVISION' from public.tasks where id = sprint9c.id('blog'))
  and (select status = 'BLOCKED' and blocked_reason = 'Waiting for source Blog revision' from public.tasks where id = sprint9c.id('head_review')),
  'revision atomically moves SAME Blog to REVISION and SAME Head Review to BLOCKED');
select sprint9c.ok(
  exists (select 1 from public.task_events where task_id = sprint9c.id('blog') and event_type = 'REVISION_REQUESTED'
    and metadata ->> 'reviewTaskId' = sprint9c.id('head_review')::text)
  and exists (select 1 from public.task_events where task_id = sprint9c.id('head_review') and event_type = 'TASK_BLOCKED'
    and metadata ->> 'sourceTaskId' = sprint9c.id('blog')::text)
  and (select count(*) from public.task_revisions where task_id = sprint9c.id('blog') and requested_by = sprint9c.id('reviewer')) = 1,
  'revision writes both audit trails, task_revisions, and stable cross-task ids');

select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('reviewer'), 'REVISION', 'retry') = 'OK',
  'response-loss retry of revision request is a no-op success');
select sprint9c.ok(
  (select count(*) from public.task_revisions where task_id = sprint9c.id('blog')) = 1
  and (select count(*) from public.task_events where task_id = sprint9c.id('head_review') and event_type = 'TASK_BLOCKED') = 1,
  'revision retry creates no duplicate history');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('head_review'), sprint9c.id('reviewer'), 'DONE') = '40001',
  'Head Review cannot complete while its source Blog is in REVISION');
reset role;

-- Exercise the Content OS completion predicate directly as well as the
-- approved BLOCKED state above.
select sprint9c.force('head_review', 'IN_PROGRESS');
set role service_role;
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('head_review'), sprint9c.id('reviewer'), 'DONE') = '40001',
  'content_os_completion_allowed blocks an IN_PROGRESS Head Review while Blog is REVISION');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('head_review'), sprint9c.id('reviewer'), 'REVIEW') = 'OK',
  'misrouted Head Review can still enter the legacy REVIEW state');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('head_review'), sprint9c.id('reviewer'), 'DONE') = '40001',
  'content_os_completion_allowed also blocks legacy REVIEW -> DONE while Blog is REVISION');
reset role;
select sprint9c.force('head_review', 'BLOCKED');

insert into sprint9c.fail_updates values (sprint9c.id('head_review'), 'ASSIGNED');
set role service_role;
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('author'), 'DONE') = 'P0001',
  'injected Head Review ASSIGNED failure aborts Blog resubmission');
select sprint9c.ok(
  (select status = 'REVISION' from public.tasks where id = sprint9c.id('blog'))
  and (select status = 'BLOCKED' from public.tasks where id = sprint9c.id('head_review')),
  'failed coupled resubmission rolls both task rows back');
reset role;
delete from sprint9c.fail_updates;

set role service_role;
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('author'), 'DONE') = 'OK',
  'Blog assignee resubmits the SAME Blog');
select sprint9c.ok(
  (select status = 'DONE' from public.tasks where id = sprint9c.id('blog'))
  and (select status = 'ASSIGNED' and blocked_reason is null from public.tasks where id = sprint9c.id('head_review')),
  'resubmission atomically restores the SAME Head Review BLOCKED -> ASSIGNED');
select sprint9c.ok(
  exists (select 1 from public.task_events where task_id = sprint9c.id('head_review') and event_type = 'TASK_UNBLOCKED'
    and old_value = '"BLOCKED"'::jsonb and new_value = '"ASSIGNED"'::jsonb)
  and (select count(*) from public.tasks) = (select value from sprint9c.task_count_before),
  'resubmission is audited and creates no Blog or Head Review task');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('blog'), sprint9c.id('author'), 'DONE') = 'OK',
  'response-loss retry of Blog resubmission is a no-op success');
select sprint9c.ok(
  (select count(*) from public.task_events where task_id = sprint9c.id('head_review') and event_type = 'TASK_UNBLOCKED') = 1,
  'resubmission retry creates no duplicate Head Review events');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('head_review'), sprint9c.id('reviewer'), 'IN_PROGRESS') = 'OK',
  'restored Head Review is accepted after the Blog is DONE');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('head_review'), sprint9c.id('reviewer'), 'DONE') = 'OK',
  'restored Head Review is approved after the Blog is DONE');

-- Active Head uses the same stable provenance path.
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('head_blog'), sprint9c.id('head'), 'REVISION', 'Head decision') = 'OK',
  'active Head may request Blog revision');
select sprint9c.ok((select status = 'BLOCKED' from public.tasks where id = sprint9c.id('head_review_for_head')),
  'active Head revision parks the same Head Review');

-- Posting checklist presence, not a Content OS flag or title inference in the
-- transition RPC, controls the direct-completion gate.
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('posting'), sprint9c.id('author'), 'DONE') = '23514',
  'incomplete existing posting checklist blocks direct completion');
select public.toggle_posting_checklist_item(i.id, sprint9c.id('author'))
from public.task_checklist_items i
join public.task_checklists c on c.id = i.checklist_id
where c.task_id = sprint9c.id('posting');
select sprint9c.ok(sprint9c.try_transition(sprint9c.id('posting'), sprint9c.id('author'), 'DONE') = 'OK',
  'completed existing posting checklist permits direct completion');

select sprint9c.ok(
  (select not prosecdef and proconfig = array['search_path=""']
   from pg_proc where oid = 'public.transition_task_with_events(uuid, uuid, text, text)'::regprocedure),
  'transition RPC remains SECURITY INVOKER with empty search_path');
reset role;

\echo 'ALL SPRINT 9C CONTENT OS TRANSITION TESTS PASSED'
