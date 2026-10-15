-- Sprint 10E fix: close the legacy notification compatibility defect and
-- enforce reviewer independence for every Content OS Head Review path.

-- -------------------------------------------------------------------------
-- Legacy inline assignment delivery versus the task-event outbox
-- -------------------------------------------------------------------------

-- Rows without a task event belong to the legacy inline sender. A 10D worker
-- may already have leased one before this migration; terminalize that unknown
-- legacy outcome once, without attempting another external delivery.
update public.task_notification_deliveries
set status = 'FAILED',
    attempts = 0,
    completed_at = statement_timestamp(),
    lease_expires_at = null,
    worker_id = null,
    sent_at = null,
    failure_reason = 'LEGACY_INLINE_DELIVERY_OUTCOME_UNKNOWN',
    last_error = 'LEGACY_INLINE_DELIVERY_OUTCOME_UNKNOWN'
where task_event_id is null
  and status in ('PENDING', 'SENDING');

drop index if exists public.task_notification_deliveries_due_idx;
create index task_notification_deliveries_due_idx
  on public.task_notification_deliveries (next_attempt_at, created_at)
  where task_event_id is not null
    and event_type is not null
    and status in ('PENDING', 'SENDING');

create or replace function public.claim_task_notification_outbox(
  p_worker_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  task_event_id uuid,
  event_type text,
  recipient_user_id uuid,
  payload jsonb,
  attempts integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_worker_id is null or p_limit not between 1 and 100 then
    raise exception 'worker id and limit between 1 and 100 are required'
      using errcode = '22023';
  end if;

  update public.task_notification_deliveries delivery
  set status = 'FAILED', completed_at = statement_timestamp(),
      lease_expires_at = null, worker_id = null,
      failure_reason = coalesce(delivery.failure_reason, 'WORKER_LEASE_EXPIRED_AFTER_FINAL_ATTEMPT'),
      last_error = coalesce(delivery.last_error, 'WORKER_LEASE_EXPIRED_AFTER_FINAL_ATTEMPT')
  where delivery.task_event_id is not null
    and delivery.event_type is not null
    and delivery.status = 'SENDING'
    and delivery.attempts >= 5
    and delivery.lease_expires_at <= statement_timestamp();

  return query
  with candidates as (
    select d.id
    from public.task_notification_deliveries d
    where d.task_event_id is not null
      and d.event_type is not null
      and (
        (d.status = 'PENDING' and d.attempts < 5
          and d.next_attempt_at <= statement_timestamp())
        or (d.status = 'SENDING' and d.attempts < 5
          and d.lease_expires_at <= statement_timestamp())
      )
    order by d.next_attempt_at, d.created_at, d.id
    for update skip locked
    limit p_limit
  )
  update public.task_notification_deliveries d
  set status = 'SENDING',
      attempts = d.attempts + 1,
      worker_id = p_worker_id,
      lease_expires_at = statement_timestamp() + interval '2 minutes',
      last_error = null
  from candidates c
  where d.id = c.id
  returning d.id, d.task_event_id, d.event_type, d.recipient_user_id,
    d.payload, d.attempts;
end;
$$;

-- -------------------------------------------------------------------------
-- Immutable Blog provenance and independent Head Review assignment
-- -------------------------------------------------------------------------

create function public.content_os_head_review_source_author_id(p_review_task_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select source_blog.assignee_id
  from public.content_task_runtime review_runtime
  join public.tasks source_blog on source_blog.id = review_runtime.source_task_id
  where review_runtime.task_id = p_review_task_id
    and public.content_os_is_source_blog_for_head_review(
      source_blog.id,
      review_runtime.task_id
    );
$$;

-- Task Bot's Telegram/Mini App action endpoint receives the review id, while
-- the established Content OS transition contract moves the source Blog to
-- REVISION and parks that same review. Resolve immutable provenance here and
-- return the clicked review's post-state to the shared application service.
create function public.content_os_request_head_review_revision(
  p_review_task_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_blog_id uuid;
  v_source_author_id uuid;
  v_review public.tasks;
  v_actor public.users;
begin
  select runtime.source_task_id, source_blog.assignee_id
    into v_source_blog_id, v_source_author_id
  from public.content_task_runtime runtime
  join public.tasks source_blog on source_blog.id = runtime.source_task_id
  where runtime.task_id = p_review_task_id
    and public.content_os_is_source_blog_for_head_review(
      runtime.source_task_id,
      runtime.task_id
    );
  if v_source_blog_id is null then
    raise exception 'task is not a provenance-linked Head Review'
      using errcode = '22023';
  end if;

  select * into v_review from public.tasks where id = p_review_task_id;
  select * into v_actor from public.users where id = p_actor_id and is_active;
  if v_actor.id is null
    or p_actor_id = v_source_author_id
    or (p_actor_id <> v_review.assignee_id
      and v_actor.role <> 'HEAD_OF_MARKETING') then
    raise exception 'only the independent reviewer or non-author Head may request revision'
      using errcode = '42501';
  end if;

  perform public.transition_task_with_events(
    v_source_blog_id,
    p_actor_id,
    'REVISION',
    p_reason
  );
  select * into v_review from public.tasks where id = p_review_task_id;
  return v_review;
end;
$$;

-- Replacing the existing provenance trigger keeps creation through
-- content_os_complete_blog_with_head_review atomic: an invalid author/reviewer
-- pairing rolls the task creation back with the runtime link.
create or replace function private.content_os_guard_single_head_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_source_code text;
  v_review_assignee uuid;
  v_source_author uuid;
begin
  select task_type.code into v_code
  from public.content_task_type_versions version
  join public.content_task_types task_type on task_type.id = version.task_type_id
  where version.id = new.task_type_version_id;

  if v_code <> 'HEAD_REVIEW' then return new; end if;
  if new.source_task_id is null then
    raise exception 'Head Review requires a source Blog task' using errcode = '23514';
  end if;

  -- Every assignment mutation for this pair takes the same transaction lock.
  -- This prevents concurrent Blog-author and reviewer changes from each
  -- validating against the other's old value.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.source_task_id::text, 510)
  );

  -- Serializes dedicated completion and legacy runtime writers on the source.
  perform 1 from public.tasks where id = new.source_task_id for update;

  select public.content_os_task_type_code(new.source_task_id) into v_source_code;
  if v_source_code is distinct from 'BLOG' then
    raise exception 'Head Review source must be a Content OS Blog'
      using errcode = '23514';
  end if;

  select review_task.assignee_id, source_blog.assignee_id
    into v_review_assignee, v_source_author
  from public.tasks review_task
  join public.tasks source_blog on source_blog.id = new.source_task_id
  where review_task.id = new.task_id;

  if v_review_assignee is null then
    raise exception 'Head Review task is missing' using errcode = 'P0002';
  end if;
  if v_review_assignee = v_source_author then
    raise exception 'a Blog author cannot review their own Blog'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.content_task_runtime existing
    join public.content_task_type_versions version
      on version.id = existing.task_type_version_id
    join public.content_task_types task_type on task_type.id = version.task_type_id
    where existing.source_task_id = new.source_task_id
      and task_type.code = 'HEAD_REVIEW'
      and existing.task_id <> new.task_id
  ) then
    raise exception 'a Blog may have exactly one Head Review'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

create function private.enforce_content_os_review_assignment_independence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task_type_code text;
  v_source_blog_id uuid;
  v_other_assignee uuid;
begin
  if new.assignee_id is not distinct from old.assignee_id then return new; end if;

  v_task_type_code := public.content_os_task_type_code(new.id);
  if v_task_type_code = 'HEAD_REVIEW' then
    select runtime.source_task_id into v_source_blog_id
    from public.content_task_runtime runtime
    where runtime.task_id = new.id;
  elsif v_task_type_code = 'BLOG' then
    v_source_blog_id := new.id;
  else
    return new;
  end if;

  if v_source_blog_id is null then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_source_blog_id::text, 510)
  );

  if v_task_type_code = 'HEAD_REVIEW' then
    select source_blog.assignee_id into v_other_assignee
    from public.tasks source_blog
    where source_blog.id = v_source_blog_id;
  else
    select review_task.assignee_id into v_other_assignee
    from public.content_task_runtime review_runtime
    join public.content_task_type_versions review_version
      on review_version.id = review_runtime.task_type_version_id
    join public.content_task_types review_type
      on review_type.id = review_version.task_type_id
    join public.tasks review_task on review_task.id = review_runtime.task_id
    where review_runtime.source_task_id = new.id
      and review_type.code = 'HEAD_REVIEW';
  end if;

  if new.assignee_id = v_other_assignee then
    raise exception 'a Blog author cannot review their own Blog'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger tasks_enforce_content_os_review_assignment_independence
before update of assignee_id on public.tasks
for each row
when (old.assignee_id is distinct from new.assignee_id)
execute function private.enforce_content_os_review_assignment_independence();

-- Refuse to install the new authority over an already-invalid pair. Existing
-- data must be repaired deliberately, never silently reassigned by migration.
do $$
begin
  if exists (
    select 1
    from public.content_task_runtime review_runtime
    join public.content_task_type_versions review_version
      on review_version.id = review_runtime.task_type_version_id
    join public.content_task_types review_type
      on review_type.id = review_version.task_type_id
    join public.tasks review_task on review_task.id = review_runtime.task_id
    join public.tasks source_blog on source_blog.id = review_runtime.source_task_id
    where review_type.code = 'HEAD_REVIEW'
      and review_task.assignee_id = source_blog.assignee_id
  ) then
    raise exception 'existing Head Review is assigned to its source Blog author'
      using errcode = '23514';
  end if;
end;
$$;

-- Source-Blog revision is a reviewer decision. Head may supervise only when
-- Head is not the Blog author; the assigned reviewer remains independently
-- authorized regardless of role.
create or replace function public.content_os_revision_allowed(
  p_target_task_id uuid,
  p_actor_id uuid,
  p_review_task_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select public.content_os_is_source_blog_for_head_review(
      p_target_task_id,
      p_review_task_id
    )
    and exists (
      select 1
      from public.tasks source_blog
      where source_blog.id = p_target_task_id
        and source_blog.status = 'DONE'
        and source_blog.assignee_id <> p_actor_id
    )
    and exists (
      select 1
      from public.tasks review_task
      join public.users actor on actor.id = p_actor_id and actor.is_active
      where review_task.id = p_review_task_id
        and review_task.status = 'IN_PROGRESS'
        and (
          review_task.assignee_id = actor.id
          or actor.role = 'HEAD_OF_MARKETING'
        )
    );
$$;

-- transition_task_with_events remains the single status writer. This event
-- guard is deliberately downstream of its row update: rejecting the semantic
-- event aborts and rolls back the whole RPC transaction, while keeping the
-- final actor matrix independent of any older broad Head branch in that RPC.
create function private.enforce_content_os_head_review_event_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task_type_code text;
  v_task public.tasks;
  v_actor public.users;
  v_source_blog_id uuid;
  v_source_author uuid;
  v_old_status text;
  v_new_status text;
  v_is_coupled boolean;
  v_review_task public.tasks;
begin
  if new.event_type <> 'STATUS_CHANGED' then return new; end if;

  v_task_type_code := public.content_os_task_type_code(new.task_id);
  if v_task_type_code = 'BLOG' then
    v_old_status := new.old_value #>> '{}';
    v_new_status := new.new_value #>> '{}';
    if v_old_status = 'DONE' and v_new_status = 'REVISION' then
      select * into v_task from public.tasks where id = new.task_id;
      select * into v_actor from public.users where id = new.actor_id and is_active;
      select * into v_review_task
      from public.tasks
      where id = nullif(new.metadata ->> 'reviewTaskId', '')::uuid;

      -- The transition has already parked the review before its events are
      -- inserted, so validate the post-state here rather than calling the
      -- pre-transition predicate that requires DONE/IN_PROGRESS.
      if v_actor.id is null
        or v_review_task.id is null
        or v_review_task.status <> 'BLOCKED'
        or new.actor_id = v_task.assignee_id
        or (new.actor_id <> v_review_task.assignee_id
          and v_actor.role <> 'HEAD_OF_MARKETING')
        or not public.content_os_is_source_blog_for_head_review(
          new.task_id,
          v_review_task.id
        ) then
        raise exception 'actor may not request revision for this Blog'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;
  if v_task_type_code is distinct from 'HEAD_REVIEW' then return new; end if;

  select * into v_task from public.tasks where id = new.task_id;
  select * into v_actor from public.users where id = new.actor_id and is_active;
  select runtime.source_task_id, source_blog.assignee_id
    into v_source_blog_id, v_source_author
  from public.content_task_runtime runtime
  join public.tasks source_blog on source_blog.id = runtime.source_task_id
  where runtime.task_id = new.task_id
    and public.content_os_is_source_blog_for_head_review(
      source_blog.id,
      runtime.task_id
    );

  if v_actor.id is null or v_source_blog_id is null then
    raise exception 'Head Review actor or provenance is invalid'
      using errcode = '42501';
  end if;

  v_old_status := new.old_value #>> '{}';
  v_new_status := new.new_value #>> '{}';
  v_is_coupled := coalesce((new.metadata ->> 'coupledContentOsTransition')::boolean, false);

  -- Blog resubmission resumes the same parked review; this is a coupled source
  -- operation, not review authority granted to the Blog author.
  if v_is_coupled
    and v_old_status = 'BLOCKED'
    and v_new_status = 'ASSIGNED'
    and new.actor_id = v_source_author
    and nullif(new.metadata ->> 'sourceTaskId', '')::uuid = v_source_blog_id then
    return new;
  end if;

  -- Both the direct REVIEW -> REVISION shape and the normal coupled
  -- IN_PROGRESS -> BLOCKED shape use the same final revision matrix.
  if (v_old_status = 'REVIEW' and v_new_status = 'REVISION')
    or (v_is_coupled and v_old_status = 'IN_PROGRESS' and v_new_status = 'BLOCKED') then
    if new.actor_id = v_source_author
      or (new.actor_id <> v_task.assignee_id
        and v_actor.role <> 'HEAD_OF_MARKETING') then
      raise exception 'only the independent reviewer or non-author Head may request revision'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if v_new_status = 'DONE' then
    if new.actor_id <> v_task.assignee_id or new.actor_id = v_source_author then
      raise exception 'only the active assigned reviewer may approve a Head Review'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Cancellation and terminal reopen remain Head administrative operations.
  if v_new_status = 'CANCELLED'
    or (v_old_status in ('DONE', 'CANCELLED') and v_new_status = 'ASSIGNED') then
    if v_actor.role <> 'HEAD_OF_MARKETING' then
      raise exception 'only active Head may perform this Head Review administration'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.actor_id <> v_task.assignee_id or new.actor_id = v_source_author then
    raise exception 'only the active assigned reviewer may move the Head Review lifecycle'
      using errcode = '42501';
  end if;
  return new;
exception
  when invalid_text_representation then
    raise exception 'Head Review transition provenance is invalid'
      using errcode = 'PT409';
end;
$$;

create trigger task_events_enforce_content_os_head_review_actor
before insert on public.task_events
for each row execute function private.enforce_content_os_head_review_event_actor();

revoke all on function public.content_os_head_review_source_author_id(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_request_head_review_revision(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke execute on function private.enforce_content_os_review_assignment_independence()
  from public, anon, authenticated, service_role;
revoke execute on function private.enforce_content_os_head_review_event_actor()
  from public, anon, authenticated, service_role;
grant execute on function public.content_os_head_review_source_author_id(uuid)
  to service_role;
grant execute on function public.content_os_request_head_review_revision(uuid, uuid, text)
  to service_role;
grant execute on function private.enforce_content_os_review_assignment_independence()
  to service_role;
grant execute on function private.enforce_content_os_head_review_event_actor()
  to service_role;

comment on function public.content_os_head_review_source_author_id(uuid) is
  'Stable provenance lookup used to reject Head Review self-review in shared application authorization.';
comment on function public.content_os_request_head_review_revision(uuid, uuid, text) is
  'Task Bot transport adapter: resolves a Head Review to its source Blog and executes the coupled revision transition.';
comment on function public.claim_task_notification_outbox(uuid, integer) is
  'Leases only durable task-event notification intents; legacy inline assignment rows are never worker input.';
