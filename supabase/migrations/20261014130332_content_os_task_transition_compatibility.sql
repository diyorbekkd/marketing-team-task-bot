-- Sprint 9C / A2+A3: finalized Content OS transition compatibility.
--
-- Replaces public.transition_task_with_events in place. The signature,
-- SECURITY INVOKER mode, pinned search_path, grants, legacy matrix, and
-- legacy event behavior stay unchanged. Content OS supplies stable,
-- provenance-aware predicates in its 06_transition_contract migration.
--
-- Additional Content OS-only behavior:
--   * non-review-required IN_PROGRESS/REVISION -> DONE by the assignee;
--   * source BLOG DONE -> REVISION only through its open HEAD_REVIEW, by the
--     review assignee or active Head of Marketing;
--   * that revision atomically parks the same Head Review IN_PROGRESS ->
--     BLOCKED;
--   * Blog resubmission atomically restores that exact review BLOCKED ->
--     ASSIGNED, recovering its id from immutable task-event metadata.
--
-- The two-row changes are deliberately inside this one RPC/transaction. A
-- failure on either task or any audit insert rolls back the whole operation;
-- a response-loss retry sees the already-reached Blog status and is a no-op.
-- No task is created by this function.
-- Expected business refusals use PostgREST's non-retryable PT409 code. A real
-- database-raised 40001 remains untouched and can still be treated as a
-- transient serialization failure by infrastructure/callers.
--
-- Schema-order safety is intentional: the OUTER Content OS condition tests
-- only to_regprocedure(). Content OS functions are planned/called only in a
-- nested block after their contract is known to exist. With no Content OS
-- schema, or after its rollback, every task uses the legacy behavior.
--
-- Rollback:
-- supabase/rollbacks/20261014130332_content_os_task_transition_compatibility.down.sql

create or replace function public.transition_task_with_events(
  p_task_id uuid,
  p_actor_id uuid,
  p_new_status text,
  p_reason text default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_old_status text;
  v_special_event text;
  v_actor public.users;
  v_allowed boolean;
  v_review_task public.tasks;
  v_review_task_id uuid;
  v_review_new_status text;
  v_review_blocked_reason text;
  v_event_metadata jsonb;
  v_review_event_metadata jsonb;
begin
  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found then
    raise exception 'actor is not active' using errcode = '42501';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  v_old_status := v_task.status;
  if v_old_status = p_new_status then return v_task; end if;

  -- Unchanged legacy transition matrix (every task).
  v_allowed :=
    (v_old_status = 'ASSIGNED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'IN_PROGRESS' and p_new_status in ('BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status = 'BLOCKED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'REVIEW' and p_new_status in ('DONE', 'REVISION', 'CANCELLED'))
    or (v_old_status = 'REVISION' and p_new_status in ('IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED');

  -- Content OS completion policy also constrains legacy paths such as
  -- REVIEW -> DONE. This prevents a Head Review from bypassing the source-Blog
  -- gate by first entering REVIEW while that Blog is in REVISION.
  if v_allowed
    and p_new_status = 'DONE'
    and to_regprocedure('public.content_os_completion_allowed(uuid)') is not null then
    if public.content_os_is_task(p_task_id)
      and not public.content_os_completion_allowed(p_task_id) then
      raise exception 'task status changed concurrently' using errcode = 'PT409';
    end if;
  end if;

  -- Content OS compatibility. Keep every content_os_* call inside the nested
  -- block: PL/pgSQL may plan a complete boolean expression before evaluating
  -- its short-circuit branches.
  if not v_allowed
    and ((v_old_status in ('IN_PROGRESS', 'REVISION') and p_new_status = 'DONE')
      or (v_old_status = 'DONE' and p_new_status = 'REVISION'))
    and to_regprocedure('public.content_os_find_revision_review(uuid, uuid)') is not null then
    if public.content_os_is_task(p_task_id) then
      if p_new_status = 'DONE' then
        if public.content_os_requires_review(p_task_id) then
          raise exception 'task status changed concurrently' using errcode = 'PT409';
        end if;
        if v_task.assignee_id <> p_actor_id then
          raise exception 'only the assignee may complete this Content OS task' using errcode = '42501';
        end if;
        if not public.content_os_completion_allowed(p_task_id) then
          raise exception 'task status changed concurrently' using errcode = 'PT409';
        end if;
        if exists (
          select 1 from public.task_checklists c
          join public.task_checklist_items i on i.checklist_id = c.id
          where c.task_id = p_task_id and not i.is_completed
        ) then raise exception 'posting checklist is incomplete' using errcode = '23514'; end if;

        -- A corrected Blog restores the exact Head Review parked by the
        -- corresponding revision request. The immutable event is the recovery
        -- anchor; Content OS provenance is revalidated after the review row is
        -- locked, so stale or forged lineage fails closed.
        if v_old_status = 'REVISION'
          and public.content_os_task_type_code(p_task_id) = 'BLOG' then
          select nullif(e.metadata ->> 'reviewTaskId', '')::uuid
            into v_review_task_id
          from public.task_events e
          where e.task_id = p_task_id
            and e.event_type = 'REVISION_REQUESTED'
            and e.metadata ? 'reviewTaskId'
          order by e.created_at desc, e.id desc
          limit 1;

          if v_review_task_id is null then
            raise exception 'source Blog revision has no Head Review provenance' using errcode = 'PT409';
          end if;

          select * into v_review_task
          from public.tasks
          where id = v_review_task_id
          for update;

          if not found
            or v_review_task.status <> 'BLOCKED'
            or not public.content_os_is_source_blog_for_head_review(p_task_id, v_review_task_id) then
            raise exception 'Head Review state changed concurrently' using errcode = 'PT409';
          end if;

          v_review_new_status := 'ASSIGNED';
          v_review_blocked_reason := null;
        end if;

        v_allowed := true;
      else
        -- Broad creator/Head authorization is intentionally absent. The
        -- predicate proves BLOG + HEAD_REVIEW pinned codes, source_task_id,
        -- shared PRIMARY Blog entity, review status, actor activity, and actor
        -- authority.
        v_review_task_id := public.content_os_find_revision_review(p_task_id, p_actor_id);
        if v_review_task_id is null then
          raise exception 'only the source Blog''s Head Review may request this revision' using errcode = '42501';
        end if;

        select * into v_review_task
        from public.tasks
        where id = v_review_task_id
        for update;

        if not found
          or v_review_task.status <> 'IN_PROGRESS'
          or not public.content_os_revision_allowed(p_task_id, p_actor_id, v_review_task_id) then
          raise exception 'Head Review state changed concurrently' using errcode = 'PT409';
        end if;

        v_review_new_status := 'BLOCKED';
        v_review_blocked_reason := 'Waiting for source Blog revision';
        v_allowed := true;
      end if;
    end if;
  end if;

  if not v_allowed then raise exception 'task status changed concurrently' using errcode = 'PT409'; end if;
  if p_new_status = 'BLOCKED' and nullif(btrim(p_reason), '') is null then
    raise exception 'blocked reason is required' using errcode = '22023';
  end if;
  if p_new_status = 'REVIEW' and exists (
    select 1 from public.task_checklists c
    join public.task_checklist_items i on i.checklist_id = c.id
    where c.task_id = p_task_id and not i.is_completed
  ) then raise exception 'posting checklist is incomplete' using errcode = '23514'; end if;

  update public.tasks set
    status = p_new_status,
    blocked_reason = case when p_new_status = 'BLOCKED' then btrim(p_reason) else null end,
    completed_at = case when p_new_status = 'DONE' then statement_timestamp() else null end,
    cancelled_at = case when p_new_status = 'CANCELLED' then statement_timestamp() else null end
  where id = p_task_id returning * into v_task;

  if v_review_new_status is not null then
    update public.tasks set
      status = v_review_new_status,
      blocked_reason = v_review_blocked_reason,
      completed_at = null,
      cancelled_at = null
    where id = v_review_task_id;
  end if;

  v_event_metadata :=
    case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end
    || case when v_review_task_id is null then '{}'::jsonb else jsonb_build_object('reviewTaskId', v_review_task_id) end;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (p_task_id, p_actor_id, 'STATUS_CHANGED', to_jsonb(v_old_status), to_jsonb(p_new_status), v_event_metadata);
  v_special_event := case
    when v_old_status = 'ASSIGNED' and p_new_status = 'IN_PROGRESS' then 'TASK_ACCEPTED'
    when p_new_status = 'BLOCKED' then 'TASK_BLOCKED'
    when v_old_status = 'BLOCKED' then 'TASK_UNBLOCKED'
    when p_new_status = 'REVIEW' then 'REVIEW_REQUESTED'
    when p_new_status = 'REVISION' then 'REVISION_REQUESTED'
    when p_new_status = 'DONE' then 'TASK_COMPLETED'
    when p_new_status = 'CANCELLED' then 'TASK_CANCELLED'
    when v_old_status in ('DONE', 'CANCELLED') then 'TASK_REOPENED'
    else null end;
  if v_special_event is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (p_task_id, p_actor_id, v_special_event, to_jsonb(v_old_status), to_jsonb(p_new_status), v_event_metadata);
  end if;

  if v_review_new_status is not null then
    v_review_event_metadata := jsonb_build_object(
      'sourceTaskId', p_task_id,
      'coupledContentOsTransition', true
    ) || case
      when v_review_new_status = 'BLOCKED' then jsonb_build_object('reason', v_review_blocked_reason)
      else '{}'::jsonb
    end;

    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (v_review_task_id, p_actor_id, 'STATUS_CHANGED', to_jsonb(v_review_task.status), to_jsonb(v_review_new_status), v_review_event_metadata);

    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      v_review_task_id,
      p_actor_id,
      case when v_review_new_status = 'BLOCKED' then 'TASK_BLOCKED' else 'TASK_UNBLOCKED' end,
      to_jsonb(v_review_task.status),
      to_jsonb(v_review_new_status),
      v_review_event_metadata
    );
  end if;

  if p_new_status = 'REVISION' then
    insert into public.task_revisions (task_id, requested_by, reason)
    values (p_task_id, p_actor_id, nullif(btrim(p_reason), ''));
  end if;
  return v_task;
end;
$$;

comment on function public.transition_task_with_events(uuid, uuid, text, text) is
  'Task lifecycle transition with audit events. Legacy matrix for every task; Content OS predicates permit assignee-only direct completion for non-review-required tasks and provenance-gated Blog revision. Blog revision atomically parks the same Head Review as BLOCKED; Blog resubmission atomically restores it as ASSIGNED.';

-- The first eight migrations are already live and therefore immutable. Their
-- PL/pgSQL bodies used a manually raised serialization_failure for ordinary
-- business refusals. Normalize only those explicit raises in currently
-- effective Task Bot functions. Engine-generated serialization failures are
-- not caught or rewritten and retain SQLSTATE 40001.
do $normalize_task_bot_business_errors$
declare
  v_function record;
  v_definition text;
begin
  for v_function in
    select p.oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~* 'errcode[[:space:]]*=[[:space:]]*''40001'''
    order by n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid)
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_function.oid);
    v_definition := replace(v_definition, '40001', 'PT409');
    execute v_definition;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~* 'errcode[[:space:]]*=[[:space:]]*''40001'''
  ) then
    raise exception 'Task Bot business SQLSTATE normalization was incomplete';
  end if;
end
$normalize_task_bot_business_errors$;
