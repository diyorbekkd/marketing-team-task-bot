# Sprint 11B-A — Task Bot Cloudflare staging

## Scope and safety boundary

This migration adds a Cloudflare Workers staging target through vinext. Vercel remains the fallback target. It does not deploy, configure Telegram, contact either Supabase project, change database schema, or change Task Bot business rules. Content OS is outside this change.

The Worker is named `ibox-task-bot-staging`, uses `workers.dev`, has preview URLs disabled, and defines no production route or custom domain. Its public URL must have this shape:

```text
https://ibox-task-bot-staging.<cloudflare-account-subdomain>.workers.dev
```

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

No value below has been written to Cloudflare. Before an authorized staging deploy, configure the missing values without copying production credentials.

| Name | Phase/classification | Cloudflare staging requirement |
| --- | --- | --- |
| `DEPLOYMENT_ENVIRONMENT` | runtime non-secret guard | committed as exact `staging` |
| `SUPABASE_PROJECT_REF` | runtime non-secret guard | committed as exact staging ref |
| `SUPABASE_URL` | runtime non-secret | committed as exact staging URL |
| `APP_URL` | runtime non-secret | required; exact staging Worker URL |
| `APP_TIMEZONE` | runtime non-secret | committed as `Asia/Tashkent` |
| `SUPABASE_PUBLISHABLE_KEY` | runtime publishable key | required; staging project only |
| `SUPABASE_SECRET_KEY` | runtime secret | required; staging project only |
| `TELEGRAM_BOT_TOKEN` | runtime secret | required; staging bot identity only |
| `TELEGRAM_WEBHOOK_SECRET` | runtime secret | required; staging webhook only |
| `TELEGRAM_GROUP_ID` | runtime restricted config | required; staging/test chat only |
| `HEAD_TELEGRAM_USER_ID` | runtime restricted config | required; staging test identity only |
| `CRON_SECRET` | runtime secret | required only to retain the Vercel-style HTTP cron fallback routes |
| `CONTENT_OS_SERVICE_AUTH_ENABLED` | runtime non-secret feature flag | committed as `false` for isolation |
| `CONTENT_OS_SERVICE_SECRET` | runtime secret | omit while Content OS service auth is disabled |
| `CLOUDFLARE_ACCOUNT_ID` | deploy-time restricted config | needed for non-interactive deployment, not a Worker binding |
| `CLOUDFLARE_API_TOKEN` | deploy-time secret | needed for non-interactive deployment, not a Worker binding |

Legacy `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` remain accepted by existing application configuration but are not recommended for the new staging target.

No application variable is required while compiling the Worker. All application values above are runtime bindings; the two Cloudflare credentials are deploy-tool inputs only.

## Operational constraints

Five unique Cron Triggers consume the entire account-wide Cron Trigger allowance on a Cloudflare Workers Free plan. The Free plan's 10 ms CPU limit may also be insufficient for SSR or scheduled processing. Account plan/quota and the account subdomain must be confirmed before an authorized staging deployment.

Other deploy-time prerequisites are staging-only Supabase keys, a dedicated staging Telegram bot/chat identity, the final Worker URL for `APP_URL`, and explicit authorization to set secrets and register the staging webhook. None is needed for the local build gate, and none was accessed or changed in this sprint.
