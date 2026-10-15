# Current sprint

## Sprint 10B — Team permissions and task management

- Task Bot branch: `codex/sprint-9b-hardening`
- Task Bot starting SHA: `a6af0547c4fd05bc2376380fd4db908e959c8564`
- Content OS required starting SHA: `47ba7fb1443b862cecdf7246c3bdc7062d28bf18`
- Mode: strictly sequential cross-repository implementation; Task Bot must be committed and clean before Content OS is touched.
- Prohibited: push, deploy, live migration, production credentials, or production-data mutation.

## Phase A — Task Bot authoritative backend

- Added canonical migration 21: `20261015132700_sprint_10b_team_permissions_task_management.sql`.
- Added active-team read visibility, creator/Head direct content/assignee/deadline paths, ordinary-assignee deadline/reassign requests, and Head-only shared resolution.
- Added Head-only soft archive/restore through `task_archives`; task workflow status, ID, history, revisions, and Content OS links remain unchanged. Hard task delete and archived-task operational updates are rejected.
- Added semantic notification claims in `task_notification_deliveries` and retained the existing Telegram dispatcher.
- Added Telegram reassign-request creation and Head approve/reject callbacks using the same service/RPC paths as Content OS.
- Added Task Bot HTTP contracts for all/list/archive/request/direct-change operations.
- Wired the signed Content OS service boundary to the current Telegram web-session actor (`CONTENT_OS_TELEGRAM_SESSION` + `public.users.id`) so Content OS reaches these same HTTP/service/notification paths without trusting browser identity or the retired SIWC mapping.
- PostgreSQL 17 from-scratch 21-migration apply, permission/archive/catalog suite, and true concurrent deadline/reassign resolution suite pass.

## Gates after Phase A verification

```text
PERMISSION_BACKEND = GO
TASK_MANAGEMENT_UI = PENDING_PHASE_B
DUAL_APPROVAL = PENDING_PHASE_C
ARCHIVE_RESTORE = PENDING_PHASE_C
NOTIFICATIONS = PENDING_PHASE_C
CROSS_REPO_10B = PENDING_PHASE_C
PRODUCTION_RELEASE = HOLD
```

## Phase B entry condition

Phase A is fully verified. Do not touch Content OS until this state is locally committed and the Task Bot worktree is clean. Then verify Content OS remains clean at the exact required branch/SHA before any edit; stop if it advanced externally.

## Phase A artifacts

- `docs/SPRINT_10B_TASK_MANAGEMENT.md`
- `docs/SPRINT_10B_MIGRATIONS.sha256`
- `scripts/test-team-permissions.sql`
- `scripts/test-team-permissions-concurrency.sql`
- `scripts/test-team-permissions.mjs`

Final Phase A gate: 305/305 tests pass across 36 files; lint, typecheck, production build, manifest/hash guard, and `git diff --check` pass. PostgreSQL 17 passes a clean 21-migration apply, permission/archive/catalog checks, and true concurrent deadline/reassign resolution. A normal pinned Supabase CLI rehearsal established the exact 20-row baseline, reported only migration 21 pending, applied it without `--include-all`, repair, or ledger editing, and finished at 21 rows with an empty dry-run. Sprint 10A auth lifecycle/concurrency regression passes on that final schema.

The production database still has the prior eight-row ledger. Nothing in Sprint 10B has been pushed, deployed, applied live, or run with production credentials/data.
