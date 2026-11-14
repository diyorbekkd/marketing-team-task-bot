# Production readiness audit — 2026-11-14

## Executive verdict

The application code is substantially safer, more complete, and more scalable than the deployed baseline. All local static/unit/build gates pass and the production database was audited read-only. This branch is ready for a staging migration and preview acceptance cycle; it is **not yet approved for production merge/deploy** because the five new migrations have not run against an isolated PostgreSQL/Supabase environment, the connected Vercel account cannot access the production project for a preview, and no real Telegram/iOS/Android test session is available here.

No production data, schema, deployment, webhook, or Telegram recipient was changed during this audit.

## Environment and access inventory

| Area | Observed state | Result |
| --- | --- | --- |
| GitHub | Repository writable; default/base is `fast-track/mvp`; no `main` branch exists | Work isolated on `codex/production-readiness-audit`; PR targets `fast-track/mvp` |
| Production Supabase | `cbjcclefgxrdyjwkjcpq`, `ACTIVE_HEALTHY`, PostgreSQL 17.6 | Read-only schema/data/advisor/plan audit completed |
| Staging Supabase | `yuznbaaoonyqonhiywkt`, `INACTIVE`, PostgreSQL 17.11 | Not restored or changed without approval; migration integration gate blocked |
| Vercel | Connected account exposes only an empty staging project, not the production project | No preview deployment or runtime-log validation possible |
| Telegram | No isolated test bot credentials/test users in the environment | No messages sent; webhook/Mini App end-to-end gate blocked |
| Local runtime | Node 24, npm, Next.js build and Vitest available | Full code gate available |
| Browser/device | Browser automation exists, but no authenticated Telegram client or physical iOS/Android device | Real Mini App mobile acceptance remains human QA |

## Production facts (read-only)

- Remote migration history matched the original eight repository migrations through `20260914090000_autostart_tasks` before this branch.
- Current row counts: 8 users, 183 tasks, 964 task events, 49 deadline requests, 3 revisions, 770 report-delivery rows, 720 reminder-delivery rows, and 3 user events.
- The event table is already at 964 rows, close to PostgREST's standard 1,000-row response ceiling. The previous single-response `listAllTaskEvents()` therefore had an imminent silent-truncation risk; reports could become incomplete without throwing an error.
- All 12 existing public tables have RLS enabled. Browser roles have no effective table access and no policies; this is intentional for the server-mediated architecture. Supabase reports only the informational [RLS enabled/no policy lint](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Performance advisor reports 14 informational [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) and 5 [unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index). The new migration adds indexes for actual task-list/deadline access paths; low-value actor/audit foreign keys were not blindly indexed at this data size.
- Health advisor returned no active notices. The production database is nevertheless on PostgreSQL 17.6 while staging advertises 17.11; schedule the managed platform upgrade separately from this application release.

## Findings and remediation

### P0 — fixed in this branch

1. **Role privilege escalation.** An ordinary member could update their own organizational role through the generic role flow. Role changes are now Head-only, cannot assign/transfer the Head role, and remain atomically audited.
2. **Unbounded history reads.** Task/event/deadline-request reads loaded whole tables and filtered in Node. Full-history reads now keyset-page in 500-row chunks; task screens use database filters and stable cursors with a 100-row hard maximum.
3. **Notification loss after one failure.** Report/reminder ledgers could remain uniquely `FAILED` forever. A durable per-recipient outbox now claims with `SKIP LOCKED`, recovers stale claims, retries with bounded exponential backoff, and reconciles successful report retries with the report ledger. Reminder retry metadata prevents resending to recipients who already succeeded.

### P1 — fixed in this branch

- Added server-side task search, status/priority/assignee/deadline filters, “Men yaratgan”, three stable sorts, and load-more keyset pagination.
- Home now requests only visible, non-terminal tasks instead of all historical tasks.
- Added atomic task editing with a database-rechecked field permission matrix and audit events.
- Added immutable task comments/results with HTTP(S) links and safe image preview behavior.
- Added distinct publication dates and a day/week/month marketing calendar.
- Added seven sequential marketing workflow templates, automatic next-step creation, idempotent step identity, notifications, and recovery cron.
- Added per-user notification preferences and the weekday 17:30 Tashkent daily check.
- Added browser cross-site mutation rejection while preserving webhook/cron server calls.
- Centralized Uzbek enum/navigation/filter labels behind an i18n catalog.
- Extracted Calendar into a separate component; the remaining `MiniApp.tsx` is still large and needs further low-risk decomposition.
- Updated supported dependencies and added a GitHub Actions quality gate.

### P2 — accepted/deferred

- Workflow templates are normalized/reusable but do not yet expose an edit/version UI. Mutating a template used by historical runs needs clone/version semantics so audit history cannot change retroactively.
- No API rate limiter was added. Telegram webhook secret validation, cron bearer validation, authenticated session checks, strict request schemas, and platform limits are present; add a distributed limiter if this expands beyond the current five-person team or a public endpoint appears.
- Assignment enqueue occurs immediately after the task transaction, not inside the same PostgreSQL transaction. The outbox makes an enqueued send reliable, but a process crash in the narrow post-commit/pre-enqueue window can still lose an assignment push. Closing this requires creating the outbox row inside task/workflow RPCs.
- Telegram delivery is at-least-once across two systems. Deduplication prevents logical retries inside this service, but no Telegram API can atomically commit with PostgreSQL.
- The weekday 17:30 check is delivered with one authenticated Mini App button, not a separate inline status callback for every task. Users update task status in the Mini App, where the normal authorization and checklist rules are enforced.
- Drag-and-drop Kanban, optimistic mutation UI, deeper caching, safe workflow-template editing, subtasks, and automated React browser tests remain deferred. Existing button-based transitions preserve permissions.
- `MiniApp.tsx` remains about 3,000 lines after the Calendar extraction; Task Detail, Workflow Start, and Team/Profile panels are the next decomposition targets.

## Performance evidence

The production database is currently small, so PostgreSQL execution time alone does not show a dramatic improvement; response size and bounded growth are the important differences.

| Production read | Previous path | New scoped path | Observed result |
| --- | --- | --- | --- |
| Task list/Home | 183 rows sorted and transferred, then filtered in Node | Head-visible open tasks, `LIMIT 50`, database filter | 20 rows returned: **89.1% fewer rows** |
| Home open set | All 183 historical tasks | Only 34 globally open tasks before per-user visibility | **81.4% fewer candidate rows** |
| Task events | One unbounded response; 964 rows today | 500-row UUID keyset pages | Correct beyond the 1,000-row API ceiling |
| Task screens | Re-fetch/filter large arrays | Server filters + page cursor | Payload capped at 100 tasks per call |

Read-only `EXPLAIN (ANALYZE, BUFFERS)` on production returned 0.219 ms for the cached 183-row full task scan/sort and 0.201 ms for the 20-row scoped result. At current scale the latency is effectively equal, while transferred rows drop 89.1% and the new route stays bounded as data grows. The production plan already used `tasks_status_deadline_idx` for the scoped open-task query; the pending migration adds cursor/visibility index shapes used by the new repository queries.

No authenticated Telegram preview was available, so initial render/network timing and slow-mobile measurements were not fabricated.

## Security review

- Telegram `initData`: HMAC signature, authentication timestamp, duplicate critical-parameter rejection, and active-user resolution verified in code/tests.
- Sessions: HMAC-signed token in HttpOnly, Secure, SameSite=Strict cookie; every request re-resolves active membership.
- Webhook: secret-token header validation and runtime payload validation retained.
- Cron: Bearer secret compared in constant time; new retry/recovery jobs use the same protected route.
- Authorization: shared application guards plus transactional PostgreSQL checks for sensitive task edits/workflows; Head-only role mutation and workflow start.
- CSRF: cross-site browser mutations rejected using `Origin` and `Sec-Fetch-Site`; server webhook/cron traffic remains supported.
- Database: RLS enabled, browser grants revoked, service-role-only tables/RPCs, immutable audit/comment history.
- Secrets: no environment files or secret values changed/committed; production dependency audit reports zero vulnerabilities.

## Verification completed

- `npm run lint`: pass
- `npm run typecheck`: pass
- `npm test`: pass — 226/226 tests in 26 files
- `npm run build`: pass — Next.js 16.4.6 production build, 26 application/API routes plus Proxy
- `npm audit --omit=dev`: expected production gate, zero vulnerabilities after dependency update
- `npm audit --audit-level=high`: passes; eight moderate `minimatch` advisories remain in the ESLint toolchain with no published fix and are not shipped to production
- `git diff --check`: pass
- Production Supabase: read-only migration parity, row counts, RLS/grants, advisors, and query plans inspected

## Release gates still required

1. Restore or replace the staging Supabase project, apply all migrations from a clean baseline, run migration lint/contract tests, then rerun security/performance advisors.
2. Connect the correct Vercel team/project, create a preview with staging secrets, and smoke every route/cron without production recipients.
3. Use an isolated Telegram test bot and users for onboarding, create/edit/comment/result, review/revision/approve, deadline request, reminder partial failure/retry, workflow advancement/recovery, and daily check.
4. Run the Mini App on real iOS Telegram, Android Telegram, Telegram Web, and desktop for dark/light mode, keyboard, safe areas, bottom sheets, slow network, error/empty states, and calendar views.
5. Review the PR and explicitly approve production migrations/deployment. Do not create `main`; the repository's actual release base remains `fast-track/mvp` until the owner chooses a branch strategy.

## Production readiness decision

**Code review readiness: yes. Production rollout readiness: no, pending the five release gates above.** Merge to the release branch and production database/deployment changes require the owner's explicit approval.
