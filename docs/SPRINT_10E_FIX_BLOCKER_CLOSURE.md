# Sprint 10E-FIX blocker closure

Task Bot is the sole modified repository. Work started at `fd9d7192dcd434f2c2335f8844a8ff3113c4fc68` on `codex/sprint-9b-hardening`. Content OS was inspected read-only at `636f0455f7bf5eca364e7561a5bd03e357f40222`; its worktree was not modified.

## Notification H-1

The pre-fix PostgreSQL 17 reproduction created a real task and null-event legacy assignment delivery, then executed the state mutation made by `notifyAssignmentOnce` after a successful Telegram send. PostgreSQL rejected `status='SENT'` because `sent_at` remained null. The task stayed committed, the delivery stayed `PENDING`, and `claim_task_notification_outbox` then leased that null-event row. This is the exact false-failure/possible business-retry duplication sequence from the audit.

The application now writes one timestamp to both `completed_at` and `sent_at` for a successful inline delivery. Failed inline delivery keeps `sent_at` null. The 10E migration excludes rows unless both `task_event_id` and `event_type` are non-null, narrows the due partial index to the same predicate, and terminalizes only ambiguous legacy rows already `PENDING`/`SENDING` at migration time as `FAILED` with `LEGACY_INLINE_DELIVERY_OUTCOME_UNKNOWN`; it does not send them again.

Exact inline retry behavior is intentionally conservative: the unique `(dedupe_key, recipient_user_id)` claim makes the retry a no-op reported as already handled, so the application does not send a second Telegram message after an ambiguous response. This is semantic business idempotency, not an exactly-once Telegram guarantee. Task-event notifications remain durable and at-least-once: worker loss after Telegram accepts a message can still produce one duplicate when the lease is recovered.

## Final Head Review authority

Stable `BLOG`/`HEAD_REVIEW` codes and immutable runtime/source/entity provenance are the only classifiers. Display titles and generic `tasks.creator_id` never grant review authority.

| Actor relative to source Blog | Assign/reassign reviewer | Request revision | Approve |
| --- | --- | --- | --- |
| Active assigned reviewer, not Blog author | N/A lifecycle assignee | Allowed | Allowed |
| Active Head, not Blog author, not assigned reviewer | May assign another valid active reviewer or self | Allowed as supervisor | Denied |
| Active Head, not Blog author, assigned reviewer | May administratively reassign | Allowed | Allowed |
| Active Head who authored Blog | May assign another valid active reviewer | Denied | Denied |
| Blog author, any other role | Denied review authority | Denied | Denied |
| Unrelated or inactive user | Denied | Denied | Denied |

Reviewer and source Blog author must always differ. Creation is checked when the immutable Head Review runtime link is inserted; later direct or request-based assignment updates are checked by one trigger. Both Blog-author and reviewer changes take the same transaction advisory lock, so concurrent writers cannot validate against stale opposite-side values. Migration installation fails rather than silently rewriting an existing invalid pair.

The event authority guard rolls the complete `transition_task_with_events` transaction back when a broad historical Head branch would otherwise authorize the wrong actor. It preserves the two legitimate coupled transitions: reviewer/non-author-Head revision parks the review `IN_PROGRESS -> BLOCKED`, and source-author resubmission resumes the same review `BLOCKED -> ASSIGNED` without granting that author review authority. Edit, deadline, cancel, archive, and reassignment remain administrative Head operations for Content OS tasks; none implies revision or approval authority.

## Content OS RPC contract

Content OS at the verified SHA calls exactly:

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

It receives `blog_task_id`, `blog_status`, `head_review_task_id`, `head_review_status`, and `head_review_created`. Sprint 10E does not change the signature or return shape. Author/reviewer mismatch succeeds; author-as-reviewer and Head-author-as-reviewer fail atomically; a Head author can choose another reviewer; exact retry and response-loss retry return the same Head Review; generic Blog `DONE` remains denied.

## Database and optional cleanup audit

Migration `20261015164349_sprint_10e_final_blocker_closure.sql` is canonical migration 23. Its SHA-256 is `cf417cd6a505e5e5d375c95b45af36a2fdd702585bc1a08d56bbe67b490f3c62`.

The challenge retention query has three status-specific time predicates plus `created_at` ordering. Existing data is bounded by rate/outstanding controls and cleanup itself is limited. No single small index matches all three OR branches without also changing the query shape; therefore no speculative cleanup index was added. M-3 remains backlog until production-scale evidence justifies the additional write/index cost.

Executable regressions:

- `scripts/test-sprint10e-fix.sql`: H-1 invalid/valid states, exact retry, null-event exclusion, full Head/reviewer/author matrix, Blog completion/resubmission/lost-response convergence.
- `scripts/test-sprint10e-concurrency.sql`: independent sessions race Blog-author and reviewer assignment toward the same user; exactly one commits and the final pair remains independent.
- `scripts/test-sprint10d-hardening.sql`: durable outbox retry, lease recovery, dead-letter, business retry, direct change/request/revision/approval notifications, archive, and atomic Blog workflow regression under the final policy.

The release remains local-only: no push, deploy, live migration, production credential, or production-data action is authorized.
