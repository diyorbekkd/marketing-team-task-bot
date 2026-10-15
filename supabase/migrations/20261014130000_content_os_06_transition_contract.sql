-- DRAFT (Sprint 9B) — NOT APPLIED TO PRODUCTION. Dry-run only.
-- Content OS transition contract (docs/persistence/SPRINT_9_TRANSITION_CONTRACT.md).
--
-- 1. Provenance immutability. The existing columns already express the
--    Blog <-> Head Review relation (stable content_task_types.code, the
--    pinned content_task_runtime.task_type_version_id, the concrete
--    content_task_runtime.source_task_id, and insert-only content_task_links),
--    but service_role could UPDATE them, so the proof could be rewritten after
--    the fact. These guards make them write-once.
-- 2. Content OS-owned predicates the Task Bot transition function can call
--    instead of re-implementing Content OS semantics. Stable codes only
--    ('BLOG', 'HEAD_REVIEW'); no title or display-name matching.
--
-- All functions: SECURITY INVOKER, search_path '', STABLE, EXECUTE to
-- service_role only. They read task-bot tables (public.tasks, public.users)
-- that service_role can already SELECT.

-- 1. Provenance immutability ------------------------------------------------

create function private.content_os_guard_runtime_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.task_id <> old.task_id
    or new.task_type_version_id <> old.task_type_version_id
    or new.source_task_id is distinct from old.source_task_id
    or new.workflow_run_id is distinct from old.workflow_run_id
    or new.workflow_template_version_id is distinct from old.workflow_template_version_id
    or new.workflow_step_id is distinct from old.workflow_step_id then
    raise exception 'content_task_runtime provenance (task, pinned version, lineage, workflow step) is write-once'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger content_task_runtime_provenance_immutable before update on public.content_task_runtime
  for each row execute function private.content_os_guard_runtime_provenance();

create function private.content_os_guard_task_type_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code <> old.code then
    raise exception 'content_task_types.code is a stable identifier and cannot change' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger content_task_types_code_immutable before update of code on public.content_task_types
  for each row execute function private.content_os_guard_task_type_code();

-- 2. Predicates ---------------------------------------------------------------

-- A task participates in Content OS iff it has a runtime row.
create function public.content_os_is_task(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (select 1 from public.content_task_runtime where task_id = p_task_id);
$$;

-- Stable code of the task's PINNED Task Type (null for non-Content OS tasks).
create function public.content_os_task_type_code(p_task_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select t.code
  from public.content_task_runtime r
  join public.content_task_type_versions v on v.id = r.task_type_version_id
  join public.content_task_types t on t.id = v.task_type_id
  where r.task_id = p_task_id;
$$;

-- Review-required, exactly as the Content OS runtime decides it
-- (lib/workflow-template.ts effectiveReviewRequired: step override ?? Task
-- Type default), but from the PINNED version and pinned workflow step.
-- Null for non-Content OS tasks. A present override that is not a JSON
-- boolean (or null) is malformed and yields true (fail safe: the task must
-- go through REVIEW; it can never complete directly by accident).
create function public.content_os_requires_review(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when s.overrides is null or not (s.overrides ? 'reviewRequired') or jsonb_typeof(s.overrides -> 'reviewRequired') = 'null'
      then v.review_required
    when jsonb_typeof(s.overrides -> 'reviewRequired') = 'boolean'
      then (s.overrides -> 'reviewRequired')::boolean
    else true
  end
  from public.content_task_runtime r
  join public.content_task_type_versions v on v.id = r.task_type_version_id
  left join public.content_workflow_steps s on s.id = r.workflow_step_id
  where r.task_id = p_task_id;
$$;

-- True iff p_review_task_id is a HEAD_REVIEW Content OS task whose concrete
-- source is p_target_task_id, the target is a BLOG Content OS task, and both
-- tasks' PRIMARY content entity is the SAME Blog entity.
create function public.content_os_is_source_blog_for_head_review(p_target_task_id uuid, p_review_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.content_task_runtime review
    join public.content_task_type_versions review_version on review_version.id = review.task_type_version_id
    join public.content_task_types review_type on review_type.id = review_version.task_type_id
    join public.content_task_runtime target on target.task_id = review.source_task_id
    join public.content_task_type_versions target_version on target_version.id = target.task_type_version_id
    join public.content_task_types target_type on target_type.id = target_version.task_type_id
    join public.content_task_links target_link
      on target_link.task_id = target.task_id and target_link.relation = 'PRIMARY' and target_link.entity_type = 'BLOG'
    join public.content_task_links review_link
      on review_link.task_id = review.task_id and review_link.relation = 'PRIMARY' and review_link.entity_type = 'BLOG'
     and review_link.entity_id = target_link.entity_id
    where review.task_id = p_review_task_id
      and target.task_id = p_target_task_id
      and review_type.code = 'HEAD_REVIEW'
      and target_type.code = 'BLOG'
  );
$$;

-- DONE -> REVISION of the source Blog is allowed only when:
--   * the provenance predicate above holds;
--   * the Blog task is DONE and the Head Review task is IN_PROGRESS (an open
--     decision; a DONE/CANCELLED/BLOCKED review cannot send it back);
--   * the actor is active and is the Head Review task's assignee or the
--     active Head of Marketing.
create function public.content_os_revision_allowed(p_target_task_id uuid, p_actor_id uuid, p_review_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.content_os_is_source_blog_for_head_review(p_target_task_id, p_review_task_id)
    and exists (select 1 from public.tasks where id = p_target_task_id and status = 'DONE')
    and exists (
      select 1
      from public.tasks review_task
      join public.users actor on actor.id = p_actor_id and actor.is_active
      where review_task.id = p_review_task_id
        and review_task.status = 'IN_PROGRESS'
        and (review_task.assignee_id = actor.id or actor.role = 'HEAD_OF_MARKETING')
    );
$$;

-- For callers that only know (target, actor) -- e.g. the existing
-- transition_task_with_events signature: the qualifying Head Review task id,
-- or null when none qualifies (deterministic: oldest qualifying review).
create function public.content_os_find_revision_review(p_target_task_id uuid, p_actor_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select review.task_id
  from public.content_task_runtime review
  where review.source_task_id = p_target_task_id
    and public.content_os_revision_allowed(p_target_task_id, p_actor_id, review.task_id)
  order by review.created_at, review.task_id
  limit 1;
$$;

-- A Head Review may be completed only while its source Blog is DONE (not
-- while the Blog is back in REVISION). True for every other task.
create function public.content_os_completion_allowed(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when public.content_os_task_type_code(p_task_id) is distinct from 'HEAD_REVIEW' then true
    else exists (
      select 1
      from public.content_task_runtime review
      join public.tasks blog on blog.id = review.source_task_id
      where review.task_id = p_task_id
        and blog.status = 'DONE'
        and public.content_os_is_source_blog_for_head_review(blog.id, review.task_id)
    )
  end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.content_os_is_task(uuid)',
    'public.content_os_task_type_code(uuid)',
    'public.content_os_requires_review(uuid)',
    'public.content_os_is_source_blog_for_head_review(uuid, uuid)',
    'public.content_os_revision_allowed(uuid, uuid, uuid)',
    'public.content_os_find_revision_review(uuid, uuid)',
    'public.content_os_completion_allowed(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
