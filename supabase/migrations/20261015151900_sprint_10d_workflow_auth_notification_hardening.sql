-- Sprint 10D: authoritative Content OS workflow isolation, Telegram login
-- challenge hardening, durable Telegram notification delivery, and archive
-- race protection. Task Bot remains the only migration owner.

-- -------------------------------------------------------------------------
-- Durable workflow-notification outbox
-- -------------------------------------------------------------------------

alter table public.task_notification_deliveries
  add column task_event_id uuid references public.task_events (id) on delete restrict,
  add column event_type text,
  add column payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  add column attempts integer not null default 0 check (attempts between 0 and 5),
  add column next_attempt_at timestamptz not null default statement_timestamp(),
  add column lease_expires_at timestamptz,
  add column worker_id uuid,
  add column sent_at timestamptz,
  add column last_error text check (last_error is null or char_length(last_error) <= 500);

alter table public.task_notification_deliveries
  drop constraint if exists task_notification_deliveries_status_check;

update public.task_notification_deliveries
set status = case when status = 'SENT' then 'SENT' else 'FAILED' end,
    attempts = case when status = 'SENT' then 0 else 5 end,
    failure_reason = case when status = 'SENT' then null else left(coalesce(
      nullif(failure_reason, ''), 'LEGACY_DELIVERY_STATE_NOT_RETRYABLE'
    ), 500) end,
    last_error = case when status = 'SENT' then null else left(coalesce(
      nullif(failure_reason, ''), 'LEGACY_DELIVERY_STATE_NOT_RETRYABLE'
    ), 500) end,
    next_attempt_at = statement_timestamp(),
    completed_at = coalesce(completed_at, statement_timestamp()),
    sent_at = case when status = 'SENT'
      then coalesce(completed_at, statement_timestamp()) else null end;

alter table public.task_notification_deliveries
  alter column status set default 'PENDING',
  add constraint task_notification_deliveries_status_check
    check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  add constraint task_notification_deliveries_delivery_state_check check (
    (status = 'PENDING' and lease_expires_at is null and worker_id is null and sent_at is null)
    or (status = 'SENDING' and lease_expires_at is not null and worker_id is not null and sent_at is null)
    or (status = 'SENT' and lease_expires_at is null and worker_id is null and sent_at is not null)
    or (status = 'FAILED' and (task_event_id is null or attempts = 5)
      and lease_expires_at is null and worker_id is null and sent_at is null)
  );

create index task_notification_deliveries_due_idx
  on public.task_notification_deliveries (next_attempt_at, created_at)
  where status in ('PENDING', 'SENDING');

create unique index task_notification_deliveries_event_recipient_idx
  on public.task_notification_deliveries (task_event_id, recipient_user_id)
  where task_event_id is not null;

create function private.enqueue_task_notification_recipient(
  p_event public.task_events,
  p_event_type text,
  p_recipient_user_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_recipient_user_id is null
    or p_recipient_user_id is not distinct from p_event.actor_id
    or not exists (
      select 1 from public.users
      where id = p_recipient_user_id and is_active
    ) then
    return;
  end if;

  insert into public.task_notification_deliveries (
    dedupe_key,
    recipient_user_id,
    task_event_id,
    event_type,
    payload,
    status,
    next_attempt_at
  ) values (
    'TASK_EVENT:' || p_event.id::text,
    p_recipient_user_id,
    p_event.id,
    p_event_type,
    jsonb_build_object('taskEventId', p_event.id) || coalesce(p_payload, '{}'::jsonb),
    'PENDING',
    statement_timestamp()
  )
  on conflict (task_event_id, recipient_user_id)
    where task_event_id is not null
    do nothing;
end;
$$;

create function private.enqueue_task_notification_outbox()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_request_id uuid;
  v_deadline_request public.deadline_change_requests;
  v_reassign_request public.reassign_requests;
  v_head record;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if not found then return new; end if;

  begin
    v_request_id := nullif(new.metadata ->> 'requestId', '')::uuid;
  exception when invalid_text_representation then
    v_request_id := null;
  end;

  case new.event_type
    when 'TASK_ACCEPTED' then
      perform private.enqueue_task_notification_recipient(new, 'TASK_ACCEPTED', v_task.creator_id);
    when 'REVIEW_REQUESTED' then
      perform private.enqueue_task_notification_recipient(new, 'REVIEW_REQUESTED', v_task.creator_id);
      for v_head in select id from public.users where is_active and role = 'HEAD_OF_MARKETING' loop
        perform private.enqueue_task_notification_recipient(new, 'REVIEW_REQUESTED', v_head.id);
      end loop;
    when 'TASK_COMPLETED' then
      perform private.enqueue_task_notification_recipient(
        new,
        'TASK_COMPLETED',
        case when public.content_os_task_type_code(new.task_id) = 'HEAD_REVIEW'
          then v_task.creator_id else v_task.assignee_id end
      );
    when 'REVISION_REQUESTED' then
      perform private.enqueue_task_notification_recipient(new, 'REVISION_REQUESTED', v_task.assignee_id, new.metadata);
    when 'TASK_BLOCKED' then
      perform private.enqueue_task_notification_recipient(new, 'TASK_BLOCKED', v_task.creator_id, new.metadata);
      for v_head in select id from public.users where is_active and role = 'HEAD_OF_MARKETING' loop
        perform private.enqueue_task_notification_recipient(new, 'TASK_BLOCKED', v_head.id, new.metadata);
      end loop;
    when 'DEADLINE_CHANGE_REQUESTED' then
      for v_head in select id from public.users where is_active and role = 'HEAD_OF_MARKETING' loop
        perform private.enqueue_task_notification_recipient(
          new, 'DEADLINE_CHANGE_REQUESTED', v_head.id, new.metadata
        );
      end loop;
    when 'DEADLINE_CHANGE_APPROVED', 'DEADLINE_CHANGE_REJECTED' then
      select * into v_deadline_request
      from public.deadline_change_requests where id = v_request_id;
      if found then
        perform private.enqueue_task_notification_recipient(
          new,
          case when new.event_type = 'DEADLINE_CHANGE_APPROVED'
            then 'DEADLINE_CHANGE_APPROVED' else 'DEADLINE_CHANGE_REJECTED' end,
          v_deadline_request.requested_by,
          new.metadata
        );
        perform private.enqueue_task_notification_recipient(
          new,
          case when new.event_type = 'DEADLINE_CHANGE_APPROVED'
            then 'DEADLINE_CHANGE_APPROVED' else 'DEADLINE_CHANGE_REJECTED' end,
          v_task.assignee_id,
          new.metadata
        );
      end if;
    when 'DEADLINE_CHANGED' then
      if new.metadata ->> 'mode' = 'DIRECT' then
        perform private.enqueue_task_notification_recipient(new, 'DEADLINE_CHANGED', v_task.assignee_id);
        perform private.enqueue_task_notification_recipient(new, 'DEADLINE_CHANGED', v_task.creator_id);
      end if;
    when 'REASSIGN_REQUESTED' then
      for v_head in select id from public.users where is_active and role = 'HEAD_OF_MARKETING' loop
        perform private.enqueue_task_notification_recipient(new, 'REASSIGN_REQUESTED', v_head.id, new.metadata);
      end loop;
    when 'REASSIGN_APPROVED', 'REASSIGN_REJECTED' then
      select * into v_reassign_request
      from public.reassign_requests where id = v_request_id;
      if found then
        perform private.enqueue_task_notification_recipient(
          new,
          case when new.event_type = 'REASSIGN_APPROVED'
            then 'REASSIGN_APPROVED' else 'REASSIGN_REJECTED' end,
          v_reassign_request.requested_by,
          new.metadata
        );
        if new.event_type = 'REASSIGN_APPROVED' then
          perform private.enqueue_task_notification_recipient(
            new, 'REASSIGN_APPROVED', v_reassign_request.requested_assignee_id, new.metadata
          );
        end if;
      end if;
    when 'ASSIGNEE_CHANGED' then
      if new.metadata ->> 'mode' = 'DIRECT' then
        perform private.enqueue_task_notification_recipient(
          new, 'TASK_REASSIGNED', nullif(new.new_value #>> '{}', '')::uuid
        );
      end if;
    else
      null;
  end case;

  return new;
end;
$$;

create trigger task_events_enqueue_notification_outbox
after insert on public.task_events
for each row execute function private.enqueue_task_notification_outbox();

create function public.claim_task_notification_outbox(
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
  where delivery.status = 'SENDING'
    and delivery.attempts >= 5
    and delivery.lease_expires_at <= statement_timestamp();

  return query
  with candidates as (
    select d.id
    from public.task_notification_deliveries d
    where (
      d.status = 'PENDING' and d.attempts < 5
      and d.next_attempt_at <= statement_timestamp()
    ) or (
      d.status = 'SENDING' and d.attempts < 5
      and d.lease_expires_at <= statement_timestamp()
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

create function public.complete_task_notification_outbox(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_succeeded boolean,
  p_error text default null
)
returns public.task_notification_deliveries
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delivery public.task_notification_deliveries;
begin
  select * into v_delivery
  from public.task_notification_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'notification delivery not found' using errcode = 'P0002';
  end if;
  if v_delivery.status <> 'SENDING' or v_delivery.worker_id <> p_worker_id then
    raise exception 'notification delivery lease is not owned by this worker'
      using errcode = 'PT409';
  end if;

  if p_succeeded then
    update public.task_notification_deliveries
    set status = 'SENT', sent_at = statement_timestamp(), completed_at = statement_timestamp(),
        lease_expires_at = null, worker_id = null, failure_reason = null, last_error = null
    where id = p_delivery_id
    returning * into v_delivery;
  elsif v_delivery.attempts >= 5 then
    update public.task_notification_deliveries
    set status = 'FAILED', completed_at = statement_timestamp(),
        lease_expires_at = null, worker_id = null,
        failure_reason = left(coalesce(nullif(btrim(p_error), ''), 'DELIVERY_FAILED'), 500),
        last_error = left(coalesce(nullif(btrim(p_error), ''), 'DELIVERY_FAILED'), 500)
    where id = p_delivery_id
    returning * into v_delivery;
  else
    update public.task_notification_deliveries
    set status = 'PENDING', completed_at = null,
        lease_expires_at = null, worker_id = null,
        next_attempt_at = statement_timestamp() + case v_delivery.attempts
          when 1 then interval '1 minute'
          when 2 then interval '5 minutes'
          when 3 then interval '15 minutes'
          else interval '1 hour'
        end,
        failure_reason = left(coalesce(nullif(btrim(p_error), ''), 'DELIVERY_FAILED'), 500),
        last_error = left(coalesce(nullif(btrim(p_error), ''), 'DELIVERY_FAILED'), 500)
    where id = p_delivery_id
    returning * into v_delivery;
  end if;

  return v_delivery;
end;
$$;

revoke execute on function private.enqueue_task_notification_recipient(public.task_events, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_task_notification_outbox()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_task_notification_outbox(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_task_notification_outbox(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function private.enqueue_task_notification_recipient(public.task_events, text, uuid, jsonb)
  to service_role;
grant execute on function public.claim_task_notification_outbox(uuid, integer) to service_role;
grant execute on function public.complete_task_notification_outbox(uuid, uuid, boolean, text) to service_role;

-- -------------------------------------------------------------------------
-- Telegram login challenge display code, rate contract, and retention
-- -------------------------------------------------------------------------

create function private.content_os_auth_generate_display_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_hex text := replace(gen_random_uuid()::text, '-', '');
  v_number integer;
begin
  v_number := ('x' || substr(v_hex, 1, 6))::bit(24)::integer;
  return lpad((v_number % 1000000)::text, 6, '0');
end;
$$;

alter table private.content_os_login_challenges
  add column display_code text,
  add column rate_key_hash text;

update private.content_os_login_challenges
set display_code = private.content_os_auth_generate_display_code(),
    rate_key_hash = encode(sha256(convert_to(id::text, 'UTF8')), 'hex');

alter table private.content_os_login_challenges
  alter column display_code set not null,
  alter column rate_key_hash set not null,
  add constraint content_os_login_challenges_display_code_check
    check (display_code ~ '^[0-9]{6}$'),
  add constraint content_os_login_challenges_rate_key_hash_check
    check (rate_key_hash ~ '^[0-9a-f]{64}$');

create index content_os_login_challenges_rate_window_idx
  on private.content_os_login_challenges (rate_key_hash, created_at desc);

create function private.content_os_auth_cleanup_challenges_impl(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_limit not between 1 and 5000 then
    raise exception 'cleanup limit must be between 1 and 5000' using errcode = '22023';
  end if;

  with doomed as (
    select ctid
    from private.content_os_login_challenges
    where (
      status in ('PENDING', 'APPROVED')
      and expires_at <= statement_timestamp() - interval '24 hours'
    ) or (
      status = 'CONSUMED'
      and consumed_at <= statement_timestamp() - interval '7 days'
    ) or (
      status = 'CANCELLED'
      and cancelled_at <= statement_timestamp() - interval '7 days'
    )
    order by created_at
    limit p_limit
  ), deleted as (
    delete from private.content_os_login_challenges c
    using doomed d
    where c.ctid = d.ctid
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

  return v_deleted;
end;
$$;

create function public.content_os_auth_cleanup_challenges(p_limit integer default 500)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.content_os_auth_cleanup_challenges_impl(p_limit);
$$;

drop function public.content_os_auth_create_challenge(text);

create function public.content_os_auth_create_challenge(
  p_verifier_hash text,
  p_rate_key_hash text
)
returns table (
  challenge_id uuid,
  status text,
  expires_at timestamptz,
  display_code text
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_verifier_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid verifier proof' using errcode = '22023';
  end if;
  if p_rate_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid server-derived rate key' using errcode = '22023';
  end if;

  perform private.content_os_auth_cleanup_challenges_impl(100);
  perform pg_advisory_xact_lock(
    hashtextextended('content-os-login-rate:' || lower(p_rate_key_hash), 0)
  );

  if (
    select count(*)
    from private.content_os_login_challenges challenge
    where challenge.rate_key_hash = lower(p_rate_key_hash)
      and challenge.created_at > statement_timestamp() - interval '15 minutes'
  ) >= 5 then
    raise exception 'login challenge rate limit exceeded' using errcode = 'PT429';
  end if;

  if (
    select count(*)
    from private.content_os_login_challenges challenge
    where challenge.rate_key_hash = lower(p_rate_key_hash)
      and challenge.status in ('PENDING', 'APPROVED')
      and challenge.expires_at > statement_timestamp()
  ) >= 3 then
    raise exception 'too many outstanding login challenges' using errcode = 'PT429';
  end if;

  return query
  insert into private.content_os_login_challenges (
    verifier_hash, rate_key_hash, display_code
  ) values (
    lower(p_verifier_hash),
    lower(p_rate_key_hash),
    private.content_os_auth_generate_display_code()
  )
  returning id, private.content_os_login_challenges.status,
    private.content_os_login_challenges.expires_at,
    private.content_os_login_challenges.display_code;
end;
$$;

drop function public.content_os_auth_get_challenge_status(uuid);

create function public.content_os_auth_get_challenge_status(p_challenge_id uuid)
returns table (status text, expires_at timestamptz, display_code text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_challenge private.content_os_login_challenges;
begin
  select * into v_challenge
  from private.content_os_login_challenges
  where id = p_challenge_id;

  if not found then
    return query select 'UNAVAILABLE'::text, null::timestamptz, null::text;
  elsif v_challenge.status in ('PENDING', 'APPROVED')
    and v_challenge.expires_at <= statement_timestamp() then
    return query select 'EXPIRED'::text, v_challenge.expires_at, v_challenge.display_code;
  else
    return query select v_challenge.status, v_challenge.expires_at, v_challenge.display_code;
  end if;
end;
$$;

revoke execute on function private.content_os_auth_generate_display_code()
  from public, anon, authenticated, service_role;
revoke execute on function private.content_os_auth_cleanup_challenges_impl(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_create_challenge(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_get_challenge_status(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.content_os_auth_cleanup_challenges(integer)
  from public, anon, authenticated, service_role;
grant execute on function private.content_os_auth_generate_display_code() to service_role;
grant execute on function private.content_os_auth_cleanup_challenges_impl(integer) to service_role;
grant execute on function public.content_os_auth_create_challenge(text, text) to service_role;
grant execute on function public.content_os_auth_get_challenge_status(uuid) to service_role;
grant execute on function public.content_os_auth_cleanup_challenges(integer) to service_role;

-- -------------------------------------------------------------------------
-- Stable Content OS provenance and MANUAL-only creator management
-- -------------------------------------------------------------------------

create function private.task_uses_manual_creator_rights(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select not exists (
    select 1 from public.content_task_runtime where task_id = p_task_id
  );
$$;

create function private.content_os_guard_single_head_review()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_code text;
  v_source_code text;
begin
  select task_type.code into v_code
  from public.content_task_type_versions version
  join public.content_task_types task_type on task_type.id = version.task_type_id
  where version.id = new.task_type_version_id;

  if v_code <> 'HEAD_REVIEW' then return new; end if;
  if new.source_task_id is null then
    raise exception 'Head Review requires a source Blog task' using errcode = '23514';
  end if;

  -- Serializes both the dedicated completion RPC and any legacy Content OS
  -- runtime writer on the source Blog, so the existence check cannot race.
  perform 1 from public.tasks where id = new.source_task_id for update;

  select public.content_os_task_type_code(new.source_task_id) into v_source_code;
  if v_source_code is distinct from 'BLOG' then
    raise exception 'Head Review source must be a Content OS Blog'
      using errcode = '23514';
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

create trigger content_task_runtime_single_head_review
before insert on public.content_task_runtime
for each row execute function private.content_os_guard_single_head_review();

create or replace function public.content_os_completion_allowed(p_task_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (select 1 from public.task_archives where task_id = p_task_id) then false
    when public.content_os_task_type_code(p_task_id) is distinct from 'HEAD_REVIEW' then true
    else exists (
      select 1
      from public.content_task_runtime review
      join public.tasks blog on blog.id = review.source_task_id
      where review.task_id = p_task_id
        and blog.status = 'DONE'
        and not exists (
          select 1 from public.task_archives archived_blog
          where archived_blog.task_id = blog.id
        )
        and public.content_os_is_source_blog_for_head_review(blog.id, review.task_id)
    )
  end;
$$;

create or replace function public.update_task_content_with_events(
  p_task_id uuid,
  p_actor_id uuid,
  p_title text,
  p_description text,
  p_priority text
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_old_title text;
  v_old_description text;
  v_old_priority text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found or (
    v_actor.role <> 'HEAD_OF_MARKETING'
    and not (
      private.task_uses_manual_creator_rights(p_task_id)
      and v_task.creator_id = p_actor_id
    )
  ) then
    raise exception 'only Head or the creator of a manual task may edit task content'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task content cannot be changed' using errcode = 'PT409';
  end if;

  v_old_title := v_task.title;
  v_old_description := v_task.description;
  v_old_priority := v_task.priority;

  update public.tasks
  set title = btrim(p_title),
      description = nullif(btrim(p_description), ''),
      priority = p_priority
  where id = p_task_id
  returning * into v_task;

  if v_old_title is distinct from v_task.title then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'TITLE_CHANGED', to_jsonb(v_old_title), to_jsonb(v_task.title));
  end if;
  if v_old_description is distinct from v_task.description then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'DESCRIPTION_CHANGED', to_jsonb(v_old_description), to_jsonb(v_task.description));
  end if;
  if v_old_priority is distinct from v_task.priority then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value)
    values (p_task_id, p_actor_id, 'PRIORITY_CHANGED', to_jsonb(v_old_priority), to_jsonb(v_task.priority));
  end if;

  return v_task;
end;
$$;

create or replace function public.reassign_task_with_event(
  p_task_id uuid,
  p_new_assignee_id uuid,
  p_actor_id uuid
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_old_assignee uuid;
  v_cancelled_request public.reassign_requests;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found or (
    v_actor.role <> 'HEAD_OF_MARKETING'
    and not (
      private.task_uses_manual_creator_rights(p_task_id)
      and v_task.creator_id = p_actor_id
    )
  ) then
    raise exception 'only Head or the creator of a manual task may directly reassign'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'a terminal task cannot be reassigned' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.users where id = p_new_assignee_id and is_active) then
    raise exception 'new assignee must be an active team member' using errcode = '22023';
  end if;
  if v_task.assignee_id = p_new_assignee_id then
    return v_task;
  end if;

  update public.reassign_requests
  set status = 'CANCELLED', resolved_by = p_actor_id,
      resolved_at = statement_timestamp(), resolution_note = 'Superseded by direct reassignment'
  where task_id = p_task_id and status = 'PENDING'
  returning * into v_cancelled_request;

  if v_cancelled_request.id is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_task_id, p_actor_id, 'REASSIGN_CANCELLED',
      to_jsonb(v_cancelled_request.current_assignee_id),
      to_jsonb(v_cancelled_request.requested_assignee_id),
      jsonb_build_object('requestId', v_cancelled_request.id, 'reason', 'SUPERSEDED_BY_DIRECT_CHANGE')
    );
  end if;

  v_old_assignee := v_task.assignee_id;
  update public.tasks set assignee_id = p_new_assignee_id
  where id = p_task_id returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_actor_id, 'ASSIGNEE_CHANGED',
    to_jsonb(v_old_assignee), to_jsonb(p_new_assignee_id),
    jsonb_build_object('mode', 'DIRECT')
  );

  return v_task;
end;
$$;

create or replace function public.change_task_deadline_with_event(
  p_task_id uuid,
  p_new_deadline timestamptz,
  p_actor_id uuid
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_old_deadline timestamptz;
  v_cancelled_request public.deadline_change_requests;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found or (
    v_actor.role <> 'HEAD_OF_MARKETING'
    and not (
      private.task_uses_manual_creator_rights(p_task_id)
      and v_task.creator_id = p_actor_id
    )
  ) then
    raise exception 'only Head or the creator of a manual task may directly change the deadline'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'a terminal task deadline cannot be changed' using errcode = 'PT409';
  end if;
  if p_new_deadline <= statement_timestamp() then
    raise exception 'new deadline must be in the future' using errcode = '22023';
  end if;
  if v_task.deadline = p_new_deadline then
    return v_task;
  end if;

  update public.deadline_change_requests
  set status = 'CANCELLED', resolved_by = p_actor_id,
      resolved_at = statement_timestamp(), resolution_note = 'Superseded by direct deadline change'
  where task_id = p_task_id and status = 'PENDING'
  returning * into v_cancelled_request;

  if v_cancelled_request.id is not null then
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_task_id, p_actor_id, 'DEADLINE_CHANGE_CANCELLED',
      to_jsonb(v_cancelled_request.current_deadline),
      to_jsonb(v_cancelled_request.requested_deadline),
      jsonb_build_object('requestId', v_cancelled_request.id, 'reason', 'SUPERSEDED_BY_DIRECT_CHANGE')
    );
  end if;

  v_old_deadline := v_task.deadline;
  update public.tasks set deadline = p_new_deadline
  where id = p_task_id returning * into v_task;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_actor_id, 'DEADLINE_CHANGED',
    to_jsonb(v_old_deadline), to_jsonb(p_new_deadline),
    jsonb_build_object('mode', 'DIRECT')
  );

  return v_task;
end;
$$;

create or replace function public.create_deadline_change_request_with_event(
  p_task_id uuid,
  p_requested_by uuid,
  p_requested_deadline timestamptz,
  p_reason text
)
returns public.deadline_change_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_request public.deadline_change_requests;
  v_requester public.users;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  select * into v_requester from public.users where id = p_requested_by and is_active;
  if not found or v_task.assignee_id <> p_requested_by then
    raise exception 'only the active assignee may request a deadline change' using errcode = '42501';
  end if;
  if v_requester.role = 'HEAD_OF_MARKETING' or (
    private.task_uses_manual_creator_rights(p_task_id)
    and v_task.creator_id = p_requested_by
  ) then
    raise exception 'Head or a manual-task creator must use the direct deadline path'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task cannot change deadline' using errcode = 'PT409';
  end if;
  if p_requested_deadline <= statement_timestamp() then
    raise exception 'requested deadline must be in the future' using errcode = '22023';
  end if;

  begin
    insert into public.deadline_change_requests (
      task_id, requested_by, current_deadline, requested_deadline, reason
    ) values (
      p_task_id, p_requested_by, v_task.deadline, p_requested_deadline, btrim(p_reason)
    ) returning * into v_request;
  exception when unique_violation then
    raise exception 'a pending deadline request already exists' using errcode = 'PT409';
  end;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_requested_by, 'DEADLINE_CHANGE_REQUESTED',
    to_jsonb(v_task.deadline), to_jsonb(p_requested_deadline),
    jsonb_build_object('requestId', v_request.id, 'reason', v_request.reason)
  );
  return v_request;
end;
$$;

create or replace function public.create_reassign_request_with_event(
  p_task_id uuid,
  p_requested_by uuid,
  p_requested_assignee_id uuid,
  p_reason text
)
returns public.reassign_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_request public.reassign_requests;
  v_requester public.users;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  select * into v_requester from public.users where id = p_requested_by and is_active;
  if not found or v_task.assignee_id <> p_requested_by then
    raise exception 'only the active assignee may request reassignment' using errcode = '42501';
  end if;
  if v_requester.role = 'HEAD_OF_MARKETING' or (
    private.task_uses_manual_creator_rights(p_task_id)
    and v_task.creator_id = p_requested_by
  ) then
    raise exception 'Head or a manual-task creator must use the direct reassignment path'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;
  if v_task.status in ('DONE', 'CANCELLED') then
    raise exception 'terminal task cannot be reassigned' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.users where id = p_requested_assignee_id and is_active) then
    raise exception 'requested assignee must be an active team member' using errcode = '22023';
  end if;

  begin
    insert into public.reassign_requests (
      task_id, requested_by, current_assignee_id, requested_assignee_id, reason
    ) values (
      p_task_id, p_requested_by, v_task.assignee_id, p_requested_assignee_id, btrim(p_reason)
    ) returning * into v_request;
  exception when unique_violation then
    raise exception 'a pending reassign request already exists' using errcode = 'PT409';
  end;

  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (
    p_task_id, p_requested_by, 'REASSIGN_REQUESTED',
    to_jsonb(v_task.assignee_id), to_jsonb(p_requested_assignee_id),
    jsonb_build_object('requestId', v_request.id, 'reason', v_request.reason)
  );
  return v_request;
end;
$$;

revoke execute on function private.task_uses_manual_creator_rights(uuid)
  from public, anon, authenticated, service_role;
revoke execute on function private.content_os_guard_single_head_review()
  from public, anon, authenticated, service_role;
grant execute on function private.task_uses_manual_creator_rights(uuid) to service_role;

-- -------------------------------------------------------------------------
-- Atomic Blog completion -> exactly one Head Review
-- -------------------------------------------------------------------------

create function public.content_os_complete_blog_with_head_review(
  p_blog_task_id uuid,
  p_actor_id uuid,
  p_reviewer_id uuid,
  p_review_deadline timestamptz,
  p_review_title text,
  p_review_request_hash text
)
returns table (
  blog_task_id uuid,
  blog_status text,
  head_review_task_id uuid,
  head_review_status text,
  head_review_created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_blog public.tasks;
  v_actor public.users;
  v_reviewer public.users;
  v_review public.tasks;
  v_review_id uuid;
  v_review_count integer;
  v_review_version_id uuid;
  v_blog_entity_id uuid;
  v_creation record;
  v_created boolean := false;
  v_revision_review_id uuid;
begin
  select * into v_blog
  from public.tasks
  where id = p_blog_task_id
  for update;
  if not found then
    raise exception 'Blog task not found' using errcode = 'P0002';
  end if;

  select * into v_actor from public.users where id = p_actor_id and is_active;
  if not found or v_blog.assignee_id <> p_actor_id then
    raise exception 'only the active Blog assignee may complete the Blog'
      using errcode = '42501';
  end if;
  if public.content_os_task_type_code(p_blog_task_id) is distinct from 'BLOG' then
    raise exception 'task is not a Content OS Blog' using errcode = '22023';
  end if;
  if public.content_os_requires_review(p_blog_task_id) then
    raise exception 'review-required Blog cannot use the Head Review completion flow'
      using errcode = 'PT409';
  end if;
  if exists (select 1 from public.task_archives where task_id = p_blog_task_id) then
    raise exception 'archived Blog cannot be completed' using errcode = 'PT409';
  end if;
  if exists (
    select 1
    from public.task_checklists checklist
    join public.task_checklist_items item on item.checklist_id = checklist.id
    where checklist.task_id = p_blog_task_id and not item.is_completed
  ) then
    raise exception 'posting checklist is incomplete' using errcode = '23514';
  end if;
  if v_blog.status not in ('IN_PROGRESS', 'REVISION', 'DONE') then
    raise exception 'Blog cannot be completed from its current status'
      using errcode = 'PT409';
  end if;

  select count(*)::integer into v_review_count
  from public.content_task_runtime runtime
  join public.content_task_type_versions version on version.id = runtime.task_type_version_id
  join public.content_task_types task_type on task_type.id = version.task_type_id
  where runtime.source_task_id = p_blog_task_id
    and task_type.code = 'HEAD_REVIEW';
  if v_review_count > 1 then
    raise exception 'Blog has more than one Head Review' using errcode = 'PT409';
  end if;

  select runtime.task_id into v_review_id
  from public.content_task_runtime runtime
  join public.content_task_type_versions version on version.id = runtime.task_type_version_id
  join public.content_task_types task_type on task_type.id = version.task_type_id
  where runtime.source_task_id = p_blog_task_id
    and task_type.code = 'HEAD_REVIEW'
  order by runtime.created_at, runtime.task_id
  limit 1;

  if v_review_id is null and v_blog.status = 'REVISION' then
    raise exception 'source Blog revision has no Head Review provenance'
      using errcode = 'PT409';
  end if;

  if v_review_id is null then
    if p_review_deadline <= statement_timestamp() then
      raise exception 'Head Review deadline must be in the future' using errcode = '22023';
    end if;
    if char_length(btrim(p_review_title)) not between 1 and 200 then
      raise exception 'Head Review title must contain between 1 and 200 characters'
        using errcode = '22023';
    end if;
    if p_review_request_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'invalid Head Review request hash' using errcode = '22023';
    end if;
    select * into v_reviewer
    from public.users
    where id = p_reviewer_id and is_active;
    if not found then
      raise exception 'Head Review reviewer must be active' using errcode = '22023';
    end if;
    if p_reviewer_id in (v_blog.creator_id, v_blog.assignee_id)
      and v_reviewer.role <> 'HEAD_OF_MARKETING' then
      raise exception 'a non-Head Blog author cannot review their own Blog'
        using errcode = '42501';
    end if;

    select link.entity_id into v_blog_entity_id
    from public.content_task_links link
    where link.task_id = p_blog_task_id
      and link.entity_type = 'BLOG'
      and link.relation = 'PRIMARY';
    if v_blog_entity_id is null then
      raise exception 'Blog task has no PRIMARY Blog entity' using errcode = 'PT409';
    end if;

    select task_type.current_version_id into v_review_version_id
    from public.content_task_types task_type
    where task_type.code = 'HEAD_REVIEW' and task_type.is_active;
    if v_review_version_id is null then
      raise exception 'no current HEAD_REVIEW Task Type version' using errcode = 'PT409';
    end if;

    select * into v_creation
    from public.content_os_create_task_idempotent(
      'CREATE_TASK',
      'head-review:' || p_blog_task_id::text,
      lower(p_review_request_hash),
      p_actor_id,
      p_reviewer_id,
      btrim(p_review_title),
      '',
      'normal',
      p_review_deadline
    );
    v_review_id := v_creation.task_id;
    v_created := v_creation.created;

    insert into public.content_task_runtime (
      task_id,
      task_type_version_id,
      workflow_run_id,
      workflow_template_version_id,
      workflow_step_id,
      source_task_id,
      outcome,
      skip_reason,
      field_values
    ) values (
      v_review_id,
      v_review_version_id,
      null,
      null,
      null,
      p_blog_task_id,
      null,
      null,
      '{}'::jsonb
    )
    on conflict (task_id) do nothing;

    insert into public.content_task_links (task_id, entity_type, entity_id, relation)
    values (v_review_id, 'BLOG', v_blog_entity_id, 'PRIMARY')
    on conflict do nothing;

    insert into public.content_task_links (task_id, entity_type, entity_id, relation)
    select v_review_id, 'KNOWLEDGE_NODE', link.entity_id, 'RELATED'
    from public.content_task_links link
    where link.task_id = p_blog_task_id
      and link.entity_type = 'KNOWLEDGE_NODE'
    on conflict do nothing;
  end if;

  select * into v_review from public.tasks where id = v_review_id for update;
  if not found
    or exists (select 1 from public.task_archives where task_id = v_review_id)
    or not public.content_os_is_source_blog_for_head_review(p_blog_task_id, v_review_id) then
    raise exception 'Head Review provenance is invalid or archived' using errcode = 'PT409';
  end if;

  if v_blog.status = 'IN_PROGRESS' then
    if v_review.status not in ('ASSIGNED', 'IN_PROGRESS') then
      raise exception 'existing Head Review is not active' using errcode = 'PT409';
    end if;

    update public.tasks
    set status = 'DONE', blocked_reason = null,
        completed_at = statement_timestamp(), cancelled_at = null
    where id = p_blog_task_id
    returning * into v_blog;

    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_blog_task_id, p_actor_id, 'STATUS_CHANGED',
      to_jsonb('IN_PROGRESS'::text), to_jsonb('DONE'::text),
      jsonb_build_object('reviewTaskId', v_review_id, 'contentOsBlogCompletion', true)
    );
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_blog_task_id, p_actor_id, 'TASK_COMPLETED',
      to_jsonb('IN_PROGRESS'::text), to_jsonb('DONE'::text),
      jsonb_build_object('reviewTaskId', v_review_id, 'contentOsBlogCompletion', true)
    );
  elsif v_blog.status = 'REVISION' then
    select nullif(event.metadata ->> 'reviewTaskId', '')::uuid
      into v_revision_review_id
    from public.task_events event
    where event.task_id = p_blog_task_id
      and event.event_type = 'REVISION_REQUESTED'
      and event.metadata ? 'reviewTaskId'
    order by event.created_at desc, event.id desc
    limit 1;

    if v_revision_review_id is distinct from v_review_id or v_review.status <> 'BLOCKED' then
      raise exception 'Head Review state changed concurrently' using errcode = 'PT409';
    end if;

    update public.tasks
    set status = 'DONE', blocked_reason = null,
        completed_at = statement_timestamp(), cancelled_at = null
    where id = p_blog_task_id
    returning * into v_blog;

    update public.tasks
    set status = 'ASSIGNED', blocked_reason = null,
        completed_at = null, cancelled_at = null
    where id = v_review_id
    returning * into v_review;

    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_blog_task_id, p_actor_id, 'STATUS_CHANGED',
      to_jsonb('REVISION'::text), to_jsonb('DONE'::text),
      jsonb_build_object('reviewTaskId', v_review_id, 'contentOsBlogCompletion', true)
    );
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_blog_task_id, p_actor_id, 'TASK_COMPLETED',
      to_jsonb('REVISION'::text), to_jsonb('DONE'::text),
      jsonb_build_object('reviewTaskId', v_review_id, 'contentOsBlogCompletion', true)
    );
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      v_review_id, p_actor_id, 'STATUS_CHANGED',
      to_jsonb('BLOCKED'::text), to_jsonb('ASSIGNED'::text),
      jsonb_build_object('sourceTaskId', p_blog_task_id, 'coupledContentOsTransition', true)
    );
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      v_review_id, p_actor_id, 'TASK_UNBLOCKED',
      to_jsonb('BLOCKED'::text), to_jsonb('ASSIGNED'::text),
      jsonb_build_object('sourceTaskId', p_blog_task_id, 'coupledContentOsTransition', true)
    );
  end if;

  return query
  select v_blog.id, v_blog.status, v_review.id, v_review.status, v_created;
end;
$$;

-- -------------------------------------------------------------------------
-- Lifecycle authorization and the generic Blog-completion barrier
-- -------------------------------------------------------------------------

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
  v_is_content_os boolean;
  v_task_type_code text;
  v_is_head boolean;
  v_is_source_blog_author boolean := false;
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
  v_is_head := v_actor.role = 'HEAD_OF_MARKETING';

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.task_archives where task_id = p_task_id) then
    raise exception 'archived task must be restored before mutation' using errcode = 'PT409';
  end if;

  v_old_status := v_task.status;
  if v_old_status = p_new_status then return v_task; end if;

  v_is_content_os := public.content_os_is_task(p_task_id);
  if v_is_content_os then
    v_task_type_code := public.content_os_task_type_code(p_task_id);
  end if;

  if v_task_type_code = 'HEAD_REVIEW' then
    select exists (
      select 1
      from public.content_task_runtime review_runtime
      join public.tasks source_blog on source_blog.id = review_runtime.source_task_id
      where review_runtime.task_id = p_task_id
        and p_actor_id in (source_blog.creator_id, source_blog.assignee_id)
        and public.content_os_is_source_blog_for_head_review(source_blog.id, p_task_id)
    ) into v_is_source_blog_author;
    if v_is_source_blog_author and not v_is_head then
      raise exception 'a non-Head Blog author cannot review their own Blog'
        using errcode = '42501';
    end if;
  end if;

  -- A Content OS Blog can reach DONE only through the dedicated atomic RPC,
  -- which guarantees the same transaction leaves exactly one Head Review.
  if v_is_content_os and v_task_type_code = 'BLOG' and p_new_status = 'DONE' then
    raise exception 'Content OS Blog completion requires the dedicated Head Review RPC'
      using errcode = 'PT409';
  end if;

  v_allowed :=
    (v_old_status = 'ASSIGNED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'IN_PROGRESS' and p_new_status in ('BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status = 'BLOCKED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))
    or (v_old_status = 'REVIEW' and p_new_status in ('DONE', 'REVISION', 'CANCELLED'))
    or (v_old_status = 'REVISION' and p_new_status in ('IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CANCELLED'))
    or (v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED');

  -- Enforce the application lifecycle roles again at the authoritative row
  -- lock. Content OS creator_id never grants generic reviewer/cancel rights.
  if v_allowed then
    if p_new_status = 'CANCELLED' then
      if not v_is_head and (
        v_is_content_os
        or not private.task_uses_manual_creator_rights(p_task_id)
        or v_task.creator_id <> p_actor_id
      ) then
        raise exception 'only Head or the creator of a manual task may cancel'
          using errcode = '42501';
      end if;
    elsif v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED' then
      if not v_is_head then
        raise exception 'only active Head may reopen tasks' using errcode = '42501';
      end if;
    elsif v_old_status = 'REVIEW' and p_new_status in ('DONE', 'REVISION') then
      if v_is_content_os then
        if v_task_type_code = 'HEAD_REVIEW' then
          if not v_is_head and v_task.assignee_id <> p_actor_id then
            raise exception 'only the Head Review assignee or Head may decide the review'
              using errcode = '42501';
          end if;
        elsif not v_is_head then
          raise exception 'only active Head may review this Content OS task'
            using errcode = '42501';
        end if;
      elsif not v_is_head and v_task.creator_id <> p_actor_id then
        raise exception 'only the creator or Head may review this manual task'
          using errcode = '42501';
      end if;
    elsif v_is_content_os and v_task_type_code = 'HEAD_REVIEW' then
      if not v_is_head and v_task.assignee_id <> p_actor_id then
        raise exception 'only the Head Review assignee or Head may move its lifecycle'
          using errcode = '42501';
      end if;
    elsif v_task.assignee_id <> p_actor_id then
      raise exception 'only the task assignee may perform this lifecycle action'
        using errcode = '42501';
    end if;
  end if;

  if v_allowed and p_new_status = 'DONE' and v_is_content_os
    and not public.content_os_completion_allowed(p_task_id) then
    raise exception 'task status changed concurrently' using errcode = 'PT409';
  end if;

  -- Non-Blog Content OS tasks that do not require review retain their narrow
  -- assignee completion path. Head may also complete a Head Review.
  if not v_allowed
    and v_old_status in ('IN_PROGRESS', 'REVISION')
    and p_new_status = 'DONE'
    and v_is_content_os then
    if public.content_os_requires_review(p_task_id) then
      raise exception 'task status changed concurrently' using errcode = 'PT409';
    end if;
    if v_task.assignee_id <> p_actor_id
      and not (v_task_type_code = 'HEAD_REVIEW' and v_is_head) then
      raise exception 'only the assignee may complete this Content OS task'
        using errcode = '42501';
    end if;
    if not public.content_os_completion_allowed(p_task_id) then
      raise exception 'task status changed concurrently' using errcode = 'PT409';
    end if;
    if exists (
      select 1 from public.task_checklists checklist
      join public.task_checklist_items item on item.checklist_id = checklist.id
      where checklist.task_id = p_task_id and not item.is_completed
    ) then
      raise exception 'posting checklist is incomplete' using errcode = '23514';
    end if;
    v_allowed := true;
  end if;

  -- The one workflow-specific DONE -> REVISION operation remains tied to the
  -- exact, active Head Review provenance and its assigned reviewer/Head.
  if not v_allowed
    and v_old_status = 'DONE'
    and p_new_status = 'REVISION'
    and v_is_content_os
    and v_task_type_code = 'BLOG' then
    v_review_task_id := public.content_os_find_revision_review(p_task_id, p_actor_id);
    if v_review_task_id is null then
      raise exception 'only the source Blog''s Head Review may request this revision'
        using errcode = '42501';
    end if;

    select * into v_review_task
    from public.tasks
    where id = v_review_task_id
    for update;

    if not found
      or v_review_task.status <> 'IN_PROGRESS'
      or exists (select 1 from public.task_archives where task_id = v_review_task_id)
      or not public.content_os_revision_allowed(p_task_id, p_actor_id, v_review_task_id) then
      raise exception 'Head Review state changed concurrently' using errcode = 'PT409';
    end if;

    v_review_new_status := 'BLOCKED';
    v_review_blocked_reason := 'Waiting for source Blog revision';
    v_allowed := true;
  end if;

  if not v_allowed then
    raise exception 'task status changed concurrently' using errcode = 'PT409';
  end if;
  if p_new_status = 'BLOCKED' and nullif(btrim(p_reason), '') is null then
    raise exception 'blocked reason is required' using errcode = '22023';
  end if;
  if p_new_status = 'REVIEW' and exists (
    select 1 from public.task_checklists checklist
    join public.task_checklist_items item on item.checklist_id = checklist.id
    where checklist.task_id = p_task_id and not item.is_completed
  ) then
    raise exception 'posting checklist is incomplete' using errcode = '23514';
  end if;

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
      'coupledContentOsTransition', true,
      'reason', v_review_blocked_reason
    );

    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (v_review_task_id, p_actor_id, 'STATUS_CHANGED', to_jsonb(v_review_task.status), to_jsonb(v_review_new_status), v_review_event_metadata);
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (v_review_task_id, p_actor_id, 'TASK_BLOCKED', to_jsonb(v_review_task.status), to_jsonb(v_review_new_status), v_review_event_metadata);
  end if;

  if p_new_status = 'REVISION' then
    insert into public.task_revisions (task_id, requested_by, reason)
    values (p_task_id, p_actor_id, nullif(btrim(p_reason), ''));
  end if;
  return v_task;
end;
$$;

-- -------------------------------------------------------------------------
-- Archive guards and transactional cancellation of pending requests
-- -------------------------------------------------------------------------

create or replace function public.archive_task_with_event(
  p_task_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns public.task_archives
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_archive public.task_archives;
  v_task_type_code text;
  v_deadline_request public.deadline_change_requests;
  v_reassign_request public.reassign_requests;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  select * into v_actor from public.users
  where id = p_actor_id and is_active and role = 'HEAD_OF_MARKETING';
  if not found then
    raise exception 'only active Head may archive tasks' using errcode = '42501';
  end if;

  select * into v_archive from public.task_archives where task_id = p_task_id;
  if found then return v_archive; end if;

  if public.content_os_is_task(p_task_id) then
    v_task_type_code := public.content_os_task_type_code(p_task_id);
  end if;

  if v_task_type_code = 'BLOG' and exists (
    select 1
    from public.content_task_runtime review_runtime
    join public.content_task_type_versions review_version
      on review_version.id = review_runtime.task_type_version_id
    join public.content_task_types review_type
      on review_type.id = review_version.task_type_id
    join public.tasks review_task on review_task.id = review_runtime.task_id
    where review_runtime.source_task_id = p_task_id
      and review_type.code = 'HEAD_REVIEW'
      and review_task.status not in ('DONE', 'CANCELLED')
  ) then
    raise exception 'active Blog review cycle must finish before archiving the Blog'
      using errcode = 'PT409';
  end if;

  if v_task_type_code = 'HEAD_REVIEW'
    and v_task.status not in ('DONE', 'CANCELLED')
    and exists (
      select 1
      from public.content_task_runtime review_runtime
      join public.tasks blog_task on blog_task.id = review_runtime.source_task_id
      where review_runtime.task_id = p_task_id
        and blog_task.status <> 'CANCELLED'
        and public.content_os_is_source_blog_for_head_review(blog_task.id, p_task_id)
    ) then
    raise exception 'active Head Review cycle must finish before archiving the review'
      using errcode = 'PT409';
  end if;

  for v_deadline_request in
    update public.deadline_change_requests
    set status = 'CANCELLED', resolved_by = p_actor_id,
        resolved_at = statement_timestamp(), resolution_note = 'Task archived'
    where task_id = p_task_id and status = 'PENDING'
    returning *
  loop
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_task_id, p_actor_id, 'DEADLINE_CHANGE_CANCELLED',
      to_jsonb(v_deadline_request.current_deadline),
      to_jsonb(v_deadline_request.requested_deadline),
      jsonb_build_object('requestId', v_deadline_request.id, 'reason', 'TASK_ARCHIVED')
    );
  end loop;

  for v_reassign_request in
    update public.reassign_requests
    set status = 'CANCELLED', resolved_by = p_actor_id,
        resolved_at = statement_timestamp(), resolution_note = 'Task archived'
    where task_id = p_task_id and status = 'PENDING'
    returning *
  loop
    insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
    values (
      p_task_id, p_actor_id, 'REASSIGN_CANCELLED',
      to_jsonb(v_reassign_request.current_assignee_id),
      to_jsonb(v_reassign_request.requested_assignee_id),
      jsonb_build_object('requestId', v_reassign_request.id, 'reason', 'TASK_ARCHIVED')
    );
  end loop;

  insert into public.task_archives (task_id, archived_by, reason)
  values (p_task_id, p_actor_id, nullif(btrim(p_reason), ''))
  returning * into v_archive;

  insert into public.task_events (task_id, actor_id, event_type, new_value, metadata)
  values (
    p_task_id, p_actor_id, 'TASK_ARCHIVED', to_jsonb(v_task.status),
    jsonb_strip_nulls(jsonb_build_object('reason', v_archive.reason))
  );
  return v_archive;
end;
$$;

revoke all on function public.content_os_complete_blog_with_head_review(
  uuid, uuid, uuid, timestamptz, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.content_os_complete_blog_with_head_review(
  uuid, uuid, uuid, timestamptz, text, text
) to service_role;

comment on function private.task_uses_manual_creator_rights(uuid) is
  'True only when no content_task_runtime row exists. creator_id grants generic management rights only for these manual tasks.';
comment on function public.content_os_complete_blog_with_head_review(uuid, uuid, uuid, timestamptz, text, text) is
  'The only Content OS Blog completion path. In one transaction it creates/reuses exactly one provenance-linked Head Review and completes the Blog, or resubmits the Blog and resumes the same review.';
comment on function public.claim_task_notification_outbox(uuid, integer) is
  'Leases due durable Telegram notification intents with SKIP LOCKED. Five bounded attempts; expired leases are reclaimable.';
comment on function public.content_os_auth_create_challenge(text, text) is
  'Creates a ten-minute login challenge with a six-digit human confirmation code. rate_key_hash must be a server-derived HMAC/SHA-256 value, never a raw browser-provided key.';
