# MVP practical audit

Date: 2026-09-07. Scope: the full fast-track MVP as deployed (Telegram group, private bot, Mini App, business logic, date/time handling, reliability, code quality). This is a practical audit for a 5-person marketing team's daily use, not a penetration test — see `.ai/reviews/` for the independent security reviews (General + Opus, both `PASS_WITH_NOTES`, no Critical/High).

Severity: **P0** breaks core use · **P1** important, fix now · **P2** useful improvement · **P3** optional polish.

## Update — 2026-09-09: accept notifications + role editing

Scope of this pass: (1) notify the task creator when a task is accepted, from either transport, (2) let a mis-set role be corrected later, (3) a light audit while doing both.

| # | Finding | Severity | Fixed |
| - | - | - | - |
| H1 | **Accepting a task never notified the creator.** `performTaskAction`'s `ACCEPT` branch only transitioned the task; unlike `SUBMIT_REVIEW`/`APPROVE`/`REQUEST_REVISION`/`BLOCK`, it dispatched no `WorkflowNotification`. Since Telegram's callback handler and the Mini App's actions route both call this one method, the gap was identical on both transports. | P1 | **Fixed** — added a `TASK_ACCEPTED` workflow event dispatched to the creator from inside `MarketingService.performTaskAction`, so both transports notify identically with no duplicated logic. Skips the send when the creator accepted their own self-assigned task (no one else to tell). |
| H2 | **No way to correct a wrong role after onboarding.** `activateUser` only fires once, while a user is still pending; once active, nothing in the API or UI could change a role picked incorrectly at onboarding. | P1 | **Fixed** — added `MarketingService.updateUserRole` (Head may correct anyone's non-Head role; a member may correct their own) plus `POST /api/users/[id]/role`, and a Mini App "Edit role" affordance on the Team tab (per teammate, Head-only) and on a new tap-to-open profile sheet (self-service). The Head role itself is intentionally never settable through this path in either direction — matches the existing restriction already in place for activation. |
| H3 | **Telegram-handler tests were pinned to hardcoded calendar dates** (`08.09.2026`) checked against the real wall clock, so the suite would start failing on its own the day after those dates passed — which is exactly what happened here (today is 2026-09-09). This is a genuine reliability gap in the test suite, not the product: the parser itself is correct to check against real "now". | P1 | **Fixed** — pinned the clock with `vi.useFakeTimers()`/`setSystemTime` for that suite so it no longer depends on when it happens to run. |
| H4 | Duplicate/near-simultaneous `ACCEPT` requests: the common case (a real double-tap, one request completing before the next starts) is already handled correctly — the second call's fresh `getTask` sees `IN_PROGRESS` and `canTransition` rejects it with `CONFLICT` before any notification code runs (covered by a new regression test). A theoretical sub-millisecond true DB race (two requests reading the row before either commits) would rely on `transition_task_with_events`'s existing idempotent no-op path, which does not by itself signal "no real change" back to the application layer. | P2 | Not fixed — noted for awareness. Given how unlikely a true concurrent double-accept is for a 5-person team (vs. the realistic double-tap case, which is solid), fixing it fully would need the transition RPC to return an explicit "did this call actually change the row" flag; deferred as disproportionate to the risk for this MVP. |

Regression tests added: `tests/marketing-service.test.ts` ("accept notifies the creator", "role can be corrected later" — Head editing another member, self-edit, non-Head blocked from editing others, Head-role never settable, unknown user, duplicate accept, self-assigned accept, notification-failure-preserves-state), `tests/telegram-notification-dispatcher.test.ts` (exact `TASK_ACCEPTED` message body), `tests/task-actions-route.test.ts` and `tests/user-role-route.test.ts` (transport-level wiring and invalid-input handling for the two new/changed endpoints).

Part 3 (visual redesign) was already substantially implemented in the 2026-09-07 pass below — brand colors, typography, Home/Team tabs, and component system all matched the target spec on inspection. This pass added the Team-tab and profile-sheet role-editing UI on top of that system without introducing new colors or patterns.

## Update — 2026-09-09: next product phase (summaries, `#posting`, recurring tasks, analytics)

Scope: daily/weekly Telegram summaries, a persistent `#posting` checklist gate, Mini-App-managed recurring tasks, and a Reports/analytics tab — implemented on `fast-track/mvp` without touching the Telegram positional task format. This was found already substantially written and uncommitted in the working tree at the start of this pass; the work below is an independent read-through, gap-filling, and verification of that code before commit/deploy, not a from-scratch build.

| # | Finding | Severity | Fixed |
| - | - | - | - |
| J1 | Scheduled-job authorization uses `timingSafeEqual` on the `Authorization: Bearer $CRON_SECRET` header, matching Vercel Cron's own header injection; a wrong/missing secret returns 401, and a missing `CRON_SECRET` env var returns 503 rather than crashing unrelated requests (the config is read lazily, only inside the cron route). Verified by reading `src/server/auth/cron.ts` and `src/server/config.ts`. | — | N/A (verified correct) |
| J2 | Recurring-task and report-delivery idempotency both use a real database uniqueness constraint plus a row lock, not an application-level check-then-act: `generate_recurring_task` re-validates `next_occurrence_at` under `for update` before creating a task, and `create_task_with_event_v2`'s `ON CONFLICT DO NOTHING` on `(recurring_definition_id, scheduled_occurrence_at)` is a second, independent guard; `report_deliveries` has a `unique (report_type, interval_key, recipient_user_id)` constraint that `claimReportDelivery` relies on (insert fails with `23505` → treated as already-sent). Verified this survives a genuine concurrent double cron-invocation, not just a sequential retry (traced the lock/CTE logic by hand). | — | N/A (verified correct) |
| J3 | **Recurring-task assignment notifications had no observability.** `generateDueRecurringTasks` only logged on a thrown exception from `notifyAssignment`, but that method returns a `{status: "FAILED"}` object instead of throwing for the common case (assignee never `/start`'d) — so a silently-undelivered recurring-task notification left no trace in logs. | P2 | **Fixed** — now logs `recurring_assignment_notification_sent`/`_failed` from the returned status (matching the pattern already used by `createTask`), plus a `recurring_assignment_notification_skipped` log when the assignee is inactive/missing. |
| J4 | **Never-onboarded active users were silently excluded from every scheduled report** with no record of how many, unlike the assignment-notification path which logs `ASSIGNEE_NOT_ONBOARDED`. Not a correctness bug (no crash, no fabricated chat ID, matches "do not fail the whole job"), but it made "how many teammates aren't receiving reports" unobservable. | P2 | **Fixed** — `ReportingService.deliver` now logs `scheduled_report_recipient_not_onboarded` with a count when any active user lacks a valid Telegram ID. |
| J5 | `PATCH /api/tasks/[id]/recurrence`'s `[id]` segment means the recurring-*definition* id, while the same route's `POST` treats `[id]` as the *task* id — functionally correct today because the one caller (`MiniApp.tsx`) sends the right id for each verb, but it is a confusing, easy-to-misuse API shape. | P3 | Not fixed — a route rename/split (e.g. a dedicated `/api/recurring-definitions/[id]`) is the clean fix but is pure churn on working, tested code for a naming issue only the two current call sites touch; left as a documented note rather than risking a regression for cosmetic gain. |
| J6 | Test coverage gaps found and closed: no test exercised a full checklist allowing `SUBMIT_REVIEW`, no test simulated a duplicated recurring-scheduler run at the service layer, `updateRecurrence`'s permission boundary (non-owner blocked) and pause/stop/resume-after-stop behavior were untested, `getAnalytics`'s employee-vs-Head visibility split was untested, and `weeklyMetrics` carry-over plus `averageBlockedHours`/`averageReviewHours` had no dedicated assertions. | P2 | **Fixed** — added to `tests/marketing-service.test.ts` and `tests/reporting.test.ts` (see Tests below). |
| J7 | Telegram's `#posting` checklist UX correctly *shows* the checklist instead of just erroring when `SUBMIT_REVIEW`/`/review` is attempted while incomplete (both the callback-button and `/review` command paths call `getTaskDetails` first and render `postingChecklistMessage` in place of the normal action), matching the spec's "do not force the user to type platform names manually." Verified by reading `src/telegram/handler.ts`. | — | N/A (verified correct) |
| J8 | The DB enforces the checklist-before-REVIEW gate independently inside `transition_task_with_events` (raises `23514` if any item is incomplete) in addition to the app-layer pre-check in `performTaskAction` — so the invariant holds even if a future caller bypasses the service layer. | — | N/A (verified correct, defense in depth) |

Not independently re-verified against a live Postgres in this pass (no local Supabase instance was started): the `#posting` tag-detection trigger logic and checklist auto-attach inside `create_task_with_event_v2`/`private.attach_posting_checklist`, and the backfill `do $$ ... $$` block for pre-existing tagged tasks. These are covered by `tests/migration-contract.test.ts` (text-pattern assertions that the right functions/constraints exist) and by the deterministic-but-independently-unit-tested `containsPostingTag` regex in `src/domain/recurrence.ts`, which mirrors the SQL regex; full confidence requires the real production verification steps listed in the final report.

## Summary

No P0 findings. Four P1 findings, all fixed in this pass (three in application code, one addressed structurally by the Mini App redesign in Part 3). Several P2 findings fixed opportunistically; the rest are listed for later. Backend business logic (permissions, workflow transitions, notification recipients, idempotency, deadline/Tashkent arithmetic) was already covered by two independent review rounds this session (`.ai/reviews/20260907T092529Z-review.md`, `.ai/reviews/20260907T104412Z-security-review.md`) and is not re-litigated here except where this audit found something new.

## A. Telegram group

| # | Finding | Severity | Fixed |
| - | - | - | - |
| A1 | Positional format, labeled `T:/A:/DL:` compatibility, ordinary-conversation false-positive avoidance, unknown-user handling, malformed-deadline handling, and duplicate-creation prevention (unique `source_telegram_update_id` constraint with `ON CONFLICT DO NOTHING`) were all verified correct by reading and by the live production test in this session (see `.ai/PROJECT_STATE.md`). | — | N/A (verified, no defect) |
| A2 | Success/error messages (`taskFormatError`, `group_task_created` confirmation) are useful and give the exact expected format on failure. | — | N/A (verified) |
| A3 | Creator identification and assignment notification are handled by the shared, tested `createTaskForUsername` → `notifyAssignment` path for both positional and labeled input. | — | N/A (verified) |

No new findings in this area beyond the two already fixed earlier this session (assignee/deadline-shape false positive, inactive-recipient/regex-noise Lows — see the review triage doc).

## B. Private bot

| # | Finding | Severity | Fixed |
| - | - | - | - |
| B1 | `/start` onboarding, Accept, Block, deadline requests, review/approve/revision, and callback authorization all route through the same `MarketingService` methods used by the Mini App, so there is one authorization surface. Verified by reading `src/telegram/handler.ts` end to end. | — | N/A (verified) |
| B2 | Repeated/stale button presses (e.g., double-tapping Approve) are safe: `transition_task_with_events` takes a row lock (`for update`) and short-circuits to a no-op if the task is already in the requested status, so a duplicate callback cannot double-transition or double-log an audit event. Deadline resolution is guarded by an explicit `CONFLICT` check on an already-resolved request ("first resolution wins"). | — | N/A (verified) |

No P0/P1 findings in this area.

## C. Mini App

| # | Finding | Severity | Fixed |
| - | - | - | - |
| C1 | **Default task priority renders with no color styling.** `TaskCard`/`TaskDetailPanel` apply class `p-${task.priority}`, and `normal` is the schema default, but `mini-app.css` only defined `.p-low`, `.p-medium`, `.p-high`, `.p-urgent` — `.p-medium`/`.p-urgent` are unreachable dead code (the `Priority` type only allows `low`/`normal`/`high`) and `.p-normal` never existed. Every normal-priority task (the majority of tasks) showed an unstyled priority pill. | P1 | **Fixed** — new design system defines `.p-low`/`.p-normal`/`.p-high`; dead `.p-medium`/`.p-urgent` rules removed. |
| C2 | **No Home/dashboard view.** The Mini App opens straight into a flat task list with no at-a-glance summary (today/overdue/blocked/review counts) and no team-workload view for the Head, despite `docs/PRODUCT.md`'s Mini App scope including a useful landing view. | P1 | **Fixed** — new Home tab added in Part 3 (stat tiles, team workload for Head, priority/recent tasks), computed client-side from already-available `/api/tasks` scopes, no new endpoints. |
| C3 | Two named backend scopes (`review`, and status `BLOCKED`) were never reachable from the Mini App UI — only `my`/`today`/`overdue`/`team` had chips, so a Head could not filter directly to "needs my review" or "blocked" without scanning the full list. | P2 | **Fixed** — added a compact "More filters" control exposing Review and Blocked, and Home's stat tiles jump straight into a filtered Tasks view. |
| C4 | Mutating a task from the detail panel or creating one from Quick Add only refreshed the currently active Tasks-tab list (`onRefresh` → `loadTasks(filter)`); the new Home tab's counts would go stale until a full remount. | P2 | **Fixed** — `onRefresh`/`onCreated` now refresh both the active task list and the Home dataset. |
| C5 | Loading/empty/error states existed but were minimal (a bare "No tasks here." for every filter) and error text was passed through verbatim from the API, which is fine for validation messages (they're already written for humans) but not for a raw network failure string. | P2 | **Fixed** — per-filter empty copy (including the requested Uzbek "Bugun task yo'q" / "Overdue tasklar yo'q" strings for Today/Overdue), and a `friendlyError()` wrapper that only rewrites recognizably technical failures (network errors, generic 5xx) rather than the existing human-authored validation messages. |
| C6 | Kanban already scrolls horizontally on mobile rather than trying to cram all seven columns on screen — this satisfies the "don't show all columns at once" requirement, so it was kept and polished (scroll-snap, sticky column headers) rather than rebuilt as tabs, to avoid unnecessary churn on working, tested interaction code. | — | Verified / polished |
| C7 | Visual design used a warm cream/serif "editorial" theme (`--accent: #de704e`, Georgia headings) left over from the Sprint 0 landing page, not the requested blue SaaS system; ~150 lines of that landing page's CSS (`.hero-card`, `.foundation-grid`, etc.) are dead — `src/app/page.tsx` has rendered `<MiniApp />` since the fast-track merge and never used them. | P2 | **Fixed** — new design system (Part 3) and dead CSS removed. |
| B/C8 | `viewport.themeColor` in `layout.tsx` was `#18251f` (the old dark ink), which no longer matches the light UI chrome and would show as a mismatched Telegram title-bar color. | P3 | **Fixed** — updated to the new paper background. |

## D. Business logic

Verified directly against `src/domain/workflow.ts`, `src/domain/permissions.ts`, `src/domain/task.ts`, and `src/application/marketing-service.ts`:

- One task = one assignee: `assigneeId` is a single required UUID field; no multi-assignee path exists.
- Creator/Head rights: `canApproveDeadlineRequest`, `canReviewTask`, `canChangeDeadline`, `canReassignTask` are all `isHead || isCreator`; enforced in `performTaskAction` and `resolveDeadlineChangeRequest`.
- Assignee cannot directly change the deadline: there is no `TaskAction` for it; the only path is `createDeadlineChangeRequest` (assignee-only) → `resolveDeadlineChangeRequest` (creator/Head-only).
- Review/revision lifecycle (`REVIEW → DONE/REVISION`, `REVISION → IN_PROGRESS/BLOCKED/REVIEW`) matches `TRANSITIONS` exactly.
- Blocked reason is required by `TaskActionInputSchema`'s `superRefine` and persisted as an audit event.
- DONE/CANCELLED are terminal except `REOPEN`, which is Head-only and explicitly checked (`performTaskAction` line ~201).
- `OVERDUE` remains derived (`isOverdue()` computed from `deadline`/`status`, never stored).
- Audit history is appended atomically with each state change inside `transition_task_with_events` (single Postgres function, row-locked).
- Notification recipients match the documented matrix (creator+Head for review/deadline-request/blocked, assignee for approve/revision/deadline-decision) and are deduplicated by Telegram user ID at the dispatcher layer (verified by test and by this session's Opus review).

No P0/P1 findings. No new defects found beyond C1 above (which is presentation-layer, not business-logic).

## E. Date/time

- Telegram deadline parsing (`parseTashkentDeadline`) and the Mini App's `localDatetimeToISO`/`fmtDate`/`fmtDateTime`/`isToday` helpers all anchor to `Asia/Tashkent` (`+05:00`, no DST in this zone, so the fixed offset is correct and won't drift).
- `isToday`/`getTZDateParts` compute "today" using `Intl.DateTimeFormat` with an explicit `timeZone`, so it is correct regardless of the viewer's browser/OS timezone — verified by reading; this avoids the common bug of using the browser's local timezone for a team that is not all in one place.
- `Overdue` is computed the same way (`deadline < now`) on both the server (`isOverdue` in `src/domain/task.ts`) and the client (`isOverdue` in `MiniApp.tsx`), so a task cannot appear overdue in one surface and not the other except for clock skew between the viewer's device and the server, which is an inherent (and here inconsequential) limitation of any client-side "is it overdue" display — the server is always the source of truth for the `OVERDUE` badge computation.

No findings.

## F. Reliability

- Double-click / duplicate submission: Quick Add and all task-detail actions synchronously set a `pending`/`actionPending` flag before the `await`, and the trigger button is `disabled` while pending — verified no double-submit window.
- Repeated Telegram callback execution: see B2 above — DB-level idempotent no-op, not merely a client-side guard.
- API errors are not swallowed: every `apiFetch` call surfaces its `error` to the caller, which either sets a visible error state or (Quick Add / task actions) blocks the "success" path entirely — the UI never claims success when the backend request failed. Notification delivery failure is explicitly surfaced as a distinct warning state (`"Task created, but the private notification was not delivered…"`), never hidden.
- Race conditions realistic for a 5-person team (two people acting on the same task near-simultaneously) are handled by the row-locked transition function, not by client-side assumptions.
- Missing-onboarding notification recipients never receive a fabricated chat ID (verified in the Opus review).

No P0/P1 findings.

## G. Code quality

| # | Finding | Severity | Fixed |
| - | - | - | - |
| G1 | ~150 lines of dead CSS in `globals.css` from the pre-merge landing page (`.hero-card`, `.foundation-grid`, `.metric`, `.section-preview`, `.footnote`, serif `h1`/`h2`), unreachable since `page.tsx` renders `<MiniApp />`. | P2 | **Fixed** — removed. |
| G2 | Dead/unreachable priority CSS classes (`.p-medium`, `.p-urgent`) that don't correspond to any value the `Priority` type can hold. | P2 | **Fixed** — removed (see C1). |
| G3 | The Mini App is a single 1070-line component file. It is not unmanageable today (clear section comments, one concern per function), and splitting it purely for line count would be churn without a concrete maintainability problem. Left as-is; flagged for a future pass only if it keeps growing. | P3 | Not fixed (deliberately deferred) |

Transport-specific logic does not leak into the domain layer anywhere inspected (`src/domain/*` has no Telegram/HTTP imports); this was already true before this audit.

## Part 3 — Mini App redesign

Implemented after the above fixes; see the design system section of `.ai/PROJECT_STATE.md` and the diff for specifics (new Home tab, Team workload tab, bottom navigation, blue SaaS visual system, Inter typography, refreshed status/priority colors, polished Kanban scrolling, friendlier empty/error states).
