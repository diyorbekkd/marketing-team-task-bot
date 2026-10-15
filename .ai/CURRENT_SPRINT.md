# Current sprint

## Sprint 9F — Release candidate freeze

- Branch: `codex/sprint-9b-hardening`
- Frozen Task Bot application/database SHA: `3a3becab5cd21cf2a6a2947e3e4de861ea6b0f4c`
- Frozen Content OS SHA: `ceb5f52184f1886948ebb8a7f6b4196b6de6f42a`
- Scope: release-control documentation only; no application or database behavior changes.
- Prohibited: push, deploy, live migration, production credentials, or setting `CONTENT_OS_IDENTITY_TRUST`.

## Status

```text
DB_RELEASE = GO
APPLICATION_RELEASE = BLOCKED_ON_PLATFORM_AUTH
PRODUCTION_RELEASE = HOLD
CONTENT_OS_IDENTITY_TRUST = UNSET
```

- Both repositories were clean at their frozen full SHAs.
- The canonical 19-migration Task Bot manifest is frozen with a SHA-256 checksum for every file.
- Content OS migrations 00–06 remain byte-identical to the canonical Task Bot copies.
- Expected production ledger is exactly eight rows before the database release and exactly 19 afterward.
- The production runbook requires normal pinned-CLI `db push`, the exact 11-file dry-run, final ledger/catalog/privilege verification, and forbids `--include-all`, repair, or manual ledger editing.
- Application release remains blocked until the OpenAI Sites platform owner provides the written identity-header and sole-ingress guarantee for the frozen Site.
- All release and execution approval boxes remain unchecked. This sprint does not mark the candidate production-ready.

## Release artifacts

- `docs/SPRINT_9F_RELEASE_MANIFEST.md`
- `docs/SPRINT_9F_MIGRATIONS.sha256`
- `docs/SPRINT_9F_PRODUCTION_RUNBOOK.md`

Documentation commits after the frozen Task Bot SHA are release-control artifacts only; application and database artifacts must still be built from the frozen SHA.
