# Current sprint

## Sprint 10D — Task Bot workflow and auth hardening

- Task Bot branch: `codex/sprint-9b-hardening`
- Task Bot starting SHA: `ef249a963e508ba3e5a659a8c2b89686d88c9977`
- Content OS verified read-only SHA: `dd7777dc55828609ee00f909fc590f73b604dfcd`
- Content OS final observed SHA: `65195de41f9d0ca2859b180398bb5179324242ba` (clean external advance during this sprint; Codex made no Content OS change)
- Ownership: Task Bot only. Content OS must not be modified.
- Prohibited: push, deploy, live migration, production credentials, or production-data mutation.

## Implemented scope

- Added canonical migration 22: `20261015151900_sprint_10d_workflow_auth_notification_hardening.sql`.
- Restricted generic creator rights to manual tasks with no `content_task_runtime`; Content OS permissions now use stable workflow provenance.
- Closed HIGH-1: a Blog author cannot edit, reassign, change the deadline, move, cancel, or self-approve their Head Review. Only the active assigned reviewer or active Head has review authority.
- Closed generic Blog `DONE`; `content_os_complete_blog_with_head_review` atomically creates/reuses exactly one provenance-linked Head Review and safely handles retries and revision resubmission.
- Added a six-digit login confirmation code, server-derived rate-key input, five-per-15-minute and three-outstanding limits, plus 24-hour/seven-day challenge cleanup retention.
- Upgraded meaningful workflow notifications to a durable task-event outbox with leases, bounded retry/backoff, `SENT`, and attempt-five `FAILED`, using the existing Telegram dispatcher.
- Archive now cancels/audits pending deadline/reassign requests transactionally and guards both sides of an active Blog/Head Review pair.

## Gates

```text
WORKFLOW_SECURITY = GO
AUTH_HARDENING = GO
NOTIFICATION_DELIVERY = GO
ARCHIVE_WORKFLOW = GO
PRODUCTION_RELEASE = HOLD
```

## Verification artifacts

- `docs/SPRINT_10D_WORKFLOW_AUTH_HARDENING.md`
- `docs/SPRINT_10D_MIGRATIONS.sha256`
- `scripts/test-sprint10d-hardening.sql`
- `scripts/test-sprint10d-concurrency.sql`
- `scripts/test-content-os-auth.sql`
- `scripts/test-content-os-auth-concurrency.mjs`
- `scripts/test-team-permissions.sql`
- `scripts/test-team-permissions-concurrency.sql`

Final local gate: 316/316 tests across 37 files; lint, typecheck, production build, manifest/hash guard, and `git diff --check` pass. PostgreSQL 17 passes the clean 22-migration apply, Sprint 10D adversarial/concurrency suites, Sprint 10A auth lifecycle/concurrency regression, Sprint 10B permissions/concurrency regression, and the legacy notification-ledger upgrade fixture. The pinned Supabase CLI 2.116.0 rehearsal established the exact eight-row baseline, reported 14 pending, applied normally to 22, and ended with an empty dry-run. Security/performance advisors report no issues.

The production database remains at its prior eight-row ledger. Nothing in Sprint 10D has been pushed, deployed, applied live, or run with production credentials/data.
