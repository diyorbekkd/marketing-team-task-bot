# Architecture

## Shape of the system

Marketing Team Task Bot is one Next.js application backed by one Supabase PostgreSQL database. It is deliberately a modular monolith.

```text
Telegram updates ──> webhook adapter ──┐
                                      ├──> application/domain services ──> repositories ──> PostgreSQL
Mini App/API ──────> HTTP adapter ─────┘              │
                                                     └──> shared permission guards
```

The Telegram and Mini App transports validate and translate external data, resolve a verified actor, call the same application services, and format results. They do not own workflow or authorization rules.

Task creation specifically has exactly one shared parsing/validation/persistence path regardless of transport: the Telegram group, the private bot, the Mini App, recurring generation, and bulk (`---`-separated) creation all end at the same `MarketingRepository.createTask` call, which in turn calls the single PostgreSQL function `create_task_with_event_v2`. There is no separate grammar or business logic per transport — only per-transport parsing of raw text into the same shape (`src/telegram/task-shorthand.ts`'s `parseTaskMessage`) or a typed request body (the Mini App). A bulk message's per-block idempotency reuses the existing unique `tasks.source_telegram_update_id` column with a deterministic synthetic key (`updateId * 100 + blockIndex`), so no schema change was needed to make a duplicated Telegram webhook delivery a no-op for a whole batch, the same way it already was for one task.

## Runtime and repository boundaries

- `src/app`: Next.js UI and route handlers. Route handlers are adapters, not business services.
- `src/domain`: pure TypeScript task concepts, validators, event definitions, and permission rules. It does not import Next.js, Telegram, or Supabase.
- `src/server`: trusted application services, identity verification, database clients, and repository implementations/contracts.
- `src/telegram`: Telegram Bot API transport, update parsing, and reply formatting.
- `supabase/migrations`: ordered database schema and security changes.
- `tests`: unit tests focused on business boundaries.

Node.js is the default runtime. Edge runtime is not needed and would unnecessarily constrain cryptography and server dependencies.

## Data and transaction model

PostgreSQL is the source of truth. Current task state is stored in `tasks`; historical facts are appended to `task_events`. Requests and revision records retain workflow-specific details.

Every important state mutation must update the current projection and append its event in one PostgreSQL transaction. Repository contracts expose atomic state-plus-event operations. Later sprints will implement these as narrowly scoped PostgreSQL functions called through Supabase RPC, with concurrency predicates such as `status = 'PENDING'`. This prevents partial state changes and duplicate request approvals. General-purpose mutation RPCs or a workflow engine are intentionally avoided.

Task events are append-only. Database triggers reject update and delete attempts even from trusted application code. Corrections are represented by new events.

## Security and identity

Browser code never receives `SUPABASE_SERVICE_ROLE_KEY` or `TELEGRAM_BOT_TOKEN`. During the current server-mediated design, application tables are inaccessible to `anon` and `authenticated`; RLS is enabled with no permissive policies, and only trusted server code receives explicit table privileges through `service_role`.

Telegram webhook calls must include the configured secret token header. Incoming update JSON is runtime-validated before use.

Mini App authentication will verify Telegram `initData` server-side using Telegram's documented signature algorithm, expiration checks, and the bot secret. The backend derives `telegram_user_id` from verified data and resolves it to an active internal user. A raw browser-provided ID, username, role, or `isHead` flag is never trusted.

Application services receive an `ActorContext` created only after server verification. Shared guards determine whether that actor is Head, creator, or assignee. Every sensitive action checks those guards even if its UI control is hidden.

## Supabase access

The backend uses a server-only Supabase client with disabled session persistence. The service-role key is used only in the trusted Node.js runtime. No direct database client is created in the Mini App during Sprint 0.

Tables live in `public` for conventional Supabase tooling but are opt-in locked: explicit grants are revoked from public clients, RLS is enabled, and no browser policies are installed. If direct authenticated reads become useful later, they require narrowly scoped policies derived from verified identities and a documented security review.

## Configuration

Secrets and environment-specific identifiers come from environment variables. Separate runtime parsers validate application, Supabase, and Telegram configuration only when that capability is used. This allows builds and pure unit tests without real credentials while still failing early when a configured integration starts.

## Notifications and scheduling

Protected Vercel Cron handlers run daily summaries at 03:00/14:00 UTC, the Sunday report at 05:00 UTC, recurrence generation every five minutes, and the deadline-reminder sweep every ten minutes. Vercel sends `CRON_SECRET` in the Authorization header; handlers compare it in constant time and expose no secret values. The product needs no Redis or queue at this volume.

Report deliveries use a unique `(report_type, interval_key, recipient_user_id)` database ledger. Deadline reminders use an analogous `(task_id, deadline, reminder_type)` ledger in `task_reminder_deliveries`, so a deadline change naturally starts a fresh delivery cycle without needing to touch history for the old deadline. Only active rows created by real Telegram `/start` onboarding are eligible for either ledger. One recipient failure does not abort other recipients or other tasks. Recurring generation locks and advances each definition in the same transaction that creates its occurrence, with a second unique constraint on `(recurring_definition_id, scheduled_occurrence_at)`. The recurring sweep also treats an inactive assignee as a hard stop: it auto-pauses that definition instead of generating a task for someone no longer on the team, mirroring the auto-pause already applied at deactivation time.

User activation, role changes, deactivation, and reactivation are each a single-transaction Postgres function (`*_with_event`) that updates `public.users` and appends a `user_events` row atomically, the same pattern already used for task mutations and their `task_events` — so a membership state change can never commit without its audit record, or vice versa.

All schedule calculations use `Asia/Tashkent` (fixed UTC+05:00), while database timestamps remain `timestamptz`/UTC.

## Deployment

The expected production layout is a single Next.js deployment (for example, Vercel) plus one managed Supabase project and a Telegram HTTPS webhook pointed at the deployment. Migrations are applied in order during a controlled release. No production resources are created during Sprint 0.

The Vercel function region is pinned (`vercel.json`'s `regions`) to match the Supabase project's region rather than left on Vercel's default, since every database-touching request otherwise pays a full cross-region round trip on top of the client's own latency. Whenever the Supabase project's region changes, this pin should move with it.

The Mini App's first screen is served by one consolidated route, `/api/bootstrap` (`src/app/api/bootstrap/route.ts`), that runs the active-team-list and Home-task-summary reads in parallel server-side and returns both in one response — a thin consolidating route with no business logic of its own, calling the same `MarketingService` methods the per-resource routes (`/api/users`, `/api/tasks`) already call. Per-tab data that is not needed for the first screen (the Tasks-tab list for a specific filter, Reports) is fetched lazily by the client only once that tab is opened, not eagerly at mount.

## Extended data structures

`task_checklists` and `task_checklist_items` persist the deterministic Posting workflow. `recurring_definitions` stores future schedule/template state while generated tasks remain ordinary `tasks` rows. `report_deliveries` and `task_reminder_deliveries` are the report and reminder idempotency ledgers. `user_events` is the membership audit trail, parallel to `task_events`. `users.deactivated_at`/`deactivated_by` distinguish a deactivated former member from a still-pending one, both of which have `is_active = false`. All new public tables are RLS-enabled, browser roles are revoked, and only the trusted `service_role` receives the minimum required grants.
