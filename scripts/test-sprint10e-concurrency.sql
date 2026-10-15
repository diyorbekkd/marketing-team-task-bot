\set ON_ERROR_STOP on

create extension if not exists dblink;

create table public.sprint10e_race_ids (
  key text primary key,
  value uuid not null
);

create function public.sprint10e_try_reassign_raw(p_task_id uuid, p_assignee_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_catalog.pg_sleep(0.5);
  update public.tasks set assignee_id = p_assignee_id where id = p_task_id;
  return 'UPDATED';
exception when others then
  return sqlstate;
end;
$$;

do $fixtures$
declare
  v_head uuid := 'e1000000-0000-4000-8000-000000000001';
  v_author uuid := 'e1000000-0000-4000-8000-000000000002';
  v_reviewer uuid := 'e1000000-0000-4000-8000-000000000003';
  v_collision uuid := 'e1000000-0000-4000-8000-000000000004';
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
  v_review_id uuid;
  v_connection text := format('dbname=%s user=%s', current_database(), current_user);
begin
  insert into public.users (id, telegram_user_id, display_name, role, is_active)
  values
    (v_head, 970000001, 'Race Head', 'HEAD_OF_MARKETING', true),
    (v_author, 970000002, 'Race Author', 'CONTENT_MARKETER', true),
    (v_reviewer, 970000003, 'Race Reviewer', 'DIGITAL_MARKETER', true),
    (v_collision, 970000004, 'Race Collision', 'SEO_SPECIALIST', true);

  insert into public.content_domains (name) values ('Sprint 10E race') returning id into v_domain;
  insert into public.content_problem_categories (domain_id, name)
  values (v_domain, 'Race') returning id into v_category;
  insert into public.content_problem_parts (problem_category_id, name)
  values (v_category, 'Race') returning id into v_part;
  insert into public.content_knowledge_nodes (problem_part_id, name)
  values (v_part, 'Race') returning id into v_node;
  insert into public.content_blogs (knowledge_node_id, title)
  values (v_node, 'Assignment race') returning id into v_blog_entity;

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

  select * into v_blog from public.create_task_with_event_v2(
    v_author, v_author, 'Assignment race Blog', '', 'normal',
    statement_timestamp() + interval '10 days', null, null, null
  );
  insert into public.content_task_runtime (task_id, task_type_version_id)
  values (v_blog.id, v_blog_version);
  insert into public.content_task_links (task_id, entity_type, entity_id, relation)
  values (v_blog.id, 'BLOG', v_blog_entity, 'PRIMARY');
  select head_review_task_id into v_review_id
  from public.content_os_complete_blog_with_head_review(
    v_blog.id, v_author, v_reviewer,
    statement_timestamp() + interval '12 days',
    'Assignment race review', repeat('e', 64)
  );

  insert into public.sprint10e_race_ids (key, value) values
    ('blog', v_blog.id),
    ('review', v_review_id),
    ('collision', v_collision);

  perform dblink_connect('blog_reassign', v_connection);
  perform dblink_connect('review_reassign', v_connection);
  perform dblink_send_query('blog_reassign', format(
    'select public.sprint10e_try_reassign_raw(%L::uuid,%L::uuid)',
    v_blog.id, v_collision
  ));
  perform dblink_send_query('review_reassign', format(
    'select public.sprint10e_try_reassign_raw(%L::uuid,%L::uuid)',
    v_review_id, v_collision
  ));
end
$fixtures$;

checkpoint;

do $assertions$
declare
  v_blog_result text;
  v_review_result text;
  v_blog_id uuid;
  v_review_id uuid;
  v_collision uuid;
begin
  select result into v_blog_result
  from dblink_get_result('blog_reassign') as t(result text);
  select result into v_review_result
  from dblink_get_result('review_reassign') as t(result text);

  if (select count(*) from unnest(array[v_blog_result, v_review_result]) result
      where result = 'UPDATED') <> 1
    or (select count(*) from unnest(array[v_blog_result, v_review_result]) result
        where result = '42501') <> 1 then
    raise exception 'assignment race was not one UPDATED plus one 42501: %, %',
      v_blog_result, v_review_result;
  end if;

  select value into v_blog_id from public.sprint10e_race_ids where key = 'blog';
  select value into v_review_id from public.sprint10e_race_ids where key = 'review';
  select value into v_collision from public.sprint10e_race_ids where key = 'collision';
  if (select assignee_id from public.tasks where id = v_blog_id)
    = (select assignee_id from public.tasks where id = v_review_id)
    or (select count(*) from public.tasks
        where id in (v_blog_id, v_review_id) and assignee_id = v_collision) <> 1 then
    raise exception 'assignment race committed an author/reviewer collision';
  end if;

  perform dblink_disconnect('blog_reassign');
  perform dblink_disconnect('review_reassign');
  raise notice 'PASS concurrent Blog/reviewer reassignment preserves independence';
end
$assertions$;

drop function public.sprint10e_try_reassign_raw(uuid, uuid);
drop table public.sprint10e_race_ids;
