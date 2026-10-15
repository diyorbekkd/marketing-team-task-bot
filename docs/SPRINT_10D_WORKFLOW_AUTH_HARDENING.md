# Sprint 10D workflow and authentication hardening

Task Bot remains the authoritative migration, workflow, authorization, Telegram identity, and notification owner. Content OS was verified clean/read-only at starting SHA `dd7777dc55828609ee00f909fc590f73b604dfcd` and was not modified by Codex. It externally advanced during this sprint and was finally observed clean at `65195de41f9d0ca2859b180398bb5179324242ba`; that separate repository work is not part of this Task Bot change set.

## Reproduced findings before the fix

The exact pre-10D schema was applied to PostgreSQL 17 before the new migration. With Blog author A and Head Review assignee B, the database allowed all three HIGH-1 steps:

```text
PRE_FIX HIGH_1 step1 direct reassign Head Review to author = ALLOWED
PRE_FIX HIGH_1 step2 author moves Head Review to REVIEW = ALLOWED
PRE_FIX HIGH_1 step3 author approves own Head Review = ALLOWED
PRE_FIX BLOG_BYPASS generic Blog IN_PROGRESS -> DONE with zero Head Reviews = ALLOWED
```

These are now adversarial regressions in `scripts/test-sprint10d-hardening.sql`.

## Manual versus Content OS authorization

The rule is exact: generic creator privileges apply only when the task has no row in `public.content_task_runtime`. Any runtime row marks the task as Content OS-owned, so `public.tasks.creator_id` does not grant generic edit, direct reassignment, direct deadline change, cancellation, review, or recurrence-management rights.

The application predicates and row-locked database RPCs both enforce this boundary. Manual Task Bot behavior remains unchanged: an active manual-task creator retains the Sprint 10B direct-management rights. For Content OS tasks, active Head retains Head authority, the current assignee retains allowed assignee lifecycle/request actions, and workflow-specific stable Task Type/provenance rules decide review authority. Request resolution remains active-Head-only.

For `HEAD_REVIEW`, only its active assigned reviewer or active Head may move or decide its lifecycle. A non-Head source Blog author cannot be selected as the review assignee and remains denied even if a historical/bad writer already assigned the review to them. Blog authors, matching `creator_id` users, unrelated users, inactive reviewers, and inactive Heads cannot edit, reassign, directly change the deadline, cancel, take over, or approve the review through generic creator behavior. The existing provenance-checked Blog `DONE -> REVISION` transition remains coupled to the same Head Review.

## Atomic Blog completion contract

Generic `transition_task_with_events(..., 'DONE', ...)` rejects every Content OS `BLOG`. The only completion path is:

```sql
public.content_os_complete_blog_with_head_review(
  p_blog_task_id uuid,
  p_actor_id uuid,
  p_reviewer_id uuid,
  p_review_deadline timestamptz,
  p_review_title text,
  p_review_request_hash text
)
```

The RPC locks the source Blog and, in one transaction:

1. authenticates the active Blog assignee and stable `BLOG` type;
2. creates or reuses the deterministic idempotency key `head-review:<blog-task-uuid>`;
3. creates exactly one `HEAD_REVIEW` runtime row linked by immutable `source_task_id` plus the existing stable entity links;
4. marks the Blog `DONE` and appends its completion events; or, for a revision resubmission, marks the Blog `DONE` and resumes the same blocked review;
5. returns `{ blog_task_id, blog_status, head_review_task_id, head_review_status, head_review_created }`.

A source-row lock plus the `content_task_runtime_single_head_review` trigger serializes all writers and rejects a second Head Review, including legacy runtime writers. A response-loss retry returns the same review without another Blog, review, or completion event. Display titles and user names never determine provenance.

### Exact Content OS change Claude must consume

Replace the old two-step Blog completion (`transition_task_with_events` followed by review creation/ensure) with one call to `content_os_complete_blog_with_head_review`. Continue supplying the current canonical SHA-256 request hash for `{ kind: "HEAD_REVIEW", blogTaskId, blogId }` as `p_review_request_hash`; the database owns the stable idempotency key. Do not call the generic Blog `DONE` transition or a second ensure/create-review operation.

Revision/resubmit must call the same dedicated RPC. The returned `head_review_task_id` is the one authoritative review to display/resume.

## Telegram login display code and abuse bounds

`content_os_auth_create_challenge` changes from one input to:

```sql
content_os_auth_create_challenge(
  p_verifier_hash text,
  p_rate_key_hash text
)
returns { challenge_id, status, expires_at, display_code }
```

`content_os_auth_get_challenge_status(uuid)` now returns `{ status, expires_at, display_code }` and still returns no user identity. The six-digit server-generated `display_code` is human confirmation only. The browser shows it, and Telegram says exactly:

```text
Brauzerdagi kod bilan bir xil bo‘lsa tasdiqlang: XXXXXX
```

The deep link still carries only the challenge UUID. The verifier proof remains the browser-binding secret, redemption remains one-time and row-locked, and approval still requires the authenticated Telegram callback sender. The display code cannot approve or redeem a challenge.

Content OS must compute `p_rate_key_hash` server-side as a lowercase 64-hex HMAC/SHA-256 value over a trusted Cloudflare-derived client key (for example trusted `CF-Connecting-IP`) plus a server-only pepper. It must never accept a browser-supplied rate key as authority and must never expose the pepper.

The V1 database bounds are five creations per rate key in any rolling 15-minute window and at most three unexpired `PENDING`/`APPROVED` challenges per rate key. Rate checks are serialized with a transaction advisory lock. Challenge creation opportunistically deletes up to 100 retained rows. `content_os_auth_cleanup_challenges(p_limit)` additionally supports a service-role cleanup job (1–5000 rows per call): expired pending/approved rows are retained for 24 hours, while consumed/cancelled rows are retained for seven days. The function never deletes sessions.

## Durable Telegram workflow notification outbox

The existing `task_notification_deliveries` ledger is now a durable outbox for meaningful workflow events. The task-event insert trigger writes recipient intent inside the same business transaction. The semantic key is the immutable `(task_event_id, recipient_user_id)` pair; an exact business retry cannot create another row, while a later legitimate event has a new event ID and can notify normally.

`claim_task_notification_outbox(worker_id, limit)` uses `FOR UPDATE SKIP LOCKED`, changes due rows to `SENDING`, increments attempts, and grants a two-minute lease. `complete_task_notification_outbox(...)` records `SENT`, returns a transient failure to `PENDING` with 1/5/15/60-minute backoff, or records terminal `FAILED` on attempt five. The protected `/api/cron/notifications` worker runs every five minutes and uses the existing `NotificationDispatcher`/Telegram sender; it does not introduce a second delivery stack. Errors stored in the row are bounded to 500 characters, and structured logs contain IDs/statuses rather than secrets.

The guarantee is durable at-least-once processing with semantic deduplication before send. A worker crash after the business commit leaves a pending row. A transient Telegram failure is retried. A crash or response loss after Telegram accepted a message but before local `SENT` is recorded can still produce one duplicate after lease expiry because Telegram provides no application idempotency key; the same outbox row is reused and no external exactly-once promise is made. Pre-10D ledger rows have no task-event reference and therefore cannot be reconstructed safely; existing `SENT` rows remain sent, while legacy `CLAIMED`/`FAILED` rows are retained as terminal `FAILED` audit records and are never leased by the new worker.

## Archive and request behavior

`archive_task_with_event` locks the task, then cancels every pending deadline/reassign request in the same transaction and writes a cancellation event with `reason = TASK_ARCHIVED` before writing `TASK_ARCHIVED`. Restoring the task deletes only the archive marker; cancelled requests never become pending again and cannot later be approved.

The task-first lock order is shared by request creation, resolution, direct mutation, and archive. Concurrent archive/approve, archive/reject, and archive/new-request attempts therefore produce one coherent winner and one matching event/notification outcome.

Head cannot archive a `BLOG` while a provenance-linked Head Review is active, or archive the active `HEAD_REVIEW` while its source Blog cycle is active, including revision. Once the review is terminal, normal Head archive behavior applies. Completion checks reject an archived review or archived source Blog, so an archived Blog cannot be approved indirectly. Manual task archive/restore behavior remains unchanged.

## Migration and verification

Sprint 10D adds canonical migration 22:

```text
20261015151900_sprint_10d_workflow_auth_notification_hardening.sql
sha256 173af606da0cde3d04f43a0cf279e9560f49f7dc0a25f241cda0406827af0e87
```

The complete frozen 22-file checksum inventory is `docs/SPRINT_10D_MIGRATIONS.sha256`. The local pinned Supabase CLI 2.116.0 rehearsal established the exact eight-row audited baseline, reported exactly 14 pending migrations, applied them normally, verified all 22 local/remote versions, and ended with an empty dry-run. A separate migration-21-to-22 fixture verified legacy notification ledger conversion and that no legacy row is claimable. No `--include-all`, migration-history repair, or manual ledger edit was used.

Verification artifacts:

- `scripts/test-sprint10d-hardening.sql`: PostgreSQL 17 exploit, authorization, Blog/review, archive, login, cleanup, outbox retry/dead-letter, and catalog contract.
- `scripts/test-sprint10d-concurrency.sql`: real independent-session archive/request, concurrent Blog completion, and outbox lease races.
- `scripts/test-content-os-auth.sql` and `scripts/test-content-os-auth-concurrency.mjs`: full Sprint 10A lifecycle and true-concurrency regressions with display code/rate inputs.
- `scripts/test-team-permissions.sql` and `scripts/test-team-permissions-concurrency.sql`: unchanged manual Sprint 10B authorization and race regressions.

Final local gates: 316/316 Vitest tests across 37 files, lint, typecheck, production build, manifest/hash guard, `git diff --check`, clean PostgreSQL 17 22-migration apply, all SQL/auth/concurrency regressions, and Supabase security/performance advisors pass. The optional CLI schema linter could not start on the vanilla PostgreSQL 17 image because `plpgsql_check` is not installed; migration compilation and the executable SQL suites provide the function validation in this environment.

No production credential, production data, deployment, push, or live migration is part of Sprint 10D. Production release remains on hold pending a separately approved production run.
