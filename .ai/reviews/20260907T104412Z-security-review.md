# Claude Security Review (Opus)

Verdict: PASS_WITH_NOTES

## Critical
None.

## High
None.

## Medium
None.

## Low

**L1 — Workflow notifications are delivered to deactivated creators/assignees (`src/application/marketing-service.ts:302-332`).**
`dispatchWorkflowNotification` resolves direct recipients from `this.repository.listUsers()` via `usersById.get(id)` with no `isActive` check, while the Head fan-out one line below is explicitly filtered (`users.filter((user) => user.isActive && user.role === "HEAD_OF_MARKETING")`). `SupabaseMarketingRepository.listUsers()` returns every row with no `is_active` predicate, so a deactivated user who is still `creatorId` or `assigneeId` on a live task keeps receiving `REVIEW_REQUESTED`, `TASK_COMPLETED`, `REVISION_REQUESTED`, `TASK_BLOCKED`, `DEADLINE_CHANGE_APPROVED/REJECTED` DMs — including task titles, deadlines, block reasons and revision comments, plus an actionable Approve/Revision inline keyboard. This is newly introduced by the diff and is inconsistent with the codebase's own norm: `createTask` refuses an inactive assignee and `notifyAssignment` is gated on that check.

Impact is limited to information disclosure to an offboarded teammate about tasks they were already party to; it is not an authorization bypass — the buttons are inert for such a user since `requireActorByTelegramId` rejects `!user.isActive` before any mutation is reachable.

**L2 — Line-3 "deadline hint" is looser than the deadline grammar, producing public bot replies on ordinary group conversation (`src/telegram/task-shorthand.ts:40-47`).**
`looksLikePositionalTask` accepted line 3 on the alternation `\d{1,2}[./-]\d{1,2}` **or** a bare `\d{1,2}:\d{2}`, unanchored, while `parsePositionalTask` requires the strict `DD.MM[.YYYY] HH:mm` form. A normal marketing-group message such as `Yig'ilish\n@ali\nsoat 18:00 da` therefore activated the positional classifier, reached `requireActorByTelegramId`, and then threw, so the bot posted an error into the group (or, for a non-onboarded sender, publicly posted the "not an active team member" message). No task was created and no state was mutated (the throw happens strictly before `createTaskForUsername`), so this was response noise rather than false-positive task creation, but it works against the classifier's stated goal of staying silent on conversation.

## Required fixes before merge
None.

## Optional improvements

- **L1 (applied):** direct recipients are now filtered on `isActive` the same way heads are, dropped with a distinct structured reason (`RECIPIENT_INACTIVE`) so the drop stays observable rather than silent.
- **L2 (applied):** `hasDeadlineHint` is now anchored to the whole line and requires an actual date component before the time (permissive on `.`/`/`/`-` separators so near-miss formats still get a helpful parse error instead of silent conversation-swallowing). This removes the pre-actor-lookup public reply for ordinary conversation and non-members.

## Areas verified clean

- **Sender authorization:** every group task path passes through `requireActorByTelegramId` before `createTaskForUsername`; the ordinary-conversation path returns `{ messages: [] }` before any actor lookup or mutation.
- **Assignee resolution:** `createTaskForUsername` → `findActiveUserByUsername`, and `createTask` re-checks `assignee?.isActive` before persistence; no task or audit event is written for an unknown/inactive assignee.
- **Callback authorization:** `deadline:<id>:APPROVE|REJECT` routes to `resolveDeadlineChangeRequest`, gated by `canApproveDeadlineRequest` (Head or task creator); `task:<id>:REQUEST_REVISION` is covered by the existing `reviewerAction` guard requiring Head or creator. Callback data is length-capped at 64 and both new patterns fit; no client-supplied role or identity is trusted — `from.id` is resolved server-side.
- **Transport parity:** `/api/tasks/[id]/actions` and `/api/deadline-requests/[id]/resolve` call the identical `MarketingService` methods, so notifications and authorization fire on both the Mini App and Telegram paths — no bypass via either transport.
- **Deadline handling:** `requireFutureDeadline` is applied to both labeled and positional parses; the Asia/Tashkent offset arithmetic round-trips through an explicit component re-check that rejects impossible dates; the implicit-year roll-forward cannot yield a past deadline given the subsequent future check.
- **Dedup / missing onboarding:** `TelegramNotificationDispatcher.notifyWorkflow` keys uniqueness on `telegram:<id>` (falling back to `user:<uuid>`), so a Head who is also the creator receives exactly one message; `/^\d+$/.test(telegramUserId)` gates every send, so no chat ID is ever fabricated for a non-onboarded recipient — it records `RECIPIENT_NOT_ONBOARDED` instead.
- **Atomicity:** all dispatches happen strictly after the atomic repository RPC returns, and `dispatchWorkflowNotification` is fully try/catch-wrapped (including the recipient lookup), so a notification failure can never roll back or orphan committed task/audit state.
- **Secret exposure:** no bot token, webhook secret, Supabase key, or Telegram chat ID reaches any log. Structured logs carry only internal UUIDs, task IDs, update IDs, and fixed reason strings; `sendTelegramMessage` sends no `parse_mode`, so interpolated task titles and comments cannot inject Telegram markup.

Both Low findings were fixed and covered by new regression tests before this review was finalized. See `.ai/reviews/20260907-workflow-notification-triage.md` for the full triage history across all three review rounds.
