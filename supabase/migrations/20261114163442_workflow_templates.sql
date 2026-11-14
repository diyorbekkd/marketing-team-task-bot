create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_by uuid references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workflow_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workflow_templates (id) on delete restrict,
  position integer not null check (position between 1 and 50),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  assignee_role text not null check (assignee_role in (
    'OPERATOR_VIDEO_EDITOR', 'CONTENT_MARKETER', 'DIGITAL_MARKETER', 'SMM_MANAGER', 'HEAD_OF_MARKETING'
  )),
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  due_after_hours integer not null default 24 check (due_after_hours between 1 and 720),
  unique (template_id, position)
);

create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.workflow_templates (id) on delete restrict,
  created_by uuid not null references public.users (id) on delete restrict,
  subject text not null check (char_length(btrim(subject)) between 1 and 200),
  assignee_map jsonb not null default '{}'::jsonb check (jsonb_typeof(assignee_map) = 'object'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  current_position integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.tasks
  add column workflow_run_id uuid references public.workflow_runs (id) on delete restrict,
  add column workflow_step_id uuid references public.workflow_template_steps (id) on delete restrict,
  add constraint tasks_workflow_identity_check check (
    (workflow_run_id is null) = (workflow_step_id is null)
  );

create unique index tasks_workflow_run_step_idx
  on public.tasks (workflow_run_id, workflow_step_id)
  where workflow_run_id is not null;
create index workflow_runs_template_created_at_idx
  on public.workflow_runs (template_id, created_at desc);

create trigger workflow_templates_set_updated_at before update on public.workflow_templates
for each row execute function private.set_updated_at();
create trigger workflow_runs_set_updated_at before update on public.workflow_runs
for each row execute function private.set_updated_at();

alter table public.task_events drop constraint task_events_event_type_check;
alter table public.task_events add constraint task_events_event_type_check check (
  event_type in (
    'TASK_CREATED', 'TASK_ACCEPTED', 'STATUS_CHANGED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED',
    'PRIORITY_CHANGED', 'DEADLINE_CHANGE_REQUESTED', 'DEADLINE_CHANGE_APPROVED',
    'DEADLINE_CHANGE_REJECTED', 'DEADLINE_CHANGED', 'REASSIGN_REQUESTED', 'REASSIGN_APPROVED',
    'REASSIGN_REJECTED', 'ASSIGNEE_CHANGED', 'TASK_BLOCKED', 'TASK_UNBLOCKED',
    'REVIEW_REQUESTED', 'REVISION_REQUESTED', 'TASK_COMPLETED', 'TASK_CANCELLED',
    'TASK_REOPENED', 'POSTING_CHECKLIST_CREATED', 'POSTING_CHECKLIST_ITEM_TOGGLED',
    'RECURRING_TASK_GENERATED', 'PUBLICATION_DATE_CHANGED', 'COMMENT_ADDED', 'RESULT_SUBMITTED',
    'WORKFLOW_STARTED', 'WORKFLOW_STEP_ACTIVATED', 'WORKFLOW_COMPLETED'
  )
);

create function private.workflow_assignee(p_role text, p_map jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if p_map ? p_role then v_user_id := (p_map ->> p_role)::uuid; end if;
  if v_user_id is null then
    select id into v_user_id from public.users
    where role = p_role and is_active
    order by created_at, id
    limit 1;
  end if;
  if not exists (select 1 from public.users where id = v_user_id and role = p_role and is_active) then
    raise exception 'workflow role has no active assignee' using errcode = '22023';
  end if;
  return v_user_id;
end;
$$;

create function public.start_workflow_run(
  p_template_id uuid,
  p_actor_id uuid,
  p_subject text,
  p_assignee_map jsonb default '{}'::jsonb
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template public.workflow_templates;
  v_step public.workflow_template_steps;
  v_run public.workflow_runs;
  v_task public.tasks;
  v_assignee_id uuid;
  v_is_posting boolean;
begin
  if not exists (select 1 from public.users where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active) then
    raise exception 'only Head may start workflows' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_assignee_map, '{}'::jsonb)) <> 'object' then
    raise exception 'assignee map must be an object' using errcode = '22023';
  end if;
  select * into v_template from public.workflow_templates where id = p_template_id and is_active;
  if not found then raise exception 'workflow template not found' using errcode = 'P0002'; end if;
  select * into v_step from public.workflow_template_steps
  where template_id = p_template_id order by position limit 1;
  if not found then raise exception 'workflow has no steps' using errcode = '22023'; end if;
  v_assignee_id := private.workflow_assignee(v_step.assignee_role, coalesce(p_assignee_map, '{}'::jsonb));

  insert into public.workflow_runs (template_id, created_by, subject, assignee_map, current_position)
  values (p_template_id, p_actor_id, btrim(p_subject), coalesce(p_assignee_map, '{}'::jsonb), v_step.position)
  returning * into v_run;

  insert into public.tasks (
    title, description, priority, status, creator_id, assignee_id, deadline, workflow_run_id, workflow_step_id
  ) values (
    btrim(p_subject) || ' — ' || v_step.title, v_step.description, v_step.priority, 'IN_PROGRESS',
    p_actor_id, v_assignee_id, statement_timestamp() + make_interval(hours => v_step.due_after_hours),
    v_run.id, v_step.id
  ) returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, new_value, metadata) values
    (v_task.id, p_actor_id, 'TASK_CREATED', jsonb_build_object('title', v_task.title, 'assigneeId', v_assignee_id, 'deadline', v_task.deadline), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id)),
    (v_task.id, p_actor_id, 'WORKFLOW_STARTED', to_jsonb(v_template.name), jsonb_build_object('workflowRunId', v_run.id, 'templateId', v_template.id)),
    (v_task.id, p_actor_id, 'WORKFLOW_STEP_ACTIVATED', to_jsonb(v_step.position), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id));

  v_is_posting := (v_task.title || E'\n' || coalesce(v_task.description, '')) ~* '(^|[^[:alnum:]_])#posting([^[:alnum:]_]|$)';
  if v_is_posting then
    perform private.attach_posting_checklist(v_task.id);
    insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
    values (v_task.id, p_actor_id, 'POSTING_CHECKLIST_CREATED', to_jsonb('POSTING'::text),
      jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id));
  end if;
  return v_task;
end;
$$;

create function public.advance_workflow_run(p_completed_task_id uuid, p_actor_id uuid)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_completed public.tasks;
  v_run public.workflow_runs;
  v_step public.workflow_template_steps;
  v_task public.tasks;
  v_assignee_id uuid;
  v_is_posting boolean;
begin
  select * into v_completed from public.tasks where id = p_completed_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  if v_completed.workflow_run_id is null or v_completed.status <> 'DONE' then return null; end if;
  select * into v_run from public.workflow_runs where id = v_completed.workflow_run_id for update;
  if v_run.status <> 'ACTIVE' then return null; end if;
  if not exists (select 1 from public.users where id = p_actor_id and is_active) then
    raise exception 'actor is not active' using errcode = '42501';
  end if;
  select * into v_step from public.workflow_template_steps
  where template_id = v_run.template_id and position > v_run.current_position
  order by position limit 1;
  if not found then
    update public.workflow_runs set status = 'COMPLETED', completed_at = statement_timestamp()
    where id = v_run.id;
    insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
    values (v_completed.id, p_actor_id, 'WORKFLOW_COMPLETED', to_jsonb(v_run.subject), jsonb_build_object('workflowRunId', v_run.id));
    return null;
  end if;

  v_assignee_id := private.workflow_assignee(v_step.assignee_role, v_run.assignee_map);
  insert into public.tasks (
    title, description, priority, status, creator_id, assignee_id, deadline, workflow_run_id, workflow_step_id
  ) values (
    v_run.subject || ' — ' || v_step.title, v_step.description, v_step.priority, 'IN_PROGRESS',
    v_run.created_by, v_assignee_id, statement_timestamp() + make_interval(hours => v_step.due_after_hours),
    v_run.id, v_step.id
  )
  on conflict (workflow_run_id, workflow_step_id) where workflow_run_id is not null do nothing
  returning * into v_task;
  if v_task.id is null then return null; end if;
  update public.workflow_runs set current_position = v_step.position where id = v_run.id;
  insert into public.task_events (task_id, actor_kind, event_type, new_value, metadata) values
    (v_task.id, 'SYSTEM', 'TASK_CREATED', jsonb_build_object('title', v_task.title, 'assigneeId', v_assignee_id, 'deadline', v_task.deadline), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id)),
    (v_task.id, 'SYSTEM', 'WORKFLOW_STEP_ACTIVATED', to_jsonb(v_step.position), jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id, 'previousTaskId', v_completed.id));
  v_is_posting := (v_task.title || E'\n' || coalesce(v_task.description, '')) ~* '(^|[^[:alnum:]_])#posting([^[:alnum:]_]|$)';
  if v_is_posting then
    perform private.attach_posting_checklist(v_task.id);
    insert into public.task_events (task_id, actor_kind, event_type, new_value, metadata)
    values (v_task.id, 'SYSTEM', 'POSTING_CHECKLIST_CREATED', to_jsonb('POSTING'::text),
      jsonb_build_object('workflowRunId', v_run.id, 'workflowStepId', v_step.id));
  end if;
  return v_task;
end;
$$;

create function public.recover_workflow_runs()
returns setof public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidate record;
  v_task public.tasks;
begin
  for v_candidate in
    select task.id as task_id, run.created_by as actor_id
    from public.workflow_runs run
    join public.tasks task
      on task.workflow_run_id = run.id
     and task.workflow_step_id in (
       select step.id from public.workflow_template_steps step
       where step.template_id = run.template_id and step.position = run.current_position
     )
    where run.status = 'ACTIVE' and task.status = 'DONE'
    order by run.created_at
    limit 50
  loop
    v_task := public.advance_workflow_run(v_candidate.task_id, v_candidate.actor_id);
    if v_task.id is not null then return next v_task; end if;
  end loop;
  return;
end;
$$;

insert into public.workflow_templates (id, slug, name, description, is_system) values
  ('91000000-0000-4000-8000-000000000001', 'instagram-reels', 'Instagram Reels', 'Ssenariydan publikatsiyagacha to‘liq Reels jarayoni.', true),
  ('91000000-0000-4000-8000-000000000002', 'telegram-post', 'Telegram post', 'Matn, tasdiq va kanalga joylash.', true),
  ('91000000-0000-4000-8000-000000000003', 'instagram-stories', 'Instagram Stories', 'Stories g‘oyasi, dizayn va publikatsiya.', true),
  ('91000000-0000-4000-8000-000000000004', 'ad-creatives', 'Reklama kreativlari', 'Kreativ konsepsiya, ishlab chiqish va tasdiq.', true),
  ('91000000-0000-4000-8000-000000000005', 'ad-campaign', 'Reklama kampaniyasi', 'Kampaniya tayyorlash, ishga tushirish va nazorat.', true),
  ('91000000-0000-4000-8000-000000000006', 'landing-page', 'Landing page', 'Kontent, yig‘ish, tekshiruv va ishga tushirish.', true),
  ('91000000-0000-4000-8000-000000000007', 'customer-case-video', 'Mijoz case videosi', 'Intervyu, montaj, tasdiq va publikatsiya.', true);

insert into public.workflow_template_steps (template_id, position, title, description, assignee_role, priority, due_after_hours) values
  ('91000000-0000-4000-8000-000000000001',1,'Ssenariy yozish','Reels ssenariysi va hook tayyorlash.','CONTENT_MARKETER','high',24),
  ('91000000-0000-4000-8000-000000000001',2,'Ssenariyni tasdiqlash','Ssenariyni ko‘rib chiqish.','HEAD_OF_MARKETING','high',8),
  ('91000000-0000-4000-8000-000000000001',3,'Syomka','Tasdiqlangan ssenariy bo‘yicha syomka.','OPERATOR_VIDEO_EDITOR','normal',24),
  ('91000000-0000-4000-8000-000000000001',4,'Montaj','Reels montaji va natija havolasi.','OPERATOR_VIDEO_EDITOR','high',48),
  ('91000000-0000-4000-8000-000000000001',5,'Yakuniy tasdiq','Tayyor videoni tekshirish.','HEAD_OF_MARKETING','high',8),
  ('91000000-0000-4000-8000-000000000001',6,'Instagramga joylash #posting','Caption va publikatsiya.','SMM_MANAGER','high',24),
  ('91000000-0000-4000-8000-000000000002',1,'Post matnini yozish',null,'CONTENT_MARKETER','normal',24),
  ('91000000-0000-4000-8000-000000000002',2,'Postni tasdiqlash',null,'HEAD_OF_MARKETING','high',8),
  ('91000000-0000-4000-8000-000000000002',3,'Telegramga joylash #posting',null,'SMM_MANAGER','normal',12),
  ('91000000-0000-4000-8000-000000000003',1,'Stories rejasini yozish',null,'CONTENT_MARKETER','normal',12),
  ('91000000-0000-4000-8000-000000000003',2,'Stories materialini tayyorlash',null,'OPERATOR_VIDEO_EDITOR','normal',24),
  ('91000000-0000-4000-8000-000000000003',3,'Stories joylash #posting',null,'SMM_MANAGER','normal',12),
  ('91000000-0000-4000-8000-000000000004',1,'Kreativ konsepsiyasi',null,'DIGITAL_MARKETER','high',24),
  ('91000000-0000-4000-8000-000000000004',2,'Kreativ ishlab chiqish',null,'OPERATOR_VIDEO_EDITOR','high',48),
  ('91000000-0000-4000-8000-000000000004',3,'Kreativni tasdiqlash',null,'HEAD_OF_MARKETING','high',12),
  ('91000000-0000-4000-8000-000000000005',1,'Kampaniya rejasi',null,'DIGITAL_MARKETER','high',24),
  ('91000000-0000-4000-8000-000000000005',2,'Kreativ va targeting tekshiruvi',null,'HEAD_OF_MARKETING','high',12),
  ('91000000-0000-4000-8000-000000000005',3,'Kampaniyani ishga tushirish',null,'DIGITAL_MARKETER','high',12),
  ('91000000-0000-4000-8000-000000000006',1,'Landing kontenti',null,'CONTENT_MARKETER','normal',48),
  ('91000000-0000-4000-8000-000000000006',2,'Landingni yig‘ish',null,'DIGITAL_MARKETER','high',72),
  ('91000000-0000-4000-8000-000000000006',3,'Yakuniy tekshiruv',null,'HEAD_OF_MARKETING','high',12),
  ('91000000-0000-4000-8000-000000000007',1,'Case ssenariysi',null,'CONTENT_MARKETER','normal',24),
  ('91000000-0000-4000-8000-000000000007',2,'Intervyu syomkasi',null,'OPERATOR_VIDEO_EDITOR','high',48),
  ('91000000-0000-4000-8000-000000000007',3,'Case montaji',null,'OPERATOR_VIDEO_EDITOR','high',72),
  ('91000000-0000-4000-8000-000000000007',4,'Case tasdig‘i',null,'HEAD_OF_MARKETING','high',12),
  ('91000000-0000-4000-8000-000000000007',5,'Case publikatsiyasi #posting',null,'SMM_MANAGER','normal',24);

alter table public.workflow_templates enable row level security;
alter table public.workflow_template_steps enable row level security;
alter table public.workflow_runs enable row level security;
revoke all on table public.workflow_templates, public.workflow_template_steps, public.workflow_runs from public, anon, authenticated;
grant select, insert, update on table public.workflow_templates to service_role;
grant select, insert, update on table public.workflow_template_steps to service_role;
grant select, insert, update on table public.workflow_runs to service_role;
revoke all on function public.start_workflow_run(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.advance_workflow_run(uuid, uuid) from public, anon, authenticated;
revoke all on function public.recover_workflow_runs() from public, anon, authenticated;
grant execute on function public.start_workflow_run(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.advance_workflow_run(uuid, uuid) to service_role;
grant execute on function public.recover_workflow_runs() to service_role;
grant usage on schema private to service_role;
grant execute on function private.workflow_assignee(text, jsonb) to service_role;
