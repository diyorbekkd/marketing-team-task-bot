# Current sprint

## Sprint 11B-A — Task Bot Cloudflare staging migration

- Task Bot branch: `sprint-11b/taskbot-cloudflare`
- Task Bot starting SHA: `3bd2ca73cd810b09fcee850271a6e29acb63dcd6`
- Worktree: `/workspaces/codespaces-blank/marketing-team-task-bot-cloudflare`
- Ownership: Task Bot only; Content OS and the old documentation worktree are read-only.
- Prohibited: push, production deploy, production database/Telegram access, or business-rule changes.

## Implemented scope

- Ran the official vinext audit: 100% compatible, 12 supported, 0 partial, 0 issues; App Router plus all 27 route handlers recognized.
- Added the vinext/Vite/Cloudflare build target and generated Wrangler runtime/binding types.
- Added a custom Worker entry that delegates fetches to vinext, fails closed outside the approved staging environment, and dispatches all existing scheduled application jobs.
- Preserved all six Vercel cron entries and mapped them to five Cloudflare UTC triggers; the two five-minute jobs share one trigger and run in deterministic order.
- Pinned Next.js 16.4.2 to clear the critical advisory reported against the frozen 16.3.4 baseline.
- Added focused staging-guard, every-trigger cron, and fetch-based Supabase initialization tests. No schema or business-rule change was made.
- Documented the exact staging URL, environment inventory, cron mapping, Cloudflare quota risk, and deploy-time prerequisites.

## Gates

```text
VINEXT_COMPATIBILITY = GO
TASK_BOT_WORKER_BUILD = GO
TELEGRAM_WEBHOOK = GO
AUTH_SESSION = GO
SUPABASE_RUNTIME = GO
CRON_MIGRATION = GO
TASK_BOT_CLOUDFLARE_STAGING = READY_NOT_DEPLOYED
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

Final local gate: 331/331 tests across 41 files; lint, typecheck, Next production build, vinext Worker build, Wrangler dry run, Worker health/webhook/session preview smokes, generated type check, and `git diff --check` pass.

No database migration was added or applied. No production or staging service was deployed or reconfigured. Vercel remains the unchanged fallback, and production release remains on hold.
