# Sprint 9F production runbook

This runbook was originally frozen with the Sprint 9F release candidate in `docs/SPRINT_9F_RELEASE_MANIFEST.md`. Its database source and inventory are reconciled here to the final Sprint 10E-FIX canonical release. It describes a future, separately authorized production release. It does not authorize one.

```text
DB_RELEASE = GO
APPLICATION_RELEASE = BLOCKED_ON_PLATFORM_AUTH
PRODUCTION_RELEASE = HOLD
CONTENT_OS_IDENTITY_TRUST = UNSET
```

Stop immediately on any unexpected output, dirty repository, SHA/hash mismatch, ledger drift, unavailable PITR/backup, failed catalog assertion, or missing human approval. Never replace a failed check with `--include-all`, history repair, or a manual ledger edit.

## Frozen constants

- Task Bot release-control repository: `/workspaces/codespaces-blank/marketing-team-task-bot-sprint9b`
- Task Bot release SHA: `3bd2ca73cd810b09fcee850271a6e29acb63dcd6`
- Content OS source repository: `/workspaces/codespaces-blank/ibox-content-funnel`
- Content OS release SHA: `ceb5f52184f1886948ebb8a7f6b4196b6de6f42a`
- Content OS Site/project tenant: `appgprj_6aaeb64e7ed88191b9710786438491d2`
- Canonical migration count: 23
- Expected live ledger before release: 8 rows
- Expected pending migrations: 15
- Expected live ledger after release: 23 rows
- Supabase CLI: repository-pinned `2.116.0`

Never substitute a branch tip or an abbreviated SHA for a frozen release SHA.

## 1. Precheck

### 1.1 Source and manifest

The release-control documentation is committed after the frozen application/database source, so do not deploy its moving branch tip. Create clean detached artifact worktrees at the two frozen SHAs. The commands below assume the exact temporary paths shown and that neither path already exists:

```sh
git -C /workspaces/codespaces-blank/marketing-team-task-bot-sprint9b worktree add --detach /tmp/sprint-9f-task-bot-rc 3bd2ca73cd810b09fcee850271a6e29acb63dcd6
git -C /workspaces/codespaces-blank/ibox-content-funnel worktree add --detach /tmp/sprint-9f-content-os-rc ceb5f52184f1886948ebb8a7f6b4196b6de6f42a

cd /tmp/sprint-9f-task-bot-rc
test "$(git rev-parse HEAD)" = "3bd2ca73cd810b09fcee850271a6e29acb63dcd6"
test -z "$(git status --porcelain=v1)"
npm ci
npm run db:check-manifest
(cd supabase/migrations && sha256sum -c /workspaces/codespaces-blank/marketing-team-task-bot-sprint9b/docs/SPRINT_10E_FIX_MIGRATIONS.sha256)
env DO_NOT_TRACK=1 ./node_modules/.bin/supabase --version

cd /tmp/sprint-9f-content-os-rc
test "$(git rev-parse HEAD)" = "ceb5f52184f1886948ebb8a7f6b4196b6de6f42a"
test -z "$(git status --porcelain=v1)"
```

The CLI version output must be exactly `2.116.0`. The manifest guard must report 23 ordered versions, no duplicates, and seven byte-identical Content OS files. The checksum verification must report `OK` for all 23 files.

The seven source/canonical comparisons must all exit zero:

```sh
cmp --silent /tmp/sprint-9f-content-os-rc/supabase/content-os-drafts/migrations/20261009100000_content_os_00_helpers.sql /tmp/sprint-9f-task-bot-rc/supabase/migrations/20261009100000_content_os_00_helpers.sql
cmp --silent /tmp/sprint-9f-content-os-rc/supabase/content-os-drafts/migrations/20261009100100_content_os_01_content_entities.sql /tmp/sprint-9f-task-bot-rc/supabase/migrations/20261009100100_content_os_01_content_entities.sql
cmp --silent /tmp/sprint-9f-content-os-rc/supabase/content-os-drafts/migrations/20261009100200_content_os_02_task_config.sql /tmp/sprint-9f-task-bot-rc/supabase/migrations/20261009100200_content_os_02_task_config.sql
cmp --silent /tmp/sprint-9f-content-os-rc/supabase/content-os-drafts/migrations/20261009100300_content_os_03_task_runtime.sql /tmp/sprint-9f-task-bot-rc/supabase/migrations/20261009100300_content_os_03_task_runtime.sql
cmp --silent /tmp/sprint-9f-content-os-rc/supabase/content-os-drafts/migrations/20261009100400_content_os_04_idempotency.sql /tmp/sprint-9f-task-bot-rc/supabase/migrations/20261009100400_content_os_04_idempotency.sql
cmp --silent /tmp/sprint-9f-content-os-rc/supabase/content-os-drafts/migrations/20261009100500_content_os_05_external_identity_links.sql /tmp/sprint-9f-task-bot-rc/supabase/migrations/20261009100500_content_os_05_external_identity_links.sql
cmp --silent /tmp/sprint-9f-content-os-rc/supabase/content-os-drafts/migrations/20261014130000_content_os_06_transition_contract.sql /tmp/sprint-9f-task-bot-rc/supabase/migrations/20261014130000_content_os_06_transition_contract.sql
```

### 1.2 Backup, ledger, and read-only catalog

An authorized database operator must inject the percent-encoded production connection string as the masked `SPRINT_9F_DB_URL` environment variable. Never echo it, write it to a repository file, or include it in release logs.

Confirm a current recoverable backup/PITR point and record its provider reference, timestamp, retention, and restore owner in the approval record. Then run the read-only precheck:

```sh
psql -X "$SPRINT_9F_DB_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
begin read only;
select version
from supabase_migrations.schema_migrations
order by version;
select 'postgres_major=' || current_setting('server_version_num')::integer / 10000;
select 'users=' || (to_regclass('public.users') is not null)::text;
select 'tasks=' || (to_regclass('public.tasks') is not null)::text;
select 'task_events=' || (to_regclass('public.task_events') is not null)::text;
select 'content_os_tables=' || count(*)::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and (c.relname like 'content_%' or c.relname = 'external_identity_links');
rollback;
SQL
```

Expected ledger output is exactly:

```text
20260906143255
20260906150722
20260906151514
20260906162000
20260906163500
20260909090000
20260909200000
20260914090000
```

The remaining output must include `postgres_major=17`, `users=true`, `tasks=true`, `task_events=true`, and `content_os_tables=0`. Any other ledger row or unexpected Content OS object is drift.

### 1.3 Application authentication gate

Database readiness does not clear the application gate. Before any application release, obtain a written OpenAI Sites platform-owner answer for Site `appgprj_6aaeb64e7ed88191b9710786438491d2` confirming all of the following:

1. Dispatch removes or overwrites every client-supplied `oai-authenticated-user-*` header, including anonymous and `/api/*` requests.
2. Dispatch is the only ingress: no `workers.dev`, preview/version URL, custom domain, route, alias, or service binding bypasses it.
3. The Site is private, so only signed-in visitors reach it.
4. `oai-authenticated-user-id` is stable for the Site lifetime, and the Site project ID is the correct identity tenant; alternatively, the platform supplies a server-verifiable signed identity assertion.

Until all answers are documented and approved, `APPLICATION_RELEASE` remains `BLOCKED_ON_PLATFORM_AUTH`, `PRODUCTION_RELEASE` remains `HOLD`, `CONTENT_OS_PERSISTENCE_ENABLED` remains `false`, and `CONTENT_OS_IDENTITY_TRUST` must be absent—not empty, not a placeholder, and not `OPENAI_SITES_DISPATCH`.

## 2. Database release

Run database commands only after the precheck and database-execution approval boxes are signed. Run only from the frozen Task Bot canonical owner:

```sh
cd /tmp/sprint-9f-task-bot-rc
env DO_NOT_TRACK=1 ./node_modules/.bin/supabase db push --dry-run --db-url "$SPRINT_9F_DB_URL"
```

The dry-run must list exactly these 15 pending migrations, in this order:

```text
20261009100000_content_os_00_helpers.sql
20261009100100_content_os_01_content_entities.sql
20261009100200_content_os_02_task_config.sql
20261009100300_content_os_03_task_runtime.sql
20261009100400_content_os_04_idempotency.sql
20261009100500_content_os_05_external_identity_links.sql
20261014120000_seo_specialist_role.sql
20261014120100_harden_service_role_table_privileges.sql
20261014123341_repair_posting_checklist_creation.sql
20261014130000_content_os_06_transition_contract.sql
20261014130332_content_os_task_transition_compatibility.sql
20261015121850_content_os_telegram_web_auth.sql
20261015132700_sprint_10b_team_permissions_task_management.sql
20261015151900_sprint_10d_workflow_auth_notification_hardening.sql
20261015164349_sprint_10e_final_blocker_closure.sql
```

After a human verifies the dry-run output and signs the apply approval, apply once with the same pinned CLI and connection:

```sh
env DO_NOT_TRACK=1 ./node_modules/.bin/supabase db push --db-url "$SPRINT_9F_DB_URL"
env DO_NOT_TRACK=1 ./node_modules/.bin/supabase db push --dry-run --db-url "$SPRINT_9F_DB_URL"
```

The second dry-run must report no pending migrations. Do not add `--include-all`; do not run migration repair; do not edit `supabase_migrations.schema_migrations`.

### 2.1 Final ledger and catalog

Verify all 23 ledger versions against the manifest:

```sh
psql -X "$SPRINT_9F_DB_URL" -v ON_ERROR_STOP=1 -Atc \
  "select version from supabase_migrations.schema_migrations order by version;"
```

The output must equal the 23 versions in `docs/SPRINT_9F_RELEASE_MANIFEST.md`, with no additional row. Then run this read-only catalog check:

```sh
psql -X "$SPRINT_9F_DB_URL" -v ON_ERROR_STOP=1 -P pager=off <<'SQL'
begin read only;

with content_tables as (
  select c.oid, c.relname, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (c.relname like 'content_%' or c.relname = 'external_identity_links')
)
select
  count(*) as content_os_tables,
  count(*) filter (where not relrowsecurity) as rls_disabled,
  (select count(*) from pg_policies p join content_tables t on t.relname = p.tablename where p.schemaname = 'public') as policies
from content_tables;

with public_tables as (
  select format('%I.%I', n.nspname, c.relname) as qualified_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
), dangerous(privilege) as (
  values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
)
select count(*) as dangerous_service_role_privileges
from public_tables cross join dangerous
where has_table_privilege('service_role', qualified_name, privilege);

with table_names(table_name) as (
  values
    ('users'), ('tasks'), ('task_events'), ('deadline_change_requests'),
    ('reassign_requests'), ('task_revisions'), ('recurring_definitions'),
    ('task_checklists'), ('task_checklist_items'), ('report_deliveries'),
    ('user_events'), ('task_reminder_deliveries')
), privilege_names(ordinal, privilege) as (
  values
    (1, 'SELECT'), (2, 'INSERT'), (3, 'UPDATE'), (4, 'DELETE'),
    (5, 'TRUNCATE'), (6, 'REFERENCES'), (7, 'TRIGGER'), (8, 'MAINTAIN')
), matrix as (
  select table_name,
         coalesce(string_agg(privilege, ',' order by ordinal)
           filter (where has_table_privilege('service_role', ('public.' || table_name)::regclass, privilege)), '-') as privileges
  from table_names cross join privilege_names
  group by table_name
)
select string_agg(table_name || '=' || privileges, ' ' order by table_name) as service_role_matrix
from matrix;

select pg_get_constraintdef(oid) as users_role_check
from pg_constraint
where conname = 'users_role_check' and conrelid = 'public.users'::regclass;

select count(*) as public_content_os_functions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'content_os_%';

select p.prosecdef as transition_security_definer, p.proconfig as transition_function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'transition_task_with_events';

rollback;
SQL
```

Required results:

- `content_os_tables = 27`, `rls_disabled = 0`, `policies = 0`.
- `dangerous_service_role_privileges = 0`.
- The 12-table `service_role` matrix is exactly:

  ```text
  deadline_change_requests=SELECT,INSERT,UPDATE,DELETE reassign_requests=SELECT,INSERT,UPDATE,DELETE recurring_definitions=SELECT,INSERT,UPDATE,DELETE report_deliveries=SELECT,INSERT,UPDATE task_checklist_items=SELECT,INSERT,UPDATE task_checklists=SELECT,INSERT task_events=SELECT,INSERT task_reminder_deliveries=SELECT,INSERT,UPDATE task_revisions=SELECT,INSERT tasks=SELECT,INSERT,UPDATE,DELETE user_events=SELECT,INSERT users=SELECT,INSERT,UPDATE,DELETE
  ```
- `users_role_check` includes `SEO_SPECIALIST` and all five prior roles.
- `public_content_os_functions = 8`.
- Exactly one transition row is returned, with `transition_security_definer = false` and an empty pinned `search_path` in `transition_function_config`.

If database verification fails before application traffic reaches the new schema, stop traffic and correct/retry the failed transactional migration. If the migrations succeeded but a verification assertion fails, do not manipulate ledger state; escalate for a reviewed fix-forward migration.

## 3. Application release — currently blocked

Do not execute this section while the frozen status is `APPLICATION_RELEASE = BLOCKED_ON_PLATFORM_AUTH`. A new approval record must explicitly set `APPLICATION_RELEASE = GO`; this frozen manifest remains historical and unchanged.

### 3.1 Build exact candidates

Build only from the frozen commits and retain artifact checksums:

```sh
cd /tmp/sprint-9f-task-bot-rc
test "$(git rev-parse HEAD)" = "3bd2ca73cd810b09fcee850271a6e29acb63dcd6"
npm run lint
npm run typecheck
npm test
npm run build

cd /tmp/sprint-9f-content-os-rc
test "$(git rev-parse HEAD)" = "ceb5f52184f1886948ebb8a7f6b4196b6de6f42a"
npm run install:ci
npm run lint
npm run typecheck
npm run test:persistence-adapter
npm run test:blog-review-lineage
npm run test:blog-review-recovery
npm run build
```

Publish Content OS only through the approved OpenAI Sites release workflow, pinned to the exact Content OS SHA above. Record the Sites version/deployment identifier and prove that its source SHA is `ceb5f52184f1886948ebb8a7f6b4196b6de6f42a`. Do not publish from a moving branch tip.

### 3.2 Environment contract

Before the platform gate is approved:

- `CONTENT_OS_PERSISTENCE_ENABLED=false`
- `CONTENT_OS_IDENTITY_TRUST` absent
- `CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY` absent from client/public configuration

Only after the written platform guarantee, database verification, and application approval may the server-side Content OS deployment receive:

- `CONTENT_OS_PERSISTENCE_ENABLED=true`
- `CONTENT_OS_SUPABASE_URL` — HTTPS project URL
- `CONTENT_OS_SUPABASE_SERVICE_ROLE_KEY` — server-only secret
- `CONTENT_OS_IDENTITY_TENANT_KEY=appgprj_6aaeb64e7ed88191b9710786438491d2`
- `CONTENT_OS_IDENTITY_TRUST=OPENAI_SITES_DISPATCH`

Preserve the existing Content OS data-source settings (`GOOGLE_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, and `DATA_SOURCE`) exactly as approved for that deployment. Leave unused Task Backend experiment variables disabled/unset.

If Task Bot is redeployed, preserve its required server configuration from `.env.example`: `APP_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_GROUP_ID`, `HEAD_TELEGRAM_USER_ID`, `APP_TIMEZONE=Asia/Tashkent`, and `CRON_SECRET`. Keep `CONTENT_OS_SERVICE_AUTH_ENABLED=false` and `CONTENT_OS_SERVICE_SECRET` unset unless a separately approved service-auth release requires them.

No service-role/secret key may use a `NEXT_PUBLIC_` prefix, appear in browser code or bundles, be printed in logs, or be included in the release record. Review platform environment scopes so secrets are server-runtime-only.

## 4. Production smoke

Run only after database verification, `APPLICATION_RELEASE = GO`, application deployment approval, and deployment of the exact frozen artifacts. Use controlled smoke records and record every created identifier.

1. Create one ordinary non-Content-OS Task Bot task through the legacy application path. Require one task, one creation event, and current initial state `IN_PROGRESS`; exercise one permitted legacy transition.
2. Create one task containing exact token `#posting`. Require one checklist with exactly Telegram, Instagram, YouTube, and X/Twitter items; incomplete items must block review, and completing all four must permit the normal review transition.
3. Verify an active `SEO_SPECIALIST` can be stored, resolved, and assigned a task without altering any prior role.
4. As the mapped Blog author, call the Content OS Blog flow with action `start`. Require exactly one Blog entity, one Blog task, pinned runtime/provenance, and no duplicate on an identical idempotent retry.
5. Complete the Blog with action `complete`. Require Blog `DONE` and exactly one Head Review in `IN_PROGRESS`, with its `reviewTaskId` and source provenance.
6. Before the valid review decision, attempt action `request-revision` as the Blog author/unrelated actor. Require denial with no task, event, revision, or link change.
7. As the authorized reviewer, request revision. Require the same Blog `DONE -> REVISION`, the same Head Review `IN_PROGRESS -> BLOCKED`, one revision record, and matching audit events.
8. As the Blog author, resubmit with action `complete`. Require Blog `REVISION -> DONE`, the identical Head Review `BLOCKED -> ASSIGNED`, `headReviewCreated=false`, and cleared decision metadata.
9. As the authorized reviewer, approve with action `approve`. Require that same Head Review `-> DONE` and decision `Approved`.
10. Recount by Blog id, Blog task id, and `reviewTaskId`: exactly one Blog, one Blog task, and one Head Review; no duplicate runtime, primary link, event, or revision caused by retries.
11. Inspect structured `content_os.blog_review` logs for each action. Require the expected `action`, `outcome`, HTTP status/code, internal `actorId`, and idempotency fields; require no request headers, external subject, request body, database URL, or secret value.

Any failed or ambiguous smoke result returns `PRODUCTION_RELEASE` to `HOLD` and starts incident/fix-forward handling.

## 5. Rollback and recovery

- Before traffic: a failed transactional migration may be corrected, reviewed, and retried normally.
- After traffic: prefer a reviewed forward migration or application fix-forward.
- Use PITR only for catastrophic recovery, under the approved recovery procedure and with the recorded restore owner.
- Never execute the combined Content OS down script against production traffic.
- Never execute repository `.down.sql` files as an improvised production rollback.
- Never insert, update, delete, restamp, or repair migration-ledger rows to fake state.

## 6. Human approval checklist

All boxes are intentionally unchecked. Names, timestamps, and evidence links belong in the release record, not in this frozen candidate document.

### Precheck approvals

- [ ] Release manager confirms Task Bot SHA `3bd2ca73cd810b09fcee850271a6e29acb63dcd6` and Content OS SHA `ceb5f52184f1886948ebb8a7f6b4196b6de6f42a`.
- [ ] Release manager confirms both release checkouts are clean.
- [ ] Database owner confirms all 23 hashes and all seven cross-repository comparisons.
- [ ] Database owner records the current backup/PITR reference, recovery point, retention, and restore owner.
- [ ] Database owner confirms the live ledger is exactly the expected eight rows.
- [ ] Database owner confirms the read-only pre-release catalog sanity output.
- [ ] Security/platform owner supplies written affirmative answers for the OpenAI Sites identity/ingress gate.
- [ ] Security owner confirms `CONTENT_OS_IDENTITY_TRUST` is absent before that approval.

### Execution approvals

- [ ] Database owner approves the exact 15-migration dry-run output.
- [ ] Release manager approves the one normal `supabase db push` execution.
- [ ] Database owner confirms the final 23-row ledger and exact catalog/privilege results.
- [ ] Authorized approver records a new `APPLICATION_RELEASE = GO` decision; it is not inherited from database GO.
- [ ] Security owner approves the server-only environment-variable scopes and confirms no service-role secret exposure.
- [ ] Release manager approves deployment of only the frozen Task Bot and Content OS artifacts.

### Post-release approvals

- [ ] Smoke owner records the legacy Task Bot, `#posting`, and `SEO_SPECIALIST` results.
- [ ] Smoke owner records the complete Blog/Head Review/revision/resubmit/approval lifecycle and IDs.
- [ ] Security owner records the unauthorized-revision denial and structured-log inspection.
- [ ] Database owner confirms no duplicate Blog or Head Review records.
- [ ] Release manager reviews all evidence and explicitly changes `PRODUCTION_RELEASE` from `HOLD`; until then it remains `HOLD`.
