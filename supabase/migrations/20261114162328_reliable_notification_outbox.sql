-- Durable, per-recipient retry queue for assignment/workflow Telegram messages,
-- plus retry-aware claim ledgers for scheduled reports and reminders.

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (char_length(dedupe_key) between 1 and 200),
  notification_type text not null check (notification_type in ('ASSIGNMENT', 'BULK_ASSIGNMENT', 'WORKFLOW', 'REPORT')),
  recipient_user_id uuid not null references public.users (id) on delete restrict,
  task_id uuid references public.tasks (id) on delete restrict,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'PENDING' check (status in ('PENDING', 'CLAIMED', 'SENT', 'FAILED')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_outbox_due_idx
  on public.notification_outbox (next_attempt_at, created_at)
  where status in ('PENDING', 'FAILED', 'CLAIMED') and attempt_count < 5;

create table public.user_notification_preferences (
  user_id uuid primary key references public.users (id) on delete restrict,
  assignments boolean not null default true,
  workflow boolean not null default true,
  reminders boolean not null default true,
  daily_check boolean not null default true,
  reports boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_notification_preferences_set_updated_at
before update on public.user_notification_preferences
for each row execute function private.set_updated_at();

create function public.update_user_notification_preferences(
  p_user_id uuid,
  p_assignments boolean,
  p_workflow boolean,
  p_reminders boolean,
  p_daily_check boolean,
  p_reports boolean
)
returns public.user_notification_preferences
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.user_notification_preferences;
begin
  if not exists (select 1 from public.users where id = p_user_id and is_active) then
    raise exception 'user must be active' using errcode = '42501';
  end if;

  insert into public.user_notification_preferences (
    user_id, assignments, workflow, reminders, daily_check, reports
  ) values (
    p_user_id, p_assignments, p_workflow, p_reminders, p_daily_check, p_reports
  )
  on conflict (user_id) do update set
    assignments = excluded.assignments,
    workflow = excluded.workflow,
    reminders = excluded.reminders,
    daily_check = excluded.daily_check,
    reports = excluded.reports
  returning * into v_row;

  return v_row;
end;
$$;

create trigger notification_outbox_set_updated_at
before update on public.notification_outbox
for each row execute function private.set_updated_at();

create function public.enqueue_notification_outbox(
  p_dedupe_key text,
  p_notification_type text,
  p_recipient_user_id uuid,
  p_task_id uuid,
  p_payload jsonb
)
returns public.notification_outbox
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.notification_outbox;
begin
  if not exists (
    select 1 from public.users where id = p_recipient_user_id and is_active
  ) then
    raise exception 'recipient must be active' using errcode = '22023';
  end if;

  insert into public.notification_outbox (
    dedupe_key, notification_type, recipient_user_id, task_id, payload
  ) values (
    p_dedupe_key, p_notification_type, p_recipient_user_id, p_task_id, p_payload
  )
  on conflict (dedupe_key) do update
    set dedupe_key = excluded.dedupe_key
  returning * into v_row;

  return v_row;
end;
$$;

create function public.claim_notification_outbox(p_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claimed_id uuid;
begin
  update public.notification_outbox
  set status = 'CLAIMED',
      attempt_count = attempt_count + 1,
      claimed_at = statement_timestamp(),
      next_attempt_at = statement_timestamp(),
      last_error = null
  where id = p_id
    and attempt_count < 5
    and (
      (status in ('PENDING', 'FAILED') and next_attempt_at <= statement_timestamp())
      or (status = 'CLAIMED' and claimed_at < statement_timestamp() - interval '15 minutes')
    )
  returning id into v_claimed_id;

  return v_claimed_id is not null;
end;
$$;

create function public.claim_due_notification_outbox(p_limit integer default 25)
returns setof public.notification_outbox
language sql
security invoker
set search_path = ''
as $$
  with due as (
    select id
    from public.notification_outbox
    where attempt_count < 5
      and (
        (status in ('PENDING', 'FAILED') and next_attempt_at <= statement_timestamp())
        or (status = 'CLAIMED' and claimed_at < statement_timestamp() - interval '15 minutes')
      )
    order by next_attempt_at, created_at
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.notification_outbox as delivery
  set status = 'CLAIMED',
      attempt_count = delivery.attempt_count + 1,
      claimed_at = statement_timestamp(),
      next_attempt_at = statement_timestamp(),
      last_error = null
  from due
  where delivery.id = due.id
  returning delivery.*;
$$;

create function public.complete_notification_outbox(
  p_id uuid,
  p_sent boolean,
  p_error text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.notification_outbox
  set status = case when p_sent then 'SENT' else 'FAILED' end,
      sent_at = case when p_sent then statement_timestamp() else null end,
      last_error = case when p_sent then null else left(coalesce(p_error, 'DELIVERY_FAILED'), 1000) end,
      next_attempt_at = case
        when p_sent then statement_timestamp()
        else statement_timestamp() + make_interval(mins => least(60, power(2, attempt_count)::integer))
      end
  where id = p_id and status = 'CLAIMED';

  -- Scheduled reports are represented in both the generic delivery outbox
  -- and the reporting audit ledger. Reconcile both rows in this transaction
  -- so a successful cron retry cannot leave the report ledger marked FAILED.
  if p_sent then
    update public.report_deliveries as report
    set status = 'SENT',
        failure_reason = null,
        completed_at = statement_timestamp()
    from public.notification_outbox as delivery
    where delivery.id = p_id
      and delivery.notification_type = 'REPORT'
      and delivery.dedupe_key like 'report:%:%:%'
      and report.report_type = split_part(delivery.dedupe_key, ':', 2)
      and report.interval_key = split_part(delivery.dedupe_key, ':', 3)
      and report.recipient_user_id = delivery.recipient_user_id;
  end if;
end;
$$;

alter table public.report_deliveries
  add column attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  add column next_attempt_at timestamptz not null default now(),
  add column claimed_at timestamptz;

update public.report_deliveries
set attempt_count = case when status = 'CLAIMED' then 1 else 0 end,
    claimed_at = case when status = 'CLAIMED' then created_at else null end,
    next_attempt_at = case when status = 'FAILED' then now() else created_at end;

alter table public.task_reminder_deliveries
  add column attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  add column next_attempt_at timestamptz not null default now(),
  add column claimed_at timestamptz;

update public.task_reminder_deliveries
set attempt_count = case when status = 'CLAIMED' then 1 else 0 end,
    claimed_at = case when status = 'CLAIMED' then created_at else null end,
    next_attempt_at = case when status = 'FAILED' then now() else created_at end;

create function public.claim_report_delivery(
  p_report_type text,
  p_interval_key text,
  p_recipient_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.report_deliveries;
begin
  insert into public.report_deliveries (
    report_type, interval_key, recipient_user_id, status, attempt_count, claimed_at
  ) values (
    p_report_type, p_interval_key, p_recipient_user_id, 'CLAIMED', 1, statement_timestamp()
  )
  on conflict (report_type, interval_key, recipient_user_id) do nothing
  returning * into v_row;

  if v_row.id is not null then return true; end if;

  update public.report_deliveries
  set status = 'CLAIMED',
      attempt_count = attempt_count + 1,
      claimed_at = statement_timestamp(),
      failure_reason = null
  where report_type = p_report_type
    and interval_key = p_interval_key
    and recipient_user_id = p_recipient_user_id
    and attempt_count < 5
    and (
      (status = 'FAILED' and next_attempt_at <= statement_timestamp())
      or (status = 'CLAIMED' and claimed_at < statement_timestamp() - interval '15 minutes')
    )
  returning * into v_row;

  return v_row.id is not null;
end;
$$;

create function public.complete_report_delivery(
  p_report_type text,
  p_interval_key text,
  p_recipient_user_id uuid,
  p_status text,
  p_failure_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.report_deliveries
  set status = p_status,
      failure_reason = p_failure_reason,
      completed_at = statement_timestamp(),
      next_attempt_at = case
        when p_status = 'FAILED' then statement_timestamp() + make_interval(mins => least(60, power(2, attempt_count)::integer))
        else statement_timestamp()
      end
  where report_type = p_report_type
    and interval_key = p_interval_key
    and recipient_user_id = p_recipient_user_id;
end;
$$;

create function public.claim_task_reminder_delivery(
  p_task_id uuid,
  p_deadline timestamptz,
  p_reminder_type text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.task_reminder_deliveries;
begin
  insert into public.task_reminder_deliveries (
    task_id, deadline, reminder_type, status, attempt_count, claimed_at
  ) values (
    p_task_id, p_deadline, p_reminder_type, 'CLAIMED', 1, statement_timestamp()
  )
  on conflict (task_id, deadline, reminder_type) do nothing
  returning * into v_row;

  if v_row.id is not null then
    return jsonb_build_object('claimed', true, 'deliveries', '[]'::jsonb);
  end if;

  select * into v_row
  from public.task_reminder_deliveries
  where task_id = p_task_id and deadline = p_deadline and reminder_type = p_reminder_type
  for update;

  if v_row.status = 'SENT'
     or v_row.attempt_count >= 5
     or (v_row.status = 'FAILED' and v_row.next_attempt_at > statement_timestamp())
     or (v_row.status = 'CLAIMED' and v_row.claimed_at >= statement_timestamp() - interval '15 minutes') then
    return jsonb_build_object(
      'claimed', false,
      'deliveries', coalesce(v_row.metadata -> 'deliveries', '[]'::jsonb)
    );
  end if;

  update public.task_reminder_deliveries
  set status = 'CLAIMED',
      attempt_count = attempt_count + 1,
      claimed_at = statement_timestamp(),
      failure_reason = null
  where id = v_row.id;

  return jsonb_build_object(
    'claimed', true,
    'deliveries', coalesce(v_row.metadata -> 'deliveries', '[]'::jsonb)
  );
end;
$$;

create function public.complete_task_reminder_delivery(
  p_task_id uuid,
  p_deadline timestamptz,
  p_reminder_type text,
  p_status text,
  p_failure_reason text,
  p_metadata jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.task_reminder_deliveries
  set status = p_status,
      failure_reason = p_failure_reason,
      metadata = coalesce(p_metadata, '{}'::jsonb),
      completed_at = statement_timestamp(),
      next_attempt_at = case
        when p_status = 'FAILED' then statement_timestamp() + make_interval(mins => least(60, power(2, attempt_count)::integer))
        else statement_timestamp()
      end
  where task_id = p_task_id and deadline = p_deadline and reminder_type = p_reminder_type;
end;
$$;

alter table public.notification_outbox enable row level security;
alter table public.user_notification_preferences enable row level security;
revoke all on table public.notification_outbox from public, anon, authenticated;
revoke all on table public.user_notification_preferences from public, anon, authenticated;
grant select, insert, update on table public.notification_outbox to service_role;
grant select, insert, update on table public.user_notification_preferences to service_role;

revoke all on function public.enqueue_notification_outbox(text, text, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.claim_notification_outbox(uuid) from public, anon, authenticated;
revoke all on function public.claim_due_notification_outbox(integer) from public, anon, authenticated;
revoke all on function public.complete_notification_outbox(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.claim_report_delivery(text, text, uuid) from public, anon, authenticated;
revoke all on function public.complete_report_delivery(text, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_task_reminder_delivery(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.complete_task_reminder_delivery(uuid, timestamptz, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.update_user_notification_preferences(uuid, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;

grant execute on function public.enqueue_notification_outbox(text, text, uuid, uuid, jsonb) to service_role;
grant execute on function public.claim_notification_outbox(uuid) to service_role;
grant execute on function public.claim_due_notification_outbox(integer) to service_role;
grant execute on function public.complete_notification_outbox(uuid, boolean, text) to service_role;
grant execute on function public.claim_report_delivery(text, text, uuid) to service_role;
grant execute on function public.complete_report_delivery(text, text, uuid, text, text) to service_role;
grant execute on function public.claim_task_reminder_delivery(uuid, timestamptz, text) to service_role;
grant execute on function public.complete_task_reminder_delivery(uuid, timestamptz, text, text, text, jsonb) to service_role;
grant execute on function public.update_user_notification_preferences(uuid, boolean, boolean, boolean, boolean, boolean) to service_role;

comment on table public.notification_outbox is
  'Durable per-recipient Telegram delivery queue. SENT rows are immutable by application convention; failed rows use bounded exponential retry.';
