-- LOCAL DRY-RUN ONLY. Run after all Task Bot migrations on a disposable
-- PostgreSQL 17 database with Supabase's service_role available.

create schema if not exists dryrun;

create or replace function dryrun.ok(p_condition boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_condition is not true then
    raise exception 'FAIL %', p_label;
  end if;
  raise notice 'PASS %', p_label;
end;
$$;

create or replace function dryrun.try_transition(p_task_id uuid, p_actor_id uuid, p_status text)
returns text
language plpgsql
as $$
begin
  perform public.transition_task_with_events(p_task_id, p_actor_id, p_status);
  return 'OK';
exception when others then
  return sqlstate;
end;
$$;

create table if not exists dryrun.ids (
  key text primary key,
  value uuid not null
);

insert into public.users (telegram_user_id, display_name, role, is_active)
values
  (99001, 'Sprint 9B creator', 'CONTENT_MARKETER', true),
  (99002, 'Sprint 9B assignee', 'SEO_SPECIALIST', true)
on conflict (telegram_user_id) do nothing;

insert into dryrun.ids (key, value)
select 'creator', id from public.users where telegram_user_id = 99001
on conflict (key) do update set value = excluded.value;

insert into dryrun.ids (key, value)
select 'assignee', id from public.users where telegram_user_id = 99002
on conflict (key) do update set value = excluded.value;

grant usage on schema dryrun to service_role;
grant select, insert, update on table dryrun.ids to service_role;
grant execute on function dryrun.ok(boolean, text), dryrun.try_transition(uuid, uuid, text) to service_role;

set role service_role;

with created as (
  select id
  from public.create_task_with_event_v2(
    (select value from dryrun.ids where key = 'creator'),
    (select value from dryrun.ids where key = 'assignee'),
    'Sprint 9B posting regression #posting',
    '',
    'normal',
    now() + interval '1 day',
    9900101
  )
)
insert into dryrun.ids (key, value)
select 'posting_task', id from created
on conflict (key) do update set value = excluded.value;

select dryrun.ok(
  (select status = 'IN_PROGRESS' from public.tasks where id = (select value from dryrun.ids where key = 'posting_task')),
  '#posting task creation succeeds as service_role'
);

select dryrun.ok(
  (select count(*) = 1 from public.task_checklists where task_id = (select value from dryrun.ids where key = 'posting_task')),
  '#posting task has exactly one persistent checklist'
);

select dryrun.ok(
  (select count(*) = 4
   from public.task_checklist_items i
   join public.task_checklists c on c.id = i.checklist_id
   where c.task_id = (select value from dryrun.ids where key = 'posting_task')),
  '#posting checklist has exactly four invariant items'
);

select private.attach_posting_checklist((select value from dryrun.ids where key = 'posting_task'));

select dryrun.ok(
  (select count(*) = 1 from public.task_checklists where task_id = (select value from dryrun.ids where key = 'posting_task'))
  and (select count(*) = 4
       from public.task_checklist_items i
       join public.task_checklists c on c.id = i.checklist_id
       where c.task_id = (select value from dryrun.ids where key = 'posting_task')),
  're-attaching the posting checklist is idempotent'
);

select dryrun.ok(
  dryrun.try_transition(
    (select value from dryrun.ids where key = 'posting_task'),
    (select value from dryrun.ids where key = 'assignee'),
    'REVIEW'
  ) = '23514',
  'incomplete posting checklist still blocks REVIEW'
);

select public.toggle_posting_checklist_item(
  (select i.id
   from public.task_checklist_items i
   join public.task_checklists c on c.id = i.checklist_id
   where c.task_id = (select value from dryrun.ids where key = 'posting_task')
   order by i.position
   limit 1),
  (select value from dryrun.ids where key = 'assignee')
);

select dryrun.ok(
  (select is_completed and completed_by = (select value from dryrun.ids where key = 'assignee') and completed_at is not null
   from public.task_checklist_items i
   join public.task_checklists c on c.id = i.checklist_id
   where c.task_id = (select value from dryrun.ids where key = 'posting_task')
   order by i.position
   limit 1),
  'checklist toggle-on preserves completion invariants'
);

select public.toggle_posting_checklist_item(
  (select i.id
   from public.task_checklist_items i
   join public.task_checklists c on c.id = i.checklist_id
   where c.task_id = (select value from dryrun.ids where key = 'posting_task')
   order by i.position
   limit 1),
  (select value from dryrun.ids where key = 'assignee')
);

select dryrun.ok(
  (select not is_completed and completed_by is null and completed_at is null
   from public.task_checklist_items i
   join public.task_checklists c on c.id = i.checklist_id
   where c.task_id = (select value from dryrun.ids where key = 'posting_task')
   order by i.position
   limit 1),
  'checklist toggle-off clears completion metadata'
);

select public.toggle_posting_checklist_item(
  i.id,
  (select value from dryrun.ids where key = 'assignee')
)
from public.task_checklist_items i
join public.task_checklists c on c.id = i.checklist_id
where c.task_id = (select value from dryrun.ids where key = 'posting_task');

select dryrun.ok(
  dryrun.try_transition(
    (select value from dryrun.ids where key = 'posting_task'),
    (select value from dryrun.ids where key = 'assignee'),
    'REVIEW'
  ) = 'OK',
  'completed posting checklist permits REVIEW'
);

select dryrun.ok(
  (select status = 'REVIEW' and completed_at is null
   from public.tasks where id = (select value from dryrun.ids where key = 'posting_task'))
  and (select count(*) = 1
       from public.task_events
       where task_id = (select value from dryrun.ids where key = 'posting_task')
         and event_type = 'REVIEW_REQUESTED'),
  'REVIEW transition preserves task and audit invariants'
);

select dryrun.ok(
  has_table_privilege('service_role', 'public.task_checklists', 'SELECT')
  and has_table_privilege('service_role', 'public.task_checklists', 'INSERT')
  and not has_table_privilege('service_role', 'public.task_checklists', 'UPDATE')
  and not has_table_privilege('service_role', 'public.task_checklists', 'DELETE'),
  'task_checklists remains SELECT/INSERT only'
);

reset role;
