# Current sprint

## Sprint 9E — Task Bot release blockers

- Branch: `codex/sprint-9b-hardening`
- Starting HEAD: `a9ed78a`
- Objective: remove retryable SQLSTATEs from expected Task Bot refusals and make Task Bot the sole owner of the complete shared Supabase migration manifest.
- Scope: Task Bot only; Content OS read-only; no push, deploy, live migration, or production credentials.

## Status

Local release preparation is complete and `DB_RELEASE = GO` for the reviewed manifest:

- Expected application refusals now use `PT409`; genuine PostgreSQL `40001` serialization failures remain distinct.
- Real PostgREST 12.2.3 verification: two illegal transitions each returned HTTP 409 with code `PT409` and the stable message; request latency was 48 ms / 4 ms, aggregate rollback delta was 1 (no loop), no authenticator connection remained active, and task state did not change.
- The application maps `PT409` to `CONFLICT` and maps a real `40001` to `INTEGRATION_UNAVAILABLE`.
- The canonical Task Bot manifest contains exactly 19 ordered migrations. Content OS 00–06 copies match the source SHA-256 values byte-for-byte.
- PostgreSQL 17.11 + repo-pinned Supabase CLI 2.116.0 rehearsal established the eight-row live baseline with normal `db push`, listed the 11 remaining migrations with normal `db push --dry-run`, applied them to the disposable database, reached the exact 19-row ledger, then reported no pending migrations.
- No `--include-all`, history repair, or manual migration-ledger insertion was used.
- SQL transition, Content OS contract, privilege, and `#posting` suites passed. Catalog: 27 Content OS tables, RLS-disabled 0, policies 0, dangerous ambient service-role privileges 0, effective manually authored `40001` functions 0.
- Full application gate: manifest guard PASS; lint PASS; typecheck PASS; 275/275 tests PASS (35 files); production build PASS; `git diff --check` PASS.
- Content OS was not edited by this work. Its branch advanced externally from the expected `13ddf29` to clean `ceb5f52`; the seven source migration hashes did not change.

## Release rules

- Production `supabase db push` runs only from Task Bot's complete manifest.
- Before traffic, retry a corrected failed transactional migration.
- After traffic, prefer fix-forward; use PITR only for a catastrophic recovery.
- Never run the combined Content OS down script in production or manipulate migration history to simulate rollback.
- This sprint did not push, deploy, or apply anything to live Supabase.
