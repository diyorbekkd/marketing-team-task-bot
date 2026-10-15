-- DRAFT (Sprint 8B) — NOT APPLIED TO PRODUCTION. Dry-run only.
-- Content OS first-class content entities (contract §F). Every FK is
-- ON DELETE RESTRICT (house convention). Enum CHECKs mirror the local
-- `as const` arrays in lib/content-entity.ts at 2cbc1ef.

create table public.content_domains (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_problem_categories (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid not null references public.content_domains (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_problem_parts (
  id uuid primary key default gen_random_uuid(),
  problem_category_id uuid not null references public.content_problem_categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  source_task_id uuid references public.tasks (id) on delete restrict,
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- status (UNPLANNED/PLANNED) is NOT stored: PLANNED <=> a content_blogs row exists.
create table public.content_knowledge_nodes (
  id uuid primary key default gen_random_uuid(),
  problem_part_id uuid not null references public.content_problem_parts (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  source_task_id uuid references public.tasks (id) on delete restrict,
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_blogs (
  id uuid primary key default gen_random_uuid(),
  knowledge_node_id uuid not null references public.content_knowledge_nodes (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  primary_link text check (primary_link is null or primary_link ~* '^https?://'),
  state text not null default 'PLANNED' check (state in ('PLANNED', 'DRAFT', 'APPROVED', 'PUBLISHED')),
  source_task_id uuid references public.tasks (id) on delete restrict,
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_angles (
  id uuid primary key default gen_random_uuid(),
  knowledge_node_id uuid not null references public.content_knowledge_nodes (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  short_description text not null default '',
  category text not null default '',
  pain_score numeric not null default 0 check (pain_score >= 0),
  clarity_score numeric not null default 0 check (clarity_score >= 0),
  evidence_score numeric not null default 0 check (evidence_score >= 0),
  ibox_relevance_score numeric not null default 0 check (ibox_relevance_score >= 0),
  organic_potential numeric not null default 0 check (organic_potential >= 0),
  performance_potential numeric not null default 0 check (performance_potential >= 0),
  usage text not null default 'BOTH' check (usage in ('ORGANIC', 'PERFORMANCE', 'BOTH')),
  priority text not null default 'LATER' check (priority in ('NOW', 'LATER', 'TEST')),
  source_task_id uuid references public.tasks (id) on delete restrict,
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_destinations (
  id uuid primary key default gen_random_uuid(),
  problem_category_id uuid not null references public.content_problem_categories (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 300),
  type text not null check (type in ('YOUTUBE', 'CHECKLIST_OR_PDF', 'EXTERNAL_TOOL_OR_URL')),
  value_proposition text not null default '',
  status text not null default 'PLANNED' check (status in ('PLANNED', 'IN_PROGRESS', 'READY')),
  primary_url text check (primary_url is null or primary_url ~* '^https?://'),
  owner_user_id uuid references public.users (id) on delete restrict,
  deadline date,
  source_task_id uuid references public.tasks (id) on delete restrict,
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_angle_destination_links (
  angle_id uuid not null references public.content_angles (id) on delete restrict,
  destination_id uuid not null references public.content_destinations (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (angle_id, destination_id)
);

create table public.content_repurpose_maps (
  id uuid primary key default gen_random_uuid(),
  blog_id uuid not null references public.content_blogs (id) on delete restrict,
  source_task_id uuid references public.tasks (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_atomic_ideas (
  id uuid primary key default gen_random_uuid(),
  repurpose_map_id uuid not null references public.content_repurpose_maps (id) on delete restrict,
  position smallint not null check (position >= 0),
  text text not null check (char_length(btrim(text)) between 1 and 2000),
  coverage_type text not null check (coverage_type in ('PROBLEM', 'CAUSE', 'CONSEQUENCE', 'SOLUTION', 'OTHER')),
  decision text not null check (decision in ('CREATE_CONTENT', 'BLOG_ONLY', 'LATER')),
  selected_formats text[] not null default '{}'
    check (selected_formats <@ array['REEL', 'CAROUSEL', 'TEXT_POST', 'YOUTUBE']::text[]),
  angle_id uuid references public.content_angles (id) on delete restrict,
  destination_needed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repurpose_map_id, position)
);

-- status / assignee are NOT stored: derived from the session's Shoot task
-- (public.tasks), found through content_task_links.
create table public.content_shoot_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  scheduled_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_materials (
  id uuid primary key default gen_random_uuid(),
  blog_id uuid not null references public.content_blogs (id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  format text not null check (format in ('REEL', 'CAROUSEL', 'TEXT_POST', 'YOUTUBE')),
  -- NULL only for legacy-imported Materials; V1-created Materials always set it.
  primary_atomic_idea_id uuid references public.content_atomic_ideas (id) on delete restrict,
  angle_id uuid references public.content_angles (id) on delete restrict,
  destination_needed boolean not null default false,
  -- A Material may exist without a Destination (approved rule): NULLable.
  destination_id uuid references public.content_destinations (id) on delete restrict,
  cta_type text check (cta_type is null or cta_type in (
    'ENGAGEMENT', 'FOLLOW', 'READ_BLOG', 'WATCH_YOUTUBE', 'NEXT_CONTENT', 'RESOURCE', 'COMMERCIAL', 'CUSTOM'
  )),
  cta_text text check (cta_text is null or char_length(cta_text) <= 1000),
  shoot_session_id uuid references public.content_shoot_sessions (id) on delete restrict,
  status text not null default 'PLANNED' check (status in ('PLANNED', 'IN_PRODUCTION', 'READY', 'PUBLISHED')),
  source_task_id uuid references public.tasks (id) on delete restrict,
  legacy_ref text check (legacy_ref is null or char_length(btrim(legacy_ref)) between 1 and 100),
  legacy_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_materials_cta_pair_check check ((cta_type is null) = (cta_text is null))
);

create table public.content_material_result_reviews (
  material_id uuid primary key references public.content_materials (id) on delete restrict,
  result_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_material_result_review_sources (
  material_id uuid not null references public.content_material_result_reviews (material_id) on delete restrict,
  publish_task_id uuid not null references public.tasks (id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  primary key (material_id, publish_task_id)
);

-- Indexes: FK reverse lookups + legacy ref uniqueness + V1 rules.
create index content_problem_categories_domain_idx on public.content_problem_categories (domain_id);
create index content_problem_parts_category_idx on public.content_problem_parts (problem_category_id);
create index content_knowledge_nodes_part_idx on public.content_knowledge_nodes (problem_part_id);
create index content_blogs_node_idx on public.content_blogs (knowledge_node_id);
create index content_angles_node_idx on public.content_angles (knowledge_node_id);
create index content_destinations_category_idx on public.content_destinations (problem_category_id);
create index content_angle_destination_links_destination_idx on public.content_angle_destination_links (destination_id);
create index content_repurpose_maps_blog_idx on public.content_repurpose_maps (blog_id);
create index content_materials_blog_idx on public.content_materials (blog_id);
create index content_materials_destination_idx on public.content_materials (destination_id) where destination_id is not null;
create index content_materials_shoot_session_idx on public.content_materials (shoot_session_id) where shoot_session_id is not null;
create index content_material_result_reviews_due_idx on public.content_material_result_reviews (result_review_at) where result_review_at is not null;
create index content_material_result_review_sources_task_idx on public.content_material_result_review_sources (publish_task_id);
-- One Material per (Atomic Idea, format): the documented V1 generation rule.
create unique index content_materials_one_per_idea_format_idx
  on public.content_materials (primary_atomic_idea_id, format) where primary_atomic_idea_id is not null;

create unique index content_domains_legacy_ref_idx on public.content_domains (legacy_ref) where legacy_ref is not null;
create unique index content_problem_categories_legacy_ref_idx on public.content_problem_categories (legacy_ref) where legacy_ref is not null;
create unique index content_problem_parts_legacy_ref_idx on public.content_problem_parts (legacy_ref) where legacy_ref is not null;
create unique index content_knowledge_nodes_legacy_ref_idx on public.content_knowledge_nodes (legacy_ref) where legacy_ref is not null;
create unique index content_blogs_legacy_ref_idx on public.content_blogs (legacy_ref) where legacy_ref is not null;
create unique index content_angles_legacy_ref_idx on public.content_angles (legacy_ref) where legacy_ref is not null;
create unique index content_destinations_legacy_ref_idx on public.content_destinations (legacy_ref) where legacy_ref is not null;
create unique index content_materials_legacy_ref_idx on public.content_materials (legacy_ref) where legacy_ref is not null;

-- updated_at maintenance reuses the task-bot's private.set_updated_at().
create trigger content_domains_set_updated_at before update on public.content_domains for each row execute function private.set_updated_at();
create trigger content_problem_categories_set_updated_at before update on public.content_problem_categories for each row execute function private.set_updated_at();
create trigger content_problem_parts_set_updated_at before update on public.content_problem_parts for each row execute function private.set_updated_at();
create trigger content_knowledge_nodes_set_updated_at before update on public.content_knowledge_nodes for each row execute function private.set_updated_at();
create trigger content_blogs_set_updated_at before update on public.content_blogs for each row execute function private.set_updated_at();
create trigger content_angles_set_updated_at before update on public.content_angles for each row execute function private.set_updated_at();
create trigger content_destinations_set_updated_at before update on public.content_destinations for each row execute function private.set_updated_at();
create trigger content_repurpose_maps_set_updated_at before update on public.content_repurpose_maps for each row execute function private.set_updated_at();
create trigger content_atomic_ideas_set_updated_at before update on public.content_atomic_ideas for each row execute function private.set_updated_at();
create trigger content_shoot_sessions_set_updated_at before update on public.content_shoot_sessions for each row execute function private.set_updated_at();
create trigger content_materials_set_updated_at before update on public.content_materials for each row execute function private.set_updated_at();
create trigger content_material_result_reviews_set_updated_at before update on public.content_material_result_reviews for each row execute function private.set_updated_at();
create trigger content_material_result_review_sources_immutable before update or delete on public.content_material_result_review_sources
  for each row execute function private.content_os_prevent_mutation();
create trigger content_angle_destination_links_immutable before update on public.content_angle_destination_links
  for each row execute function private.content_os_prevent_mutation();

-- Fail-closed access (contract §O): RLS on, no policies, service_role only, no DELETE.
do $$
declare t text;
begin
  foreach t in array array[
    'content_domains', 'content_problem_categories', 'content_problem_parts', 'content_knowledge_nodes',
    'content_blogs', 'content_angles', 'content_destinations', 'content_angle_destination_links',
    'content_repurpose_maps', 'content_atomic_ideas', 'content_shoot_sessions', 'content_materials',
    'content_material_result_reviews', 'content_material_result_review_sources'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
end $$;

grant select, insert, update on table
  public.content_domains, public.content_problem_categories, public.content_problem_parts,
  public.content_knowledge_nodes, public.content_blogs, public.content_angles, public.content_destinations,
  public.content_repurpose_maps, public.content_atomic_ideas, public.content_shoot_sessions,
  public.content_materials, public.content_material_result_reviews
  to service_role;
grant select, insert on table public.content_angle_destination_links, public.content_material_result_review_sources to service_role;
