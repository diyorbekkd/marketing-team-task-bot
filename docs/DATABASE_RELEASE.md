# Shared database release policy

## Canonical owner

The Task Bot repository is the sole production owner of the shared Supabase migration history. Production `supabase db push` runs only from this repository and only against the complete `supabase/migrations` manifest.

Content OS may retain source/reference migrations, but those files are not pushed independently to the shared database. Every future shared-database migration version must enter Task Bot's canonical manifest before release. Run `npm run db:check-manifest` in CI and before any database release; it rejects duplicate or unexpected versions and verifies the seven imported Content OS files by SHA-256.

The canonical release inventory is the 20-file order enforced by `scripts/check-migration-manifest.mjs`: eight already-live Task Bot migrations, Content OS 00–05, three Task Bot Sprint 9 migrations, Content OS 06, the Task Bot compatibility migration, then the Sprint 10A Telegram web-auth migration.

Sprint 9F freezes the release candidate in `docs/SPRINT_9F_RELEASE_MANIFEST.md`, records all 19 checksums in `docs/SPRINT_9F_MIGRATIONS.sha256`, and defines the gated production procedure in `docs/SPRINT_9F_PRODUCTION_RUNBOOK.md`. Database readiness does not clear the separate Content OS platform-auth gate.

Sprint 10A supersedes that 19-file database candidate with the 20-file inventory in `docs/SPRINT_10A_MIGRATIONS.sha256`. The expected live ledger remains eight rows before release and becomes 20 rows afterward; the normal dry-run must therefore show exactly 12 pending migrations. Sprint 10A replaces the abandoned Sites identity dependency with Telegram-approved server sessions, but no migration may be applied live until a separately approved production run.

## Release flow

Use the repository-pinned Supabase CLI. Against the target database, first run:

```sh
./node_modules/.bin/supabase db push --dry-run --db-url "$DATABASE_URL"
```

Review the exact pending sequence, run the same command without `--dry-run` once approved, then repeat the dry-run and require no pending migrations. The normal release must not require `--include-all`, `supabase migration repair`, or manual edits/inserts in `supabase_migrations.schema_migrations`.

## Business refusals and SQLSTATE

Expected Task Bot state/precondition refusals use `PT409`. PostgREST returns these once as HTTP 409 with a deterministic JSON `code` and `message`; the application maps `PT409` to `CONFLICT`. A genuine PostgreSQL serialization failure retains SQLSTATE `40001` and is not classified as a Task Bot business refusal.

The Sprint 9E audit found no authored real-serialization handler or explicit real-serialization raise. Every pre-existing literal `40001` was an application/business rejection:

| Migration | Occurrences and classification |
| --- | --- |
| `20260906151514_fast_track_mvp_core.sql` | illegal task transition; terminal-task deadline request; already-resolved deadline request; concurrently resolved deadline request — all business refusals |
| `20260909090000_next_product_phase.sql` | unresolved idempotent-create conflict; illegal task transition; checklist status precondition — all business refusals |
| `20260909200000_reminders_and_membership.sql` | already-active activation; inactive role update; already-inactive deactivation; already-active reactivation; terminal-task reassignment — all business refusals |
| `20260914090000_autostart_tasks.sql` | unresolved idempotent-create conflict — business refusal |
| `20261014123341_repair_posting_checklist_creation.sql` | unresolved idempotent checklist conflict — business refusal, changed directly to `PT409` before release |
| `20261014130332_content_os_task_transition_compatibility.sql` | completion predicate; review-required direct completion; completion predicate; missing revision provenance; stale Head Review on resubmit; stale Head Review on revision; illegal transition — all business refusals, changed directly to `PT409` |
| `supabase/rollbacks/20261014130332_content_os_task_transition_compatibility.down.sql` | illegal legacy transition — business refusal, changed to `PT409` for local rollback testing |

The first eight migration files are immutable because their versions are already live. The final compatibility migration rewrites only manually authored `ERRCODE = '40001'` clauses in the currently effective `public`/`private` Task Bot function bodies to `PT409` and asserts that none remain. It does not catch or remap engine-raised serialization failures.

## Failure and rollback policy

Before traffic reaches the new schema, a failed transactional migration can be corrected and retried normally; PostgreSQL rolls back the failed migration transaction.

After traffic reaches the schema, prefer a new forward migration. Use point-in-time recovery only for a catastrophic incident under the database recovery procedure. Do not run the combined Content OS down script in production, do not treat repository `.down.sql` files as a production migration mechanism, and do not manipulate migration history to fake a rollback.
