# Sprint 0 technical plan

## 1. Repository structure

Use a single Next.js application with `src/app`, pure `src/domain`, trusted `src/server`, Telegram-specific `src/telegram`, versioned `supabase/migrations`, and `tests`. Keep package and tool configuration at the root.

## 2. Framework and runtime

Use Next.js App Router, React, strict TypeScript, and the default Node.js runtime. Use plain responsive CSS for the single foundation page; a component framework is unnecessary at this stage.

## 3. Dependencies

Production dependencies are limited to Next.js/React, `@supabase/supabase-js`, and Zod. Development dependencies provide TypeScript, ESLint, Vitest, Node/React types, and a pinned Supabase CLI. Commit the npm lockfile.

## 4. Supabase integration

Create a lazily initialized server-only administrative client. Keep all keys out of browser bundles. Create a local Supabase config and an ordered migration for users, tasks, events, requests, and revisions.

## 5. Telegram webhook architecture

Expose `POST /api/telegram/webhook`. Authenticate the Telegram secret-token header, safely parse the update, and dispatch supported commands to a small Telegram adapter. The Sprint 0 dispatcher handles only a `/start` placeholder. Telegram API calls use built-in `fetch` and validated configuration, avoiding an extra bot framework.

## 6. Mini App architecture

Serve a mobile-first App Router shell. Future UI/API adapters will submit validated commands to application services. The foundation page uses no privileged environment values and makes no direct database calls.

## 7. Domain/business logic

Put statuses, priorities, task input schemas, event types, permission decisions, and domain errors in `src/domain`. These modules remain framework- and database-independent.

## 8. Authentication strategy

Sprint 0 defines the verified Telegram identity boundary but does not implement onboarding or sessions. The webhook trusts only Telegram calls with the configured secret header. A later Mini App endpoint will cryptographically verify `initData`, enforce an age limit, and resolve the verified Telegram user to an active database user.

## 9. Permission architecture

Application services will receive trusted `ActorContext` and evaluate centralized guards for task fields and workflow actions. Initial guards prove that Head can manage all tasks, a creator can manage their task, and an assignee cannot directly change deadline or assignee.

## 10. Migration strategy

Use Supabase CLI-generated, timestamped SQL migrations. Keep state constraints and common query indexes in the database. Lock tables from public Data API roles, enable RLS without broad policies, and make task events immutable with database triggers. Later atomic workflow operations will use small transactional PostgreSQL functions introduced by migrations.

## 11. Testing strategy

Use Vitest for pure unit tests. Test permission boundaries, canonical status/priority and task-input validation, environment parsing, Telegram parsing, and webhook secret comparison. Live database integration and end-to-end webhook tests begin when credentials/local Docker are available.

## 12. Local development

Require Node.js 22 or later. Developers copy `.env.example` to ignored `.env.local`, run `npm install`, and use `npm run dev`. A pinned Supabase CLI and scripts support local Docker-based database startup.

## 13. Expected deployment

Deploy one Next.js service and one Supabase project. Apply reviewed migrations, configure server-side environment variables, register the Telegram webhook and secret, and use HTTPS. Deployment itself is outside Sprint 0.

## 14. Risks

- Telegram Mini App verification and replay limits must be implemented before authenticated UI data is exposed.
- Service-role usage makes application-layer authorization critical; repository methods must never be exposed directly to unverified handlers.
- State/event atomicity must be preserved through transactional database functions as workflows are implemented.
- Telegram usernames can change, so all ownership uses immutable internal UUIDs and numeric Telegram IDs.
- Reminder/report jobs need idempotency and timezone tests before launch.

## 15. Definition of Done

- Required documentation and agent guidance exist.
- The required branch contains a minimal working Next.js skeleton.
- Environment variables are documented, validated, and ignored when secret-bearing.
- Foundational tables, constraints, indexes, RLS lock-down, and immutable event enforcement are in a versioned migration.
- Shared permission, validation, event, repository, Telegram, health, and Mini App foundations exist without Sprint 1+ features.
- Meaningful automated tests pass.
- Lint, typecheck, test, and production build all pass.
- Final status/diff review finds no secrets or unrelated changes.
