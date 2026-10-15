# Delivery roadmap

Each sprint is intentionally bounded. Later-sprint work should not leak into an earlier sprint without an explicit scope change.

## Sprint 0 — Foundation

- Establish repository standards, documentation, and quality commands.
- Bootstrap a strict TypeScript Next.js App Router project.
- Add validated server configuration and server-only Supabase access.
- Create the versioned foundational database schema, indexes, RLS lock-down, and immutable task event safeguards.
- Define transport-independent domain types, input validation, and permission guards.
- Add a Telegram webhook, safe update parsing, `/start` placeholder, and health endpoint.
- Add a mobile-first Mini App placeholder shell.
- Add meaningful unit tests for permissions, validation, and configuration.

## Sprint 1 — Users and Telegram onboarding

- Register and activate the five team members through private bot onboarding.
- Resolve Telegram group/private identities to internal users.
- Add Head-controlled role/user administration and membership validation.
- Set and verify the Telegram webhook operationally.

## Sprint 2 — Task creation

- Parse validated group shorthand (`T`, `A`, `DL`, `P`, `D`).
- Resolve assignees safely and handle ambiguity.
- Implement transactional task creation plus `TASK_CREATED` event.
- Deliver initial assignment private messages.
- Add the private `/task` wizard without changing core creation rules.

## Sprint 3 — Task lifecycle

- Implement acceptance, allowed status transitions, blocking/unblocking, review, revision, completion, cancellation, and authorized reopening.
- Store blocked reasons and revision records.
- Enforce all workflow permissions in application services.

## Sprint 4 — Requests and approvals

- Implement deadline-change and reassign requests.
- Add creator/Head approval and rejection flows with first-resolution-wins concurrency protection.
- Apply approved changes and audit events transactionally.

## Sprint 5 — Notifications and scheduled reports

- Add idempotent deadline reminders and important event notifications.
- Add 08:00/19:00 daily summaries and Sunday 10:00 weekly reports in `Asia/Tashkent`.
- Separate Head team reports from employee personal reports.

## Sprint 6 — Mini App foundation

- Verify Telegram Mini App init data server-side and establish a secure session strategy.
- Add the application navigation shell, task list/detail, and Quick Add.
- Connect UI mutations to the same application services as Telegram.

## Sprint 7 — Visual management

- Add Kanban, team workload counts, overdue/blocked/review views, calendar, filters, and search.
- Add Head-specific team visibility and employee-scoped views.

## Sprint 8 — Productivity features

- Add subtasks without expanding Quick Add.
- Add simple task/checklist templates such as `#posting`.
- Add lightweight Telegram relay using copy/forward without permanent content storage.

## Sprint 9 — Analytics

- Implement deterministic reports for throughput, carry-over, on-time/overdue performance, status and blocked duration, cycle time, extensions, revisions, employee completion, workload, and bottlenecks.
- Validate calculations against immutable events and current-state projections.

## Sprint 10 — Production hardening

- Complete security and RLS review, rate limits, webhook operational controls, monitoring, backups, restore drills, and failure handling.
- Add end-to-end tests, accessibility checks, deployment runbooks, and production readiness documentation.

## Sprint 9E — Shared database release blockers

- Task Bot is the sole owner and production push location for the shared Supabase migration history.
- Import Content OS migrations 00–06 byte-for-byte into Task Bot's chronological manifest and guard the exact 19-version order and hashes.
- Replace manually raised business-rule `40001` errors in effective functions with non-retryable `PT409`, without catching or remapping real PostgreSQL serialization failures.
- Rehearse the normal eight-live-row to 19-row flow on PostgreSQL 17 with the pinned Supabase CLI; `--include-all`, history repair, and manual ledger changes are not valid release steps.
- Before traffic, a failed transactional migration may be corrected and retried. After traffic, use fix-forward or PITR for catastrophic recovery; repository down files and migration-history manipulation are not production rollback tools.

## Sprint 9F — Release candidate freeze

- Freeze Task Bot application/database source at `3a3becab5cd21cf2a6a2947e3e4de861ea6b0f4c` and Content OS source at `ceb5f52184f1886948ebb8a7f6b4196b6de6f42a`.
- Record SHA-256 for every canonical migration and reverify Content OS 00–06 byte identity.
- Provide an exact production runbook and explicit, initially unchecked human approvals for precheck, database, application, smoke, and recovery stages.
- Preserve `DB_RELEASE = GO`, `APPLICATION_RELEASE = BLOCKED_ON_PLATFORM_AUTH`, and `PRODUCTION_RELEASE = HOLD`; keep `CONTENT_OS_IDENTITY_TRUST` unset until the external platform guarantee is documented and separately approved.
- Make no application/database behavior change and perform no push, deploy, or live migration.

## Sprint 10A — Telegram auth and Cloudflare integration

- Replace the blocked production Sites identity model with approval through the existing Telegram Task Bot and a standalone Cloudflare Worker target for Content OS.
- Keep `public.users` as the only user, active-state, and role authority; unknown, pending, and inactive users cannot approve login.
- Store only SHA-256 verifier/session proofs in private RLS-enabled tables; use random one-time challenges, 30-day opaque server sessions, current-role validation, immediate deactivation revocation, and independent multi-device sessions.
- Keep Task Bot as canonical migration owner. The Sprint 10A manifest has 20 migrations and rehearses the normal eight-row-to-20-row path without `--include-all`, history repair, or manual ledger changes.
- Work across Task Bot and Content OS strictly sequentially, leaving each repository committed and clean before touching the other. Do not push, deploy, use production credentials, or apply live migrations. Production release remains `HOLD`.

## Sprint 10B — Team permissions and task management

- Let every active marketing user read every non-archived marketing task and all Content OS content through trusted server boundaries.
- Keep mutations relationship-scoped: creator/Head direct management, ordinary assignee lifecycle plus deadline/reassign requests, unrelated teammate read-only.
- Resolve the same deadline/reassign request rows from Telegram and Content OS through row-locked, Head-only, first-resolution-wins RPCs.
- Implement Head-only soft archive/restore outside the task workflow state machine; preserve task identity, status, events, revisions, and Content OS links; prohibit hard delete.
- Extend the existing Telegram notification dispatcher with semantic per-event delivery claims so retries do not duplicate meaningful notifications.
- Keep Task Bot as canonical migration owner. The Sprint 10B manifest has 21 migrations and rehearses the normal eight-row-to-21-row path without `--include-all`, repair, or manual ledger changes.
- Work strictly sequentially: commit/clean Task Bot, then commit/clean Content OS, then run the seven-flow disposable cross-repository rehearsal. Do not push, deploy, use production credentials, or apply live migrations. Production release remains `HOLD`.

## Sprint 10D — Task Bot workflow and auth hardening

- Restrict generic creator management to manual tasks; Content OS runtime provenance makes its workflow-specific permissions authoritative, including reviewer/Head-only `HEAD_REVIEW` control.
- Close generic Blog completion and provide one atomic, idempotent `BLOG` completion/resubmission RPC that guarantees exactly one provenance-linked Head Review.
- Add a six-digit cross-channel login confirmation code, server-derived rate-key contract, five-per-15-minute and three-outstanding bounds, and bounded challenge cleanup/retention.
- Upgrade meaningful workflow notifications to a durable task-event outbox with leases, retry/backoff, `SENT`, and attempt-five dead-letter state through the existing Telegram dispatcher.
- Cancel/audit pending task-change requests during archive, serialize request/archive races, and prevent archiving either side of an active Blog/Head Review cycle.
- Keep Task Bot as canonical migration owner. The Sprint 10D manifest has 22 migrations and rehearses the normal eight-row-to-22-row path without `--include-all`, repair, or manual ledger changes.
- Modify only Task Bot. Do not push, deploy, use production credentials, or apply live migrations. Production release remains `HOLD`.

## Sprint 10E-FIX — Task Bot final blocker closure

- Keep legacy assignment notifications inline but make `SENT` constraint-valid by writing `sent_at`; exclude every null-event legacy row from event-outbox leasing and terminalize only pre-existing ambiguous legacy rows during migration.
- Enforce immutable Blog/reviewer independence for all Head Review creation and reassignment paths, including Head-authored Blogs and concurrent assignment changes.
- Allow approval only by the active assigned reviewer. Allow active Head to request revision only when Head is not the source Blog author; Head must first be legitimately assigned to approve.
- Preserve the exact atomic Blog completion/resubmission RPC consumed by Content OS and its same-Head-Review retry/response-loss behavior.
- Keep Task Bot as canonical migration owner. The Sprint 10E-FIX manifest has 23 migrations and rehearses the normal eight-row-to-23-row path without `--include-all`, repair, or manual ledger changes.
- Modify only Task Bot. Do not push, deploy, use production credentials, or apply live migrations. Production release remains `HOLD`.

## Fast-track next product phase — authorized 2026-09-09

The user explicitly reordered and activated this scope after the production MVP: daily summaries, weekly summary, `#posting` checklist, recurring tasks, then workload/bottleneck analytics. It is delivered as one compatible increment on `fast-track/mvp`; Telegram's positional task format remains unchanged.

- Daily/weekly: protected Vercel Cron, per-recipient delivery idempotency, employee isolation, Head team rollups.
- Posting: deterministic creation-time tag detection, persistent four-item checklist, audited toggles, transactional REVIEW gate, Telegram inline controls, Mini App card.
- Recurring: Mini App schedule controls, immutable generated occurrences, atomic deduplication, pause/resume/edit/stop.
- Analytics: 30-day factual counts and event-derived durations, personal/team authorization, compact mobile Reports tab, no workload/KPI score.

## Deadline reminders and team-member management — authorized 2026-09-09

Second same-day increment on `fast-track/mvp`, again without touching the Telegram positional task format.

- Reminders: five deterministic thresholds (24h/3h/at-deadline/1h-overdue/24h-overdue) per active task, `(task_id, deadline, reminder_type)` idempotency ledger, assignee-only before/at-deadline and assignee+creator+Head overdue escalation, protected Vercel Cron every 10 minutes, a bounded catch-up window so a scheduler gap or first deploy doesn't burst-notify on old deadlines.
- Team membership: explicit deactivated-vs-pending distinction (`deactivated_at`), Head-only deactivate/reactivate with self/Head protection, mandatory open-task disposition (reassign/cancel/keep) before removal, automatic pause of the removed member's active recurring definitions, atomic `*_with_event` state-change functions with a new `user_events` audit trail, and every task-creation/recurrence path already rejecting inactive assignees was audited and closed where it wasn't (recurring configuration and generation).
