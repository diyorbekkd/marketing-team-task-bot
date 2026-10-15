-- DRAFT (Sprint 8B) — NOT APPLIED TO PRODUCTION. Dry-run only.
-- Versioned Task Types and Workflow Templates (contract §G, §L).
-- History is never overwritten: Task Type versions are immutable on insert;
-- Workflow Template versions are DRAFT while built, then PUBLISHED and frozen.

create table public.content_task_types (
  id uuid primary key default gen_random_uuid(),
  -- Stable machine key (e.g. HEAD_REVIEW). Runtime behavior must bind to
  -- this, not to the display name (contract §S5).
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  is_active boolean not null default true,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_task_type_versions (
  id uuid primary key default gen_random_uuid(),
  task_type_id uuid not null references public.content_task_types (id) on delete restrict,
  version integer not null check (version > 0),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '',
  -- requiredFields, optionalFields, defaultAssigneeRule, recommendedDay,
  -- allowedLinkLabels, completionRequirements (lib/task-type.ts shape).
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  review_required boolean not null default false,
  review_stage text check (review_stage is null or review_stage in ('DRAFT', 'FINAL')),
  default_prompt text,
  prompt_version text,
  created_by uuid references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (task_type_id, version),
  unique (task_type_id, id),
  constraint content_task_type_versions_prompt_version_check
    check (default_prompt is null or (prompt_version is not null and char_length(btrim(prompt_version)) between 1 and 40))
);

alter table public.content_task_types
  add constraint content_task_types_current_version_fk
  foreign key (id, current_version_id) references public.content_task_type_versions (task_type_id, id) on delete restrict;

create table public.content_workflow_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  is_active boolean not null default true,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_workflow_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.content_workflow_templates (id) on delete restrict,
  version integer not null check (version > 0),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '',
  module_type text not null check (module_type in (
    'KNOWLEDGE_DEVELOPMENT', 'RESEARCH', 'BLOG', 'REEL_PRODUCTION', 'CAROUSEL_PRODUCTION', 'YOUTUBE_PRODUCTION',
    'DESTINATION_CREATION', 'PERFORMANCE', 'DISTRIBUTION', 'LEARNING', 'OTHER'
  )),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  published_at timestamptz,
  created_by uuid references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (template_id, version),
  unique (template_id, id),
  constraint content_workflow_template_versions_published_check
    check ((status = 'PUBLISHED') = (published_at is not null))
);

alter table public.content_workflow_templates
  add constraint content_workflow_templates_current_version_fk
  foreign key (id, current_version_id) references public.content_workflow_template_versions (template_id, id) on delete restrict;

create table public.content_workflow_steps (
  id uuid primary key default gen_random_uuid(),
  template_version_id uuid not null references public.content_workflow_template_versions (id) on delete restrict,
  step_key text not null check (char_length(btrim(step_key)) between 1 and 120),
  -- The Task Type IDENTITY (not a version): edits are visible to the
  -- builder immediately; the version used is pinned per task at creation.
  task_type_id uuid not null references public.content_task_types (id) on delete restrict,
  name_template text not null check (char_length(btrim(name_template)) between 1 and 200),
  blocking boolean not null default true,
  skippable boolean not null default false,
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  step_order integer not null check (step_order >= 0),
  legacy_ref text,
  created_at timestamptz not null default now(),
  unique (template_version_id, step_key),
  unique (template_version_id, id)
);

create table public.content_workflow_step_dependencies (
  template_version_id uuid not null,
  step_id uuid not null,
  depends_on_step_id uuid not null,
  primary key (step_id, depends_on_step_id),
  -- Composite FKs: both steps must belong to the SAME template version.
  foreign key (template_version_id, step_id) references public.content_workflow_steps (template_version_id, id) on delete restrict,
  foreign key (template_version_id, depends_on_step_id) references public.content_workflow_steps (template_version_id, id) on delete restrict,
  check (step_id <> depends_on_step_id)
);

create index content_task_type_versions_type_idx on public.content_task_type_versions (task_type_id);
create index content_workflow_template_versions_template_idx on public.content_workflow_template_versions (template_id);
create index content_workflow_steps_task_type_idx on public.content_workflow_steps (task_type_id);
create index content_workflow_step_dependencies_depends_on_idx on public.content_workflow_step_dependencies (depends_on_step_id);
create unique index content_task_types_legacy_ref_idx on public.content_task_types (legacy_ref) where legacy_ref is not null;
create unique index content_workflow_templates_legacy_ref_idx on public.content_workflow_templates (legacy_ref) where legacy_ref is not null;

-- Guards -------------------------------------------------------------------

create function private.content_os_guard_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'PUBLISHED' then
      raise exception 'published workflow template versions are immutable' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.status = 'PUBLISHED' then
    raise exception 'published workflow template versions are immutable' using errcode = '55000';
  end if;
  if new.template_id <> old.template_id or new.version <> old.version then
    raise exception 'template version identity cannot change' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function private.content_os_guard_draft_steps()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version_id uuid := case when tg_op = 'DELETE' then old.template_version_id else new.template_version_id end;
  v_status text;
begin
  select status into v_status from public.content_workflow_template_versions where id = v_version_id;
  if v_status = 'PUBLISHED' then
    raise exception 'steps of a published workflow template version are immutable' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.template_version_id <> new.template_version_id then
    raise exception 'a step cannot move between template versions' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function private.content_os_guard_current_template_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.current_version_id is not null and not exists (
    select 1 from public.content_workflow_template_versions
    where id = new.current_version_id and status = 'PUBLISHED'
  ) then
    raise exception 'current workflow template version must be PUBLISHED' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger content_task_type_versions_immutable before update or delete on public.content_task_type_versions
  for each row execute function private.content_os_prevent_mutation();
create trigger content_workflow_template_versions_guard before update or delete on public.content_workflow_template_versions
  for each row execute function private.content_os_guard_template_version();
create trigger content_workflow_steps_guard before insert or update or delete on public.content_workflow_steps
  for each row execute function private.content_os_guard_draft_steps();
create trigger content_workflow_step_dependencies_guard before insert or update or delete on public.content_workflow_step_dependencies
  for each row execute function private.content_os_guard_draft_steps();
create trigger content_workflow_templates_current_guard before insert or update of current_version_id on public.content_workflow_templates
  for each row execute function private.content_os_guard_current_template_version();
create trigger content_task_types_set_updated_at before update on public.content_task_types for each row execute function private.set_updated_at();
create trigger content_workflow_templates_set_updated_at before update on public.content_workflow_templates for each row execute function private.set_updated_at();

-- Access --------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'content_task_types', 'content_task_type_versions', 'content_workflow_templates',
    'content_workflow_template_versions', 'content_workflow_steps', 'content_workflow_step_dependencies'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

grant select, insert, update on table public.content_task_types, public.content_workflow_templates to service_role;
grant select, insert on table public.content_task_type_versions to service_role;
-- UPDATE/DELETE on drafts only (guarded by trigger); published rows are frozen.
grant select, insert, update, delete on table
  public.content_workflow_template_versions, public.content_workflow_steps, public.content_workflow_step_dependencies
  to service_role;
