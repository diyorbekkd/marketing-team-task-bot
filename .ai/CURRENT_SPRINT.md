# Current sprint

## Sprint 11B-A3 — Cron fault isolation and final Task Bot RC

- Task Bot branch: `sprint-11b/taskbot-cloudflare`
- Task Bot A3 starting SHA: `56c77eb9b7a7d7e90ba319b4c263cf417827840d`
- Worktree: `/workspaces/codespaces-blank/marketing-team-task-bot-cloudflare`
- Ownership: Task Bot only; Content OS and the old documentation worktree are read-only.
- Prohibited: push, deploy, production database/Telegram access, or business-rule changes.

## Implemented scope

- Ran the official vinext audit: 100% compatible, 12 supported, 0 partial, 0 issues; App Router plus all 27 route handlers recognized.
- Added the vinext/Vite/Cloudflare build target and generated Wrangler runtime/binding types.
- Added a custom Worker entry that delegates fetches to vinext, fails closed outside the approved staging environment, and dispatches all existing scheduled application jobs.
- Preserved all six Vercel cron entries and mapped them to five Cloudflare UTC triggers; the two five-minute jobs share one trigger and run in deterministic order.
- Pinned Next.js 16.4.2 to clear the critical advisory reported against the frozen 16.3.4 baseline.
- Added focused staging-guard, every-trigger cron, and fetch-based Supabase initialization tests. No schema or business-rule change was made.
- Documented the exact staging URL, environment inventory, cron mapping, Cloudflare quota risk, and deploy-time prerequisites.
- Reconciled the production database runbook and directly linked manifest to the final 23-file Sprint 10E-FIX inventory: eight existing production ledger rows, 15 pending, 23 final. All 23 SHA-256 hashes match `docs/SPRINT_10E_FIX_MIGRATIONS.sha256`; no migration file changed.
- Recorded the externally provisioned Worker origin, disabled preview URLs, staging Supabase ref, and secret provisioning status without recording values.
- Enabled Content OS signed service auth only in the staging Worker configuration. The shared parser remains default-disabled and fails closed when enabled without `CONTENT_OS_SERVICE_SECRET`.
- Isolated jobs that share a Cloudflare Cron Trigger: recurring generation still runs before notification delivery, but either failure no longer prevents the other job from running. A single failure is rethrown unchanged; multiple failures are surfaced together, so Cloudflare invocation failure visibility is preserved.
- Added regression coverage for recurring success, recurring failure with continued notification delivery, observable notification failure, aggregate failure visibility, and every unchanged cron mapping.

## Gates

```text
VINEXT_COMPATIBILITY = GO
TASK_BOT_WORKER_BUILD = GO
TELEGRAM_WEBHOOK = GO
AUTH_SESSION = GO
SUPABASE_RUNTIME = GO
CRON_MIGRATION = GO
CRON_FAULT_ISOLATION = GO
TASK_BOT_CLOUDFLARE_STAGING = READY_NOT_DEPLOYED
RUNBOOK_23_MIGRATIONS = GO
TASK_BOT_STAGING_RC = GO
TASK_BOT_STAGING_RELEASE = NO-GO
PRODUCTION_RELEASE = HOLD
```

## Verification artifacts

- `docs/SPRINT_11B_TASK_BOT_CLOUDFLARE_STAGING.md`
- `wrangler.jsonc`
- `vite.config.ts`
- `worker/index.ts`
- `tests/cloudflare-scheduled.test.ts`
- `tests/cloudflare-staging.test.ts`
- `tests/supabase-worker-runtime.test.ts`

Final A3 local gate: 334/334 tests across 41 files; lint, regenerated typecheck, Next.js 16.4.2 production build, vinext 1.2.1 Worker build, Wrangler 4.151.0 dry run, high-confidence added-line secret scan, and `git diff --check` pass. The first standalone typecheck encountered the already-documented stale `.next/types` declarations; the clean Next build regenerated them and the required rerun passed.

No schedule, business logic, notification semantics, database migration, or Content OS file changed. No production or staging service was deployed or remotely reconfigured, and nothing was pushed. Vercel remains the unchanged fallback, and production release remains on hold. Actual staging deployment remains blocked until the owner supplies `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, the needed staging Telegram identity IDs, and confirms remaining runtime bindings plus Cloudflare plan/quota.
