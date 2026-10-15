# Current sprint

## Sprint 10A — Telegram auth and Cloudflare integration

- Branch: `codex/sprint-9b-hardening`
- Task Bot starting SHA: `cfa5d76a42949671fd0ecd410d5d3e385e101dfa`
- Content OS required starting SHA: `ceb5f52184f1886948ebb8a7f6b4196b6de6f42a`
- Mode: strictly sequential cross-repository implementation; Task Bot must be committed and clean before Content OS is touched.
- Prohibited: push, deploy, live migration, production credentials, live-data mutation, or production reliance on Sites/OpenAI identity headers.

## Phase A — Task Bot auth backend

- Added canonical migration `20261015121850_content_os_telegram_web_auth.sql` after the frozen 19-file manifest.
- Added private RLS-enabled challenge/session tables, seven narrow service-role RPCs, current-user validation, one-session revocation, and immediate all-session revocation on user deactivation.
- Added existing-bot `/start contentos_<uuid>` confirmation and approve/cancel callback handling without changing normal onboarding or task notifications.
- Added PostgreSQL lifecycle/catalog/security and true-concurrency harnesses plus unit/contract regressions.
- PostgreSQL 17 normal migration rehearsal: exact eight-row baseline → exactly 12 pending → 20 rows → empty dry-run. No `--include-all`, repair, or manual ledger edit.
- Phase A quality gate: 287/287 tests, lint, typecheck, production build, manifest guard, checksum verification, PostgreSQL auth lifecycle/concurrency, and `git diff --check` pass.

## Gates while work continues

```text
AUTH_BACKEND = GO
CLOUDFLARE_APP = PENDING_PHASE_B
CROSS_REPO_AUTH = PENDING_PHASE_C
PRODUCTION_RELEASE = HOLD
```

## Phase B entry condition

Do not touch Content OS until Phase A is locally committed and the Task Bot worktree is clean. Then verify Content OS is still clean at the exact required branch/SHA before any edit; stop if it advanced externally.

## Phase A artifacts

- `docs/CONTENT_OS_TELEGRAM_AUTH.md`
- `docs/SPRINT_10A_MIGRATIONS.sha256`
- `scripts/test-content-os-auth.sql`
- `scripts/test-content-os-auth-concurrency.mjs`

The production database still has the prior eight-row ledger. Nothing in Sprint 10A has been pushed, deployed, or applied live.
