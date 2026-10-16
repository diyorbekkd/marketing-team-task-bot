# Production release candidate manifest

Originally frozen in Sprint 9F on 2026-10-15 and reconciled to the final Sprint 10E-FIX canonical database release on 2026-10-16. This manifest identifies deployable application and database source commits; later documentation and staging-only commits do not change the frozen production candidate.

## Release decision

```text
DB_RELEASE = GO
APPLICATION_RELEASE = BLOCKED_ON_PLATFORM_AUTH
PRODUCTION_RELEASE = HOLD
CONTENT_OS_IDENTITY_TRUST = UNSET
```

This candidate is not approved for production release. `CONTENT_OS_IDENTITY_TRUST` must remain absent from every deployment environment until the OpenAI Sites platform owner supplies the written identity/ingress guarantee required by the runbook and a separate human approval changes `APPLICATION_RELEASE` to `GO`.

## Frozen source

| Component | Branch | Exact release SHA | Clean at freeze |
| --- | --- | --- | --- |
| Task Bot | `codex/sprint-9b-hardening` | `3bd2ca73cd810b09fcee850271a6e29acb63dcd6` | Yes |
| Content OS | `sprint-9b/persistence-bridge` | `ceb5f52184f1886948ebb8a7f6b4196b6de6f42a` | Yes |

Task Bot is the sole production owner of the shared Supabase migration ledger. Production database commands run only from the Task Bot release SHA and its canonical `supabase/migrations` directory.

## Canonical migration manifest

| # | Version | File | SHA-256 |
| ---: | --- | --- | --- |
| 1 | `20260906143255` | `20260906143255_foundation_schema.sql` | `748c628544ce78e4774d5a5fde55c692d44e4e77e73e6f73edb04192cd1a35b2` |
| 2 | `20260906150722` | `20260906150722_harden_revision_history.sql` | `fa9409375182dde292a7bc1d67205245a75d68431a1bb1c26ea358a9367c2f49` |
| 3 | `20260906151514` | `20260906151514_fast_track_mvp_core.sql` | `642384caa91806091ef7beae30b34b3efe3eebdfa7e622f12d3e70bb74d90b8c` |
| 4 | `20260906162000` | `20260906162000_secure_head_bootstrap.sql` | `344b72f417f536e9f7959c2d100f853f9ce90caf3dae0c4f22939aa4c4cf0f7d` |
| 5 | `20260906163500` | `20260906163500_telegram_username_integrity.sql` | `262efddcf18532891708e2f395a6488c673386e8090d55f1a830562d66ced54a` |
| 6 | `20260909090000` | `20260909090000_next_product_phase.sql` | `d899da5166d57a2512de76681af918e094755d11b4c3ae8f5519f036df448a39` |
| 7 | `20260909200000` | `20260909200000_reminders_and_membership.sql` | `f9754d2ce8b7da0903c506df9bd9453342b920bcfd3621e4490eb66b686f6432` |
| 8 | `20260914090000` | `20260914090000_autostart_tasks.sql` | `68edecd6a625c1fa4c317e50a9f48bf3373361ebea4f31955839be61d2ea604f` |
| 9 | `20261009100000` | `20261009100000_content_os_00_helpers.sql` | `d13a5c81148bc9afa69c814be7cc8c11536755b446d8801fcca4dde67e7ef84c` |
| 10 | `20261009100100` | `20261009100100_content_os_01_content_entities.sql` | `7ab65dce8058e0832af2f173b6defa3da22fc78838d19ae0da1999e65e981140` |
| 11 | `20261009100200` | `20261009100200_content_os_02_task_config.sql` | `e0eededd8301d684458b2e73034302a462a1e6ec079a07ac8b758b021dc732ff` |
| 12 | `20261009100300` | `20261009100300_content_os_03_task_runtime.sql` | `e71bdbf925f319434f41d85a67aecb1ad948299ca09cd0bec2d54ec74bf68317` |
| 13 | `20261009100400` | `20261009100400_content_os_04_idempotency.sql` | `f7740d8a2cdd725270e0e8aef859cdc38aa83175a6fd5750a25ab99e9f50534c` |
| 14 | `20261009100500` | `20261009100500_content_os_05_external_identity_links.sql` | `cbe6ce99142af69695dacce6fccc3284838c1a0786160d7177a77368bc953c8d` |
| 15 | `20261014120000` | `20261014120000_seo_specialist_role.sql` | `d41f798126d02da931017572a793a1a63cfde07d2f9c6d63f666cae4fa859ddd` |
| 16 | `20261014120100` | `20261014120100_harden_service_role_table_privileges.sql` | `a3539a9acfe3a7ac5a228ec30aeecdd78f226c118ad8eb9e85a89b62407272ff` |
| 17 | `20261014123341` | `20261014123341_repair_posting_checklist_creation.sql` | `5fe50745cd22db15416fa4176ddb07d16dc131cf339c2aa47ebc951e76f16e6f` |
| 18 | `20261014130000` | `20261014130000_content_os_06_transition_contract.sql` | `5a08a8fe37ffaeaf7559f614531d19000a80d98754004230c8d72948fce90992` |
| 19 | `20261014130332` | `20261014130332_content_os_task_transition_compatibility.sql` | `882702534f916c29d8816b2bdf76b716b129694181d1d6092bc9f091bba64b77` |
| 20 | `20261015121850` | `20261015121850_content_os_telegram_web_auth.sql` | `b2901041e7f7a0b5fd32ecdfb83107d614d226624eb7e0f5ebb0e5534b14ce6e` |
| 21 | `20261015132700` | `20261015132700_sprint_10b_team_permissions_task_management.sql` | `f925b3c8d35fffb2b759b0474759384b302f16eec0e5fbf492b6889f52529e0a` |
| 22 | `20261015151900` | `20261015151900_sprint_10d_workflow_auth_notification_hardening.sql` | `173af606da0cde3d04f43a0cf279e9560f49f7dc0a25f241cda0406827af0e87` |
| 23 | `20261015164349` | `20261015164349_sprint_10e_final_blocker_closure.sql` | `cf417cd6a505e5e5d375c95b45af36a2fdd702585bc1a08d56bbe67b490f3c62` |

The same checksums are stored in standard `sha256sum -c` format in `docs/SPRINT_10E_FIX_MIGRATIONS.sha256`.

## Expected production ledger

Before release, `supabase_migrations.schema_migrations` must contain exactly the first eight versions above, in order. After the database release, it must contain exactly all 23 versions above, in order. The normal dry-run must therefore show exactly the final 15 versions as pending. Any missing, additional, duplicate, renamed, or reordered version is drift and stops the release.

## Content OS copy identity

Content OS source migrations 00–06 at the frozen Content OS SHA are byte-identical to rows 9–14 and 18 above. The canonical Task Bot names and Content OS source names are identical. The Task Bot manifest guard also pins these seven hashes.

## Release controls

- Run `npm run db:check-manifest` and, from `supabase/migrations`, run `sha256sum -c ../../docs/SPRINT_10E_FIX_MIGRATIONS.sha256` before any database command.
- Use the repository-pinned Supabase CLI `2.116.0`.
- Never use `--include-all`, migration-history repair, or manual ledger edits.
- Follow `docs/SPRINT_9F_PRODUCTION_RUNBOOK.md`; none of its approval boxes are pre-approved by this freeze.
