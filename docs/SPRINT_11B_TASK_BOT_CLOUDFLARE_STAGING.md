# Sprint 11B-A — Task Bot Cloudflare staging

## Scope and safety boundary

This migration adds a Cloudflare Workers staging target through vinext. Vercel remains the fallback target. It does not deploy, configure Telegram, contact either Supabase project, change database schema, or change Task Bot business rules. Content OS is outside this change.

The externally provisioned Worker is named `ibox-task-bot-staging`, uses `workers.dev`, has preview URLs disabled (`preview_urls=false`), and defines no production route or custom domain. Its staging origin is:

```text
https://ibox-task-bot-staging.lively-river-afba.workers.dev
```

The staging Supabase project ref is `yuznbaaoonyqonhiywkt`. These are staging facts only; they do not authorize a production route, production database, or production Telegram identity.

The fetch and scheduled handlers fail closed unless all of these are true:

- `DEPLOYMENT_ENVIRONMENT=staging`
- `SUPABASE_PROJECT_REF=yuznbaaoonyqonhiywkt`
- `SUPABASE_URL=https://yuznbaaoonyqonhiywkt.supabase.co`
- `APP_URL` is the staging `workers.dev` URL above (or localhost for local preview)

The production Supabase project `cbjcclefgxrdyjwkjcpq` is therefore rejected before the application handler runs.

## Compatibility audit

The official `vinext check` result against Next.js 16.4.2 is 100%: 12 supported, 0 partial, 0 issues. It recognizes the App Router, one page, one layout, and 27 route handlers. The audited Next.js imports are `next/server`, `next/font/google`, `next/script`, `next/headers`, and `server-only`; all are reported supported.

Runtime code uses `node:crypto`, `Buffer`, Web Crypto, `fetch`, and `process.env`. The Worker pins `nodejs_compat` and compatibility date `2026-10-16`. No runtime filesystem, child-process, native addon, or direct Postgres socket dependency exists. Supabase uses `@supabase/supabase-js` over fetch with session persistence and token refresh disabled.

The existing Telegram endpoint remains `POST /api/telegram/webhook`. It still requires `x-telegram-bot-api-secret-token`, validates a bounded JSON update, awaits callback/message work, and returns a retryable 502 if Telegram delivery fails. No live webhook is changed by this migration.

The frozen baseline used Next.js 16.3.4. A current production-dependency audit classified that version as critical, so this branch pins Next.js and its matching ESLint config to 16.4.2 before staging. The critical advisory is cleared without an automatic audit fix. The audit still reports upstream `vinext` dependency paths through `braces` (high) and `fflate` (moderate); npm offers only a breaking downgrade to vinext 0.2.1. This application does not accept build-time glob patterns from users and does not define an `ImageResponse` route, but the remaining upstream advisories must be tracked before production promotion.

## Cron mapping

All schedules are UTC. Asia/Tashkent is UTC+5 and has no daylight-saving adjustment.

| Cloudflare cron | Tashkent time | Jobs |
| --- | --- | --- |
| `0 3 * * *` | daily 08:00 | `daily-morning` |
| `0 14 * * *` | daily 19:00 | `daily-evening` |
| `0 5 * * 0` | Sunday 10:00 | `weekly` |
| `*/5 * * * *` | every 5 minutes | `recurring`, then `notifications` |
| `*/10 * * * *` | every 10 minutes | `reminders` |

The existing six Vercel cron entries remain unchanged. Cloudflare combines the two identical five-minute schedules into one trigger and invokes both existing application jobs in deterministic order. No HTTP self-call or cron secret is used by the Cloudflare scheduled handler.

## Environment inventory

No secret value is stored in this repository or reproduced in this handoff. Provisioning status below records owner-supplied external facts only; this release-finalization task does not read, write, or rotate any remote secret.

| Name | Phase/classification | Cloudflare staging requirement |
| --- | --- | --- |
| `DEPLOYMENT_ENVIRONMENT` | runtime non-secret guard | committed as exact `staging` |
| `SUPABASE_PROJECT_REF` | runtime non-secret guard | committed as exact staging ref |
| `SUPABASE_URL` | runtime non-secret | committed as exact staging URL |
| `APP_URL` | runtime non-secret | must equal `https://ibox-task-bot-staging.lively-river-afba.workers.dev` |
| `APP_TIMEZONE` | runtime non-secret | committed as `Asia/Tashkent` |
| `SUPABASE_PUBLISHABLE_KEY` | runtime publishable key | required; staging project only |
| `SUPABASE_SECRET_KEY` | runtime secret | owner-supplied later; staging project only |
| `TELEGRAM_BOT_TOKEN` | runtime secret | owner-supplied later; staging bot identity only |
| `TELEGRAM_WEBHOOK_SECRET` | runtime secret | already provisioned in Cloudflare; value not recorded |
| `TELEGRAM_GROUP_ID` | runtime restricted config | owner-supplied later as needed; staging/test chat only |
| `HEAD_TELEGRAM_USER_ID` | runtime restricted config | owner-supplied later as needed; staging test identity only |
| `CRON_SECRET` | runtime secret | already provisioned in Cloudflare; retained only for Vercel-style HTTP cron fallback routes |
| `CONTENT_OS_SERVICE_AUTH_ENABLED` | runtime non-secret feature flag | committed as `true` only in this staging Worker config |
| `CONTENT_OS_SERVICE_SECRET` | runtime secret | already provisioned in Cloudflare; value not recorded |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-time restricted config | needed for non-interactive deployment, not a Worker binding |
| `CLOUDFLARE_API_TOKEN` | deploy-time secret | needed for non-interactive deployment, not a Worker binding |

Legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` remain accepted by existing application configuration but are not recommended for the new staging target.

The remaining owner-supplied release inputs are `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, and the Telegram staging identity IDs needed for the selected test chat and Head actor. Production values must not be reused.

Signed Content OS service auth is intentionally enabled only by the staging-specific `wrangler.jsonc`. The shared configuration parser still defaults the feature to disabled everywhere else and fails closed if the flag is true without `CONTENT_OS_SERVICE_SECRET`; ordinary cookie/session authentication and all business authorization checks remain unchanged.

No application variable is required while compiling the Worker. All application values above are runtime bindings; the two Cloudflare credentials are deploy-tool inputs only.

## Operational constraints

Five unique Cron Triggers consume the entire account-wide Cron Trigger allowance on a Cloudflare Workers Free plan. The Free plan's 10 ms CPU limit may also be insufficient for SSR or scheduled processing. Account plan/quota must be confirmed before an authorized staging deployment.

Remaining deploy-time prerequisites are the owner-supplied staging-only Supabase secret key, dedicated staging Telegram bot token and identity IDs, confirmation that all other required non-secret bindings are present, and explicit authorization to register the staging webhook. None is needed for the local build gate, and no remote service is accessed or changed by this handoff update.
