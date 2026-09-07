# Workflow notification + positional group task review triage

## Round 1 — workflow notification fixes only

- General review: `20260907T090104Z-review.md` — `PASS_WITH_NOTES`
- Opus security review: `20260907T090613Z-security-review.md` — `PASS_WITH_NOTES`
- Critical/High findings: none

| Finding | Triage | Action |
| --- | --- | --- |
| General M1 / Security M2: full user lookup after workflow mutations | Valid low-volume reliability tradeoff | Keep for the five-person MVP. Failures are observable and cannot roll back committed workflow state; targeted Head/recipient lookup can be considered later without adding a queue now. |
| General L1: rejection omits resolution note | Not required by bug contract | The requested rejection message includes only the task. No scope expansion. |
| General L2: requester and assignee IDs are normally identical | Intentional | Preserve the explicit requester/assignee recipient rule and rely on Telegram-ID deduplication. |
| General L3: no unblock notification | Out of scope | `TASK_UNBLOCKED` is not in the supplied minimum matrix. |
| General L4 / Security L2: Head-as-creator dedup is split across layers | Covered | Dispatcher-level Telegram-ID deduplication is tested directly. |
| Security M1: session key reuse | Pre-existing and unrelated | Track separately; do not mix configuration changes into this notification fix. |
| Security L1: dispatcher setup errors logged as delivery failures | Valid | Changed the structured failure reason to `DISPATCH_FAILED`; Telegram send failures remain `DELIVERY_FAILED`. |
| Security L3: generic API error logging | Pre-existing and unrelated | No change. |

## Round 2 — positional group task syntax added on top of round 1

- General review: `20260907T092529Z-review.md` — `PASS_WITH_NOTES`
- Opus security rerun: blocked by reviewer quota at capture time (`20260907T093116Z-security-review.md`)

| Finding | Triage | Action |
| --- | --- | --- |
| General Medium: `looksLikePositionalTask` fired on a date-shaped line 3 alone, without an `@assignee`-shaped line 2, causing an unsolicited error reply to ordinary group conversation | Valid — spec deviation (`PRODUCT.md` requires both assignee **and** deadline lines to have task shape) | Fixed: classifier now requires `hasAssigneeHint && hasDeadlineHint` (`src/telegram/task-shorthand.ts`). Focused tests passed after the fix. |
| General Low: heads not pre-deduplicated against direct recipients before dispatch | Not a functional bug — dispatcher deduplicates by Telegram ID | Deferred; dispatcher-level dedup is tested directly. |
| General Low: missing false-positive regression test | Valid gap | Closed in round 3 (see below). |

## Round 3 — final Opus security review (combined diff, after Codex handoff to Claude)

- Opus security review: `PASS_WITH_NOTES` (2026-09-07, ~15:15 Tashkent, run by Claude Sonnet after Opus quota reset)
- Critical/High findings: none
- Scope verified clean: sender authorization, assignee resolution, callback authorization (deadline approve/reject, request-revision), transport parity between Telegram and Mini App, deadline/Tashkent arithmetic, recipient deduplication and missing-onboarding handling, atomicity of dispatch vs. committed mutation, secret exposure.

| Finding | Triage | Action |
| --- | --- | --- |
| L1: `dispatchWorkflowNotification` sent direct-recipient notifications (creator/assignee) to deactivated users; only the Head fan-out filtered on `isActive` | Valid — inconsistent with the codebase's own norm (`createTask` already refuses an inactive assignee) | Fixed: direct recipients are now dropped with a distinct `RECIPIENT_INACTIVE` structured reason, mirroring the existing Head filter (`src/application/marketing-service.ts`). Not an authorization bypass — inactive users' buttons were already inert via `requireActorByTelegramId`. Covered by a new test (`tests/marketing-service.test.ts`: "excludes a deactivated direct recipient from workflow notifications"). |
| L2: `hasDeadlineHint` matched a bare `HH:mm` fragment anywhere in line 3 (unanchored alternation), so ordinary sentences mentioning a clock time (e.g. "soat 18:00 da") could activate the classifier and produce a public error reply | Valid — same false-positive-noise class as the round-2 Medium finding | Fixed: `hasDeadlineHint` is now anchored to the whole line and requires an actual date component before the time, while still accepting `.`/`/`/`-` separators so near-miss formats (e.g. dash-separated dates) still get a helpful parse error instead of being silently swallowed (`src/telegram/task-shorthand.ts`). Covered by new tests for both the embedded-time and bare-time cases. |

Local gate after round 3 fixes: lint PASS; typecheck PASS; 84/84 tests PASS; build PASS; `npm audit --omit=dev` reports 0 vulnerabilities; `git diff --check` clean; changed-tree secret scan PASS.

The reviewed change is ready for commit/deployment subject to the live-verification requirement (production positional task creation, ordinary-conversation non-trigger, and the deadline-request/review notification workflows).
