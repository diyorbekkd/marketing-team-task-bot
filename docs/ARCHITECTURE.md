# Architecture

## Shared database ownership

Task Bot is the sole production migration owner for the database shared with Content OS. The complete ordered manifest lives in `supabase/migrations`; only this repository may run production `supabase db push`. Content OS migration copies in this manifest stay byte-identical to their source. See `docs/DATABASE_RELEASE.md` for the manifest guard, normal release flow, and rollback policy.

## Content OS Telegram authentication

Task Bot owns the database protocol and Telegram approval boundary for standalone Content OS. The browser generates a high-entropy verifier; the Content OS server sends its SHA-256 proof plus a server-derived, privacy-preserving Cloudflare rate-key hash to `content_os_auth_create_challenge`. The database returns a six-digit human confirmation code shown in both browser and Telegram, while the Telegram deep link still carries only the random UUID challenge id. The code is not an authentication secret. The existing bot derives the approver from the genuine Telegram update and calls the locked approval RPC after explicit confirmation.

Content OS generates an independent opaque session token when redeeming an approved challenge and sends only its SHA-256 hash to PostgreSQL. The private, RLS-enabled auth tables contain verifier and token hashes only. Redemption locks and consumes a challenge once in the same transaction that inserts one session; concurrent replay cannot produce another session.

Every protected request hashes its cookie token and calls `content_os_auth_validate_session`, which joins the current active `public.users` row and returns the current role. Roles are never persisted as session authority. A user-deactivation trigger revokes all live sessions and cancels outstanding approved challenges; later reactivation never revives them. See `docs/CONTENT_OS_TELEGRAM_AUTH.md` for the exact cross-repository RPC contract.

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

Soft archive state lives in `task_archives`, keyed by `task_id`, rather than adding an `ARCHIVED` workflow status. A task update trigger blocks operational changes until restore, and a separate trigger rejects every `tasks` delete. Archive/restore append immutable events but never replace the task row or alter its current workflow status.

## Security and identity

Browser code never receives `SUPABASE_SERVICE_ROLE_KEY` or `TELEGRAM_BOT_TOKEN`. During the current server-mediated design, application tables are inaccessible to `anon` and `authenticated`; RLS is enabled with no permissive policies, and only trusted server code receives explicit table privileges through `service_role`.

Telegram webhook calls must include the configured secret token header. Incoming update JSON is runtime-validated before use.

Mini App authentication will verify Telegram `initData` server-side using Telegram's documented signature algorithm, expiration checks, and the bot secret. The backend derives `telegram_user_id` from verified data and resolves it to an active internal user. A raw browser-provided ID, username, role, or `isHead` flag is never trusted.

Application services receive an `ActorContext` created only after server verification. Shared guards determine whether that actor is Head, creator, or assignee. Every sensitive action checks those guards even if its UI control is hidden.

Sprint 10B makes active membership an explicit input to the shared task predicates. Every active member can read non-archived team tasks; manual-task creator/Head direct changes, assignee request paths, and Head-only archive/restore are separate capabilities. Sprint 10D defines a manual task as one without `content_task_runtime`; Content OS `creator_id` never grants generic creator management. The direct/request/archive RPCs repeat actor, relationship, provenance, task-state, archive-state, and target-active checks while holding their task/request row locks, so Telegram and Content OS converge on one authoritative transaction.

## Supabase access

The backend uses a server-only Supabase client with disabled session persistence. The service-role key is used only in the trusted Node.js runtime. No direct database client is created in the Mini App during Sprint 0.

Tables live in `public` for conventional Supabase tooling but are opt-in locked: explicit grants are revoked from public clients, RLS is enabled, and no browser policies are installed. If direct authenticated reads become useful later, they require narrowly scoped policies derived from verified identities and a documented security review.

## Content OS transition integration

Content OS task classification and provenance remain Content OS-owned. Task Bot's `transition_task_with_events` RPC calls only the stable `content_os_*` predicates from the finalized Content OS transition contract; it does not infer task identity from titles, display names, or the latest Task Type version. If those predicates are absent, the RPC uses the legacy Task Bot matrix unchanged.

Non-review-required Content OS tasks may complete directly from `IN_PROGRESS` or `REVISION` only through the operational RPC, by their assignee, after `content_os_completion_allowed` and any existing Task Bot posting checklist pass. `BLOG` is the deliberate exception: generic completion is always rejected and `content_os_complete_blog_with_head_review` atomically creates/reuses exactly one provenance-linked `HEAD_REVIEW` while completing or resubmitting the Blog. Review-required tasks keep the ordinary `IN_PROGRESS → REVIEW → DONE` path.

The Blog/Head Review revision round trip is a narrow two-row transaction. A qualifying open Head Review authorizes its source Blog's `DONE → REVISION`; the same RPC moves that exact review `IN_PROGRESS → BLOCKED` and records the review ID in immutable Blog event metadata. Blog resubmission uses the dedicated completion RPC, recovers that review ID from the event, revalidates Content OS provenance, and atomically moves the Blog `REVISION → DONE` plus the same review `BLOCKED → ASSIGNED`. Only the assigned active reviewer or active Head has Head Review lifecycle/review authority. A failure on either row or audit insert rolls the complete transaction back. A response-loss retry is a status no-op after a committed transaction and therefore creates no duplicate events or revision rows.

## Configuration

Secrets and environment-specific identifiers come from environment variables. Separate runtime parsers validate application, Supabase, and Telegram configuration only when that capability is used. This allows builds and pure unit tests without real credentials while still failing early when a configured integration starts.

## Notifications and scheduling

Protected Vercel Cron handlers run daily summaries at 03:00/14:00 UTC, the Sunday report at 05:00 UTC, recurrence generation every five minutes, and the deadline-reminder sweep every ten minutes. Vercel sends `CRON_SECRET` in the Authorization header; handlers compare it in constant time and expose no secret values. The product needs no Redis or queue at this volume.

Report deliveries use a unique `(report_type, interval_key, recipient_user_id)` database ledger. Deadline reminders use an analogous `(task_id, deadline, reminder_type)` ledger in `task_reminder_deliveries`, so a deadline change naturally starts a fresh delivery cycle without needing to touch history for the old deadline. Only active rows created by real Telegram `/start` onboarding are eligible for either ledger. One recipient failure does not abort other recipients or other tasks. Recurring generation locks and advances each definition in the same transaction that creates its occurrence, with a second unique constraint on `(recurring_definition_id, scheduled_occurrence_at)`. The recurring sweep also treats an inactive assignee as a hard stop: it auto-pauses that definition instead of generating a task for someone no longer on the team, mirroring the auto-pause already applied at deactivation time.

Meaningful workflow notifications use the same dispatcher through a durable outbox in `task_notification_deliveries`. The task-event transaction inserts one unique `(task_event_id, recipient_user_id)` intent. A protected worker leases due rows with `SKIP LOCKED`, retries transient failures with bounded backoff, and records `SENT` or attempt-five `FAILED`. Request resolution commits independently of Telegram delivery. Telegram has no sender idempotency key, so lease recovery after Telegram accepted a message but before local `SENT` may produce one duplicate; no exactly-once external guarantee is claimed.

User activation, role changes, deactivation, and reactivation are each a single-transaction Postgres function (`*_with_event`) that updates `public.users` and appends a `user_events` row atomically, the same pattern already used for task mutations and their `task_events` — so a membership state change can never commit without its audit record, or vice versa.

All schedule calculations use `Asia/Tashkent` (fixed UTC+05:00), while database timestamps remain `timestamptz`/UTC.

## Deployment

The expected production layout is a single Next.js deployment (for example, Vercel) plus one managed Supabase project and a Telegram HTTPS webhook pointed at the deployment. Migrations are applied in order during a controlled release. No production resources are created during Sprint 0.

The Vercel function region is pinned (`vercel.json`'s `regions`) to match the Supabase project's region rather than left on Vercel's default, since every database-touching request otherwise pays a full cross-region round trip on top of the client's own latency. Whenever the Supabase project's region changes, this pin should move with it.

The Mini App's first screen is served by one consolidated route, `/api/bootstrap` (`src/app/api/bootstrap/route.ts`), that runs the active-team-list and Home-task-summary reads in parallel server-side and returns both in one response — a thin consolidating route with no business logic of its own, calling the same `MarketingService` methods the per-resource routes (`/api/users`, `/api/tasks`) already call. Per-tab data that is not needed for the first screen (the Tasks-tab list for a specific filter, Reports) is fetched lazily by the client only once that tab is opened, not eagerly at mount.

## Extended data structures

`task_checklists` and `task_checklist_items` persist the deterministic Posting workflow. `recurring_definitions` stores future schedule/template state while generated tasks remain ordinary `tasks` rows. `task_archives` stores only current soft-archive metadata. `report_deliveries` and `task_reminder_deliveries` are idempotency ledgers; `task_notification_deliveries` is the workflow-notification outbox and delivery ledger. `user_events` is the membership audit trail, parallel to `task_events`. `users.deactivated_at`/`deactivated_by` distinguish a deactivated former member from a still-pending one, both of which have `is_active = false`. All new public tables are RLS-enabled, browser roles are revoked, and only the trusted `service_role` receives the minimum required grants.
