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

## Fast-track next product phase — authorized 2026-09-09

The user explicitly reordered and activated this scope after the production MVP: daily summaries, weekly summary, `#posting` checklist, recurring tasks, then workload/bottleneck analytics. It is delivered as one compatible increment on `fast-track/mvp`; Telegram's positional task format remains unchanged.

- Daily/weekly: protected Vercel Cron, per-recipient delivery idempotency, employee isolation, Head team rollups.
- Posting: deterministic creation-time tag detection, persistent four-item checklist, audited toggles, transactional REVIEW gate, Telegram inline controls, Mini App card.
- Recurring: Mini App schedule controls, immutable generated occurrences, atomic deduplication, pause/resume/edit/stop.
- Analytics: 30-day factual counts and event-derived durations, personal/team authorization, compact mobile Reports tab, no workload/KPI score.
