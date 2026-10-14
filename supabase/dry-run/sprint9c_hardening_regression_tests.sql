-- LOCAL DRY-RUN ONLY. Database-level regression for the already-integrated
-- Sprint 9B role and privilege changes.

create schema if not exists sprint9c_hardening;
create or replace function sprint9c_hardening.ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then raise exception 'FAIL %', p_label; end if;
  raise notice 'PASS %', p_label;
end $$;

select sprint9c_hardening.ok(
  (select pg_get_constraintdef(oid)
   from pg_constraint
   where conname = 'users_role_check' and conrelid = 'public.users'::regclass)
  = 'CHECK ((role = ANY (ARRAY[''OPERATOR_VIDEO_EDITOR''::text, ''CONTENT_MARKETER''::text, ''DIGITAL_MARKETER''::text, ''SMM_MANAGER''::text, ''SEO_SPECIALIST''::text, ''HEAD_OF_MARKETING''::text])))',
  'SEO_SPECIALIST role CHECK preserves all five prior roles'
);

do $$
declare role_code text;
begin
  foreach role_code in array array[
    'OPERATOR_VIDEO_EDITOR', 'CONTENT_MARKETER', 'DIGITAL_MARKETER',
    'SMM_MANAGER', 'SEO_SPECIALIST'
  ] loop
    insert into public.users (telegram_user_id, display_name, role, is_active)
    values (94000 + array_position(array[
      'OPERATOR_VIDEO_EDITOR', 'CONTENT_MARKETER', 'DIGITAL_MARKETER',
      'SMM_MANAGER', 'SEO_SPECIALIST'
    ], role_code), 'Sprint 9C ' || role_code, role_code, false)
    on conflict (telegram_user_id) do nothing;
  end loop;
end $$;

select sprint9c_hardening.ok(
  (select count(*) from public.users where telegram_user_id between 94001 and 94005) = 5,
  'all legacy non-Head roles and SEO_SPECIALIST remain accepted'
);

create or replace function sprint9c_hardening.table_privs(p_role text)
returns table (table_name text, privileges text) language sql stable as $$
  select table_name, coalesce(string_agg(privilege, ',' order by ordinal) filter (
    where has_table_privilege(p_role, ('public.' || table_name)::regclass, privilege)
  ), '-')
  from unnest(array[
    'users', 'tasks', 'task_events', 'deadline_change_requests',
    'reassign_requests', 'task_revisions', 'recurring_definitions',
    'task_checklists', 'task_checklist_items', 'report_deliveries',
    'user_events', 'task_reminder_deliveries'
  ]) table_names(table_name)
  cross join (values
    (1, 'SELECT'), (2, 'INSERT'), (3, 'UPDATE'), (4, 'DELETE'),
    (5, 'TRUNCATE'), (6, 'REFERENCES'), (7, 'TRIGGER'), (8, 'MAINTAIN')
  ) privilege_names(ordinal, privilege)
  group by table_name
$$;

select sprint9c_hardening.ok(
  (select string_agg(table_name || '=' || privileges, ' ' order by table_name)
   from sprint9c_hardening.table_privs('service_role')) =
  'deadline_change_requests=SELECT,INSERT,UPDATE,DELETE reassign_requests=SELECT,INSERT,UPDATE,DELETE recurring_definitions=SELECT,INSERT,UPDATE,DELETE '
  || 'report_deliveries=SELECT,INSERT,UPDATE task_checklist_items=SELECT,INSERT,UPDATE task_checklists=SELECT,INSERT task_events=SELECT,INSERT '
  || 'task_reminder_deliveries=SELECT,INSERT,UPDATE task_revisions=SELECT,INSERT tasks=SELECT,INSERT,UPDATE,DELETE user_events=SELECT,INSERT '
  || 'users=SELECT,INSERT,UPDATE,DELETE',
  'service_role retains exactly the intended operational table privileges'
);

select sprint9c_hardening.ok(
  not exists (
    select 1 from sprint9c_hardening.table_privs('service_role')
    where privileges ~ '(TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)'
  ),
  'service_role has no TRUNCATE, REFERENCES, TRIGGER, or MAINTAIN privilege'
);

select sprint9c_hardening.ok(
  not exists (select 1 from sprint9c_hardening.table_privs('anon') where privileges <> '-')
  and not exists (select 1 from sprint9c_hardening.table_privs('authenticated') where privileges <> '-'),
  'anon and authenticated have no operational table privileges'
);

\echo 'ALL SPRINT 9C HARDENING REGRESSION TESTS PASSED'
