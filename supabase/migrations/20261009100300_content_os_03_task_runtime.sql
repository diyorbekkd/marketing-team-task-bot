-- DRAFT (Sprint 8B) — NOT APPLIED TO PRODUCTION. Dry-run only.
-- Content OS runtime metadata keyed by the EXISTING public.tasks.id
-- (contract §H–§K). No column is added to public.tasks; status, assignee,
-- deadline, creator and review history stay authoritative there.

create table public.content_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.content_workflow_template_versions (id) on delete restrict,
  root_entity_type text check (root_entity_type is null or root_entity_type in (
    'DOMAIN', 'PROBLEM_CATEGORY', 'PROBLEM_PART', 'KNOWLEDGE_NODE', 'BLOG', 'MATERIAL', 'ANGLE', 'DESTINATION', 'REPURPOSE_MAP', 'SHOOT_SESSION'
  )),
  root_entity_id uuid,
  started_by uuid not null references public.users (id) on delete restrict,
  started_at timestamptz not null default now(),
  unique (id, template_version_id),
  check ((root_entity_type is null) = (root_entity_id is null))
);

create function private.content_os_guard_run_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.content_workflow_template_versions
    where id = new.template_version_id and status = 'PUBLISHED'
  ) then
    raise exception 'a workflow run must use a PUBLISHED template version' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger content_workflow_runs_published_guard before insert or update on public.content_workflow_runs
  for each row execute function private.content_os_guard_run_version();
create trigger content_workflow_runs_immutable before update or delete on public.content_workflow_runs
  for each row execute function private.content_os_prevent_mutation();

create table public.content_task_runtime (
  task_id uuid primary key references public.tasks (id) on delete restrict,
  task_type_version_id uuid not null references public.content_task_type_versions (id) on delete restrict,
  workflow_run_id uuid,
  workflow_template_version_id uuid,
  workflow_step_id uuid,
  -- Concrete lineage: task_id -> task_id (contract §J).
  source_task_id uuid references public.tasks (id) on delete restrict,
  outcome text check (outcome is null or outcome in ('COMPLETED', 'SKIPPED')),
  skip_reason text check (skip_reason is null or char_length(btrim(skip_reason)) between 1 and 2000),
  field_values jsonb not null default '{}'::jsonb check (jsonb_typeof(field_values) = 'object'),
  custom_fields jsonb not null default '[]'::jsonb check (jsonb_typeof(custom_fields) = 'array'),
  field_provenance jsonb not null default '[]'::jsonb check (jsonb_typeof(field_provenance) = 'array'),
  atomic_idea_drafts jsonb not null default '[]'::jsonb check (jsonb_typeof(atomic_idea_drafts) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workflow_run_id, workflow_template_version_id)
    references public.content_workflow_runs (id, template_version_id) on delete restrict,
  foreign key (workflow_template_version_id, workflow_step_id)
    references public.content_workflow_steps (template_version_id, id) on delete restrict,
  constraint content_task_runtime_run_version_pair_check
    check ((workflow_run_id is null) = (workflow_template_version_id is null)),
  constraint content_task_runtime_step_needs_run_check
    check (workflow_step_id is null or workflow_run_id is not null),
  constraint content_task_runtime_no_self_lineage_check
    check (source_task_id is null or source_task_id <> task_id),
  constraint content_task_runtime_skipped_needs_reason_check
    check ((outcome = 'SKIPPED') = (skip_reason is not null))
);

create index content_task_runtime_source_task_idx on public.content_task_runtime (source_task_id) where source_task_id is not null;
create index content_task_runtime_run_idx on public.content_task_runtime (workflow_run_id) where workflow_run_id is not null;
create index content_task_runtime_step_idx on public.content_task_runtime (workflow_step_id) where workflow_step_id is not null;
create index content_task_runtime_type_version_idx on public.content_task_runtime (task_type_version_id);

create trigger content_task_runtime_set_updated_at before update on public.content_task_runtime
  for each row execute function private.set_updated_at();

-- Bridge: Content Entity <-> content_task_links <-> public.tasks.id (§I).
create table public.content_task_links (
  task_id uuid not null references public.tasks (id) on delete restrict,
  entity_type text not null check (entity_type in (
    'DOMAIN', 'PROBLEM_CATEGORY', 'PROBLEM_PART', 'KNOWLEDGE_NODE', 'BLOG', 'MATERIAL', 'ANGLE', 'DESTINATION', 'REPURPOSE_MAP', 'SHOOT_SESSION'
  )),
  entity_id uuid not null,
  relation text not null check (relation in ('PRIMARY', 'RELATED')),
  created_at timestamptz not null default now(),
  primary key (task_id, entity_type, entity_id)
);

create unique index content_task_links_one_primary_idx on public.content_task_links (task_id) where relation = 'PRIMARY';
create index content_task_links_entity_idx on public.content_task_links (entity_type, entity_id);

-- Polymorphic entity ids are validated against their typed table. Content
-- entities have no DELETE grant, so a validated reference cannot dangle.
create function private.content_os_entity_exists(p_entity_type text, p_entity_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case p_entity_type
    when 'DOMAIN' then exists (select 1 from public.content_domains where id = p_entity_id)
    when 'PROBLEM_CATEGORY' then exists (select 1 from public.content_problem_categories where id = p_entity_id)
    when 'PROBLEM_PART' then exists (select 1 from public.content_problem_parts where id = p_entity_id)
    when 'KNOWLEDGE_NODE' then exists (select 1 from public.content_knowledge_nodes where id = p_entity_id)
    when 'BLOG' then exists (select 1 from public.content_blogs where id = p_entity_id)
    when 'MATERIAL' then exists (select 1 from public.content_materials where id = p_entity_id)
    when 'ANGLE' then exists (select 1 from public.content_angles where id = p_entity_id)
    when 'DESTINATION' then exists (select 1 from public.content_destinations where id = p_entity_id)
    when 'REPURPOSE_MAP' then exists (select 1 from public.content_repurpose_maps where id = p_entity_id)
    when 'SHOOT_SESSION' then exists (select 1 from public.content_shoot_sessions where id = p_entity_id)
    else false
  end;
$$;

create function private.content_os_assert_link_entity_exists()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.content_os_entity_exists(new.entity_type, new.entity_id) then
    raise exception 'content entity %:% does not exist', new.entity_type, new.entity_id using errcode = '23503';
  end if;
  return new;
end;
$$;

create function private.content_os_assert_root_entity_exists()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.content_os_entity_exists(new.root_entity_type, new.root_entity_id) then
    raise exception 'root content entity %:% does not exist', new.root_entity_type, new.root_entity_id using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger content_task_links_entity_exists before insert or update on public.content_task_links
  for each row execute function private.content_os_assert_link_entity_exists();
create trigger content_workflow_runs_root_exists before insert on public.content_workflow_runs
  for each row when (new.root_entity_type is not null)
  execute function private.content_os_assert_root_entity_exists();
create trigger content_task_links_immutable before update on public.content_task_links
  for each row execute function private.content_os_prevent_mutation();

-- Named URL links (§K). Ordered; no file storage.
create table public.content_task_url_links (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  position smallint not null check (position >= 0),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  url text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  created_at timestamptz not null default now(),
  unique (task_id, position)
);

-- Local TemplateImprovementSuggestion.
create table public.content_task_type_suggestions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  task_type_id uuid not null references public.content_task_types (id) on delete restrict,
  field jsonb not null check (jsonb_typeof(field) = 'object'),
  note text not null default '',
  created_by uuid references public.users (id) on delete restrict,
  created_at timestamptz not null default now()
);
create index content_task_type_suggestions_type_idx on public.content_task_type_suggestions (task_type_id);

do $$
declare t text;
begin
  foreach t in array array[
    'content_workflow_runs', 'content_task_runtime', 'content_task_links', 'content_task_url_links', 'content_task_type_suggestions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

grant select, insert on table public.content_workflow_runs, public.content_task_links, public.content_task_type_suggestions to service_role;
grant select, insert, update on table public.content_task_runtime to service_role;
-- URL links are user-editable lists (add/remove/reorder in Task Detail).
grant select, insert, update, delete on table public.content_task_url_links to service_role;
