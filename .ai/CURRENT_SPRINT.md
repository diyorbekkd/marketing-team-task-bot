# Current sprint

## Sprint 10E-FIX — Task Bot final blocker closure

- Task Bot branch: `codex/sprint-9b-hardening`
- Task Bot starting SHA: `fd9d7192dcd434f2c2335f8844a8ff3113c4fc68`
- Content OS verified read-only SHA: `636f0455f7bf5eca364e7561a5bd03e357f40222`
- Ownership: Task Bot only. Content OS was not modified.
- Prohibited: push, deploy, live migration, production credentials, or production-data mutation.

## Implemented scope

- Added canonical migration 23: `20261015164349_sprint_10e_final_blocker_closure.sql`.
- Closed notification H-1: successful inline assignment completion records `sent_at`; null-event inline rows cannot be leased by the task-event outbox; pre-existing ambiguous inline rows are terminalized without resending.
- Enforced reviewer/source-author independence during Head Review creation, direct/request reassignment, and concurrent assignment changes, including Head-authored Blogs.
- Approval is active-assigned-reviewer-only. Active non-author Head retains revision supervision; Head author cannot self-assign, revise, or approve, but may assign another valid reviewer.
- Added a provenance adapter RPC so Telegram/Mini App revision actions on a Head Review execute the established coupled source-Blog transition. Mini App action visibility mirrors the final matrix; server/database authority remains decisive.
- Preserved Content OS's exact `content_os_complete_blog_with_head_review(uuid,uuid,uuid,timestamptz,text,text)` signature and return shape.
- Audited challenge cleanup. No speculative index was added because its three status-specific timestamp branches do not have one small matching index; M-3 remains backlog pending production-scale evidence.

## Gates

```text
NOTIFICATION_H1 = CLOSED
HEAD_REVIEW_POLICY = GO
BLOG_COMPLETION_CONTRACT = GO
TASK_BOT_10E_FIX = GO
PRODUCTION_RELEASE = HOLD
```

## Verification artifacts

- `docs/SPRINT_10E_FIX_BLOCKER_CLOSURE.md`
- `docs/SPRINT_10E_FIX_MIGRATIONS.sha256`
- `scripts/test-sprint10e-fix.sql`
- `scripts/test-sprint10e-concurrency.sql`
- `scripts/test-sprint10d-hardening.sql`
- `scripts/test-sprint10d-concurrency.sql`
- `scripts/test-content-os-auth.sql`
- `scripts/test-content-os-auth-concurrency.mjs`
- `scripts/test-team-permissions.sql`
- `scripts/test-team-permissions-concurrency.sql`

Final local gate: 319/319 tests across 38 files; lint, typecheck, production build, 23-file manifest/hash guard, and `git diff --check` pass. PostgreSQL 17 passes clean apply plus Sprint 10E, Sprint 10D, Sprint 10A auth, Sprint 10B permissions, outbox, and independent-session concurrency regressions. Pinned Supabase CLI 2.116.0 established an exact eight-row baseline, reported exactly 15 pending, applied normally to 23, verified ledger parity, and ended with an empty dry run. No `--include-all`, history repair, or manual ledger edit was used.

The production database remains at its prior eight-row ledger. Nothing in Sprint 10E-FIX has been pushed, deployed, applied live, or run with production credentials/data.
