-- Marketing Team Task Bot foundational schema.
-- The application uses a trusted server client; browser-facing Data API roles
-- intentionally receive no access to these tables during Sprint 0.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique check (telegram_user_id > 0),
  telegram_username text,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  role text not null check (
    role in (
      'OPERATOR_VIDEO_EDITOR',
      'CONTENT_MARKETER',
      'DIGITAL_MARKETER',
      'SMM_MANAGER',
      'HEAD_OF_MARKETING'
    )
  ),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    telegram_username is null
    or char_length(btrim(telegram_username)) between 1 and 32
  )
);

create unique index users_one_active_head_idx
  on public.users ((role))
  where role = 'HEAD_OF_MARKETING' and is_active;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text check (description is null or char_length(description) <= 5000),
  priority text not null default 'normal' check (priority in ('high', 'normal', 'low')),
  status text not null default 'ASSIGNED' check (
    status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'REVISION', 'DONE', 'CANCELLED')
  ),
  creator_id uuid not null references public.users (id) on delete restrict,
  assignee_id uuid not null references public.users (id) on delete restrict,
  deadline timestamptz not null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'DONE') = (completed_at is not null)),
  check ((status = 'CANCELLED') = (cancelled_at is not null))
);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  actor_id uuid references public.users (id) on delete restrict,
  actor_kind text not null default 'USER' check (actor_kind in ('USER', 'SYSTEM')),
  event_type text not null check (
    event_type in (
      'TASK_CREATED',
      'TASK_ACCEPTED',
      'STATUS_CHANGED',
      'TITLE_CHANGED',
      'DESCRIPTION_CHANGED',
      'PRIORITY_CHANGED',
      'DEADLINE_CHANGE_REQUESTED',
      'DEADLINE_CHANGE_APPROVED',
      'DEADLINE_CHANGE_REJECTED',
      'DEADLINE_CHANGED',
      'REASSIGN_REQUESTED',
      'REASSIGN_APPROVED',
      'REASSIGN_REJECTED',
      'ASSIGNEE_CHANGED',
      'TASK_BLOCKED',
      'TASK_UNBLOCKED',
      'REVIEW_REQUESTED',
      'REVISION_REQUESTED',
      'TASK_COMPLETED',
      'TASK_CANCELLED',
      'TASK_REOPENED'
    )
  ),
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (
    (actor_kind = 'USER' and actor_id is not null)
    or (actor_kind = 'SYSTEM' and actor_id is null)
  )
);

create table public.deadline_change_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  requested_by uuid not null references public.users (id) on delete restrict,
  current_deadline timestamptz not null,
  requested_deadline timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  resolved_by uuid references public.users (id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_deadline <> requested_deadline),
  check (
    (status = 'PENDING' and resolved_by is null and resolved_at is null)
    or (status <> 'PENDING' and resolved_by is not null and resolved_at is not null)
  )
);

create table public.reassign_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  requested_by uuid not null references public.users (id) on delete restrict,
  current_assignee_id uuid not null references public.users (id) on delete restrict,
  requested_assignee_id uuid not null references public.users (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  resolved_by uuid references public.users (id) on delete restrict,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_assignee_id <> requested_assignee_id),
  check (
    (status = 'PENDING' and resolved_by is null and resolved_at is null)
    or (status <> 'PENDING' and resolved_by is not null and resolved_at is not null)
  )
);

create table public.task_revisions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete restrict,
  requested_by uuid not null references public.users (id) on delete restrict,
  reason text check (reason is null or char_length(reason) <= 5000),
  created_at timestamptz not null default now()
);

create index tasks_assignee_open_deadline_idx
  on public.tasks (assignee_id, deadline)
  where status not in ('DONE', 'CANCELLED');

create index tasks_creator_created_at_idx
  on public.tasks (creator_id, created_at desc);

create index tasks_status_deadline_idx
  on public.tasks (status, deadline)
  where status not in ('DONE', 'CANCELLED');

create index task_events_task_created_at_idx
  on public.task_events (task_id, created_at, id);

create index task_events_type_created_at_idx
  on public.task_events (event_type, created_at desc);

create unique index deadline_change_requests_one_pending_per_task_idx
  on public.deadline_change_requests (task_id)
  where status = 'PENDING';

create index deadline_change_requests_status_created_at_idx
  on public.deadline_change_requests (status, created_at);

create unique index reassign_requests_one_pending_per_task_idx
  on public.reassign_requests (task_id)
  where status = 'PENDING';

create index reassign_requests_status_created_at_idx
  on public.reassign_requests (status, created_at);

create index task_revisions_task_created_at_idx
  on public.task_revisions (task_id, created_at);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

create trigger users_set_updated_at
before update on public.users
for each row execute function private.set_updated_at();

create trigger tasks_set_updated_at
before update on public.tasks
for each row execute function private.set_updated_at();

create trigger deadline_change_requests_set_updated_at
before update on public.deadline_change_requests
for each row execute function private.set_updated_at();

create trigger reassign_requests_set_updated_at
before update on public.reassign_requests
for each row execute function private.set_updated_at();

create function private.prevent_task_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'task_events are immutable; append a new event instead'
    using errcode = '55000';
end;
$$;

create trigger task_events_prevent_update_or_delete
before update or delete on public.task_events
for each row execute function private.prevent_task_event_mutation();

alter table public.users enable row level security;
alter table public.tasks enable row level security;
alter table public.task_events enable row level security;
alter table public.deadline_change_requests enable row level security;
alter table public.reassign_requests enable row level security;
alter table public.task_revisions enable row level security;

revoke all on table public.users from public, anon, authenticated;
revoke all on table public.tasks from public, anon, authenticated;
revoke all on table public.task_events from public, anon, authenticated;
revoke all on table public.deadline_change_requests from public, anon, authenticated;
revoke all on table public.reassign_requests from public, anon, authenticated;
revoke all on table public.task_revisions from public, anon, authenticated;

grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.tasks to service_role;
grant select, insert on table public.task_events to service_role;
grant select, insert, update, delete on table public.deadline_change_requests to service_role;
grant select, insert, update, delete on table public.reassign_requests to service_role;
grant select, insert, update, delete on table public.task_revisions to service_role;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

comment on table public.task_events is
  'Append-only audit history. UPDATE and DELETE are rejected by a trigger.';
comment on column public.tasks.deadline is
  'Stored as timestamptz; user input is interpreted in Asia/Tashkent before persistence.';
