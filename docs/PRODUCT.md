# Product specification

## Purpose

Marketing Team Task Bot is a deterministic task-management system for one five-person marketing team. Its operational goal is to let the Head of Marketing answer:

1. Who is currently working on what?
2. What must be completed today?
3. What is overdue and why?
4. Who has too much workload and who has capacity?
5. Which marketing workflow stage repeatedly becomes a bottleneck?

The production application does not use AI. Metrics and reports are calculated from current records and immutable history.

## Team and identities

The team roles are:

- Operator / Video Editor
- Content Marketer
- Digital Marketer
- SMM Manager
- Head of Marketing

The Head of Marketing is the `SUPER_ADMIN`, while remaining a normal participant who can create and receive tasks. Every task has exactly one creator and one assignee. Any active team member may create a task for any active team member.

Telegram onboarding will associate an internal user with a signed 64-bit `telegram_user_id`, an optional username, and a display name. Usernames are conveniences, not permanent identity keys.

### Team membership

A user is either **pending** (never activated — `is_active = false`, no `deactivated_at`), **active** (`is_active = true`), or **deactivated** (a former active member — `is_active = false`, `deactivated_at` set). Pending and deactivated are deliberately distinct states: a pending user is onboarded through the existing Activate-with-role flow; a deactivated user is restored through Reactivate, which keeps their prior role rather than asking Head to choose one again.

Only Head may activate, deactivate, or reactivate a team member, and Head can never deactivate themself or any other Head account — the only path to removing a Head from the team is a direct database operation outside this product, which matches the existing constraint that at most one user may hold the `HEAD_OF_MARKETING` role and be active at a time.

An active user can use the bot and Mini App, be assigned new tasks, and appears in assignee pickers, current team lists, and workload/analytics. A deactivated user cannot perform bot actions or authenticated Mini App requests (their session and every future Telegram command are rejected before reaching any business logic), cannot be assigned new tasks by any creation path (group shorthand, private bot, Mini App Quick Add, or recurring task configuration/generation), does not receive workflow notifications, deadline reminders, or scheduled reports, and is excluded from current team/workload views. Their historical tasks, audit events, and past report/analytics activity are never rewritten or hidden — only their current membership state changes.

Deactivating a member with open (non-terminal) tasks requires Head to explicitly choose what happens to those tasks: reassign them all to a named active teammate (this also sends that teammate the normal task-assignment notification), cancel them, or keep the historical assignment as-is. There is no silent default that reassigns or orphans work. Any of that member's `ACTIVE` recurring definitions are automatically paused (recorded as `pauseReason: "ASSIGNEE_DEACTIVATED"`) so the scheduler cannot keep generating tasks for someone no longer on the team; Head can later change the recurrence's assignee and resume it. Deactivation never deletes a row — user, task, and recurrence history all remain queryable — so reactivation cannot create a duplicate account.

## Interfaces

All interfaces use the same backend, database, application services, and authorization rules.

### Marketing group

The primary fast task input is a positional message sent without mentioning the bot:

```text
Create 5 ad creatives for import campaign
@ali
08.09.2026 18:00
high
Construction, plumbing and auto-parts variations
```

The first three meaningful lines are title, assignee username, and deadline. A fourth-line `high`, `normal`, or `low` value sets priority; otherwise priority defaults to `normal` and line four onward is the optional multiline description. The previous labeled `T:`, `A:`, `DL:`, `P:`, and `D:` format and explicit bot mentions remain supported for compatibility. A deadline always contains an unambiguous date and time and is interpreted in `Asia/Tashkent`.

To avoid treating group conversation as work, positional input is considered only in the configured marketing group when its assignee/deadline lines have the task shape. The sender and assignee must both resolve to active onboarded team members, and the deadline must be in the future before any task or audit event is created. Username resolution is server-side, case-insensitive, and tolerant of surrounding whitespace and a leading `@`; an unrecognized username and a recognized-but-inactive username produce two distinct messages (`"@username aktiv jamoa a'zolari orasida topilmadi."` vs. `"@username hozir aktiv jamoa a'zosi emas."`) rather than one generic "not found".

**Bulk creation**: a message may contain several task blocks separated by a line that is exactly `---`. Each block is parsed and validated by the exact same single-task parser above — there is no separate bulk grammar. A message with no `---` line is unaffected and parses exactly as a single task. Each block succeeds or fails independently (one bad block never blocks the others); the sender gets a compact success/failure report naming the 1-based position of any failed block. A message may contain at most 20 task blocks; exceeding that returns a fixed refusal message instead of silently truncating. Bulk creation is idempotent per block, so a duplicated Telegram webhook delivery never creates the same batch twice.

### Private bot chat

A private message to the bot supports the exact same task-creation format as the group — positional or labeled, single or bulk (`---`-separated) — through the identical shared parser and creation workflow. The sender must be an active, onboarded team member; an inactive or unrecognized sender is rejected without becoming active and without creating anything. Because a private chat is a dedicated conversation rather than shared group traffic, its parse-error messages may be more detailed than the group's. `/start` and button-callback payloads are never parsed as task text. Private chat also handles onboarding, task-action commands (`/accept`, `/block`, `/revision`, `/deadline`), and callback-driven workflow actions.

### Telegram Mini App

The Mini App will eventually include Home, Tasks, Team, Calendar, and Reports. It will provide task lists and details, quick add, Kanban, factual workload counts, overdue/blocked/review queues, calendar, filters, search, reports, and activity history. Employee views are mainly personal; Head views are team-wide.

Quick Add stays short: title, assignee, and deadline are required; priority and description are optional. Submission is blocked while the team list is still loading (a loading/retry state, never a false "not found"); a team-list load failure shows `"Jamoa ma'lumotlarini yuklab bo'lmadi. Qayta urinib ko'ring."`.

The first screen loads from one consolidated `/api/bootstrap` call (active team list + a Home task summary) rather than several separate requests; the Tasks-tab list, Team detail, and Reports data load lazily only once their tab is actually opened. A small team's assignee picker filters the already-loaded active list locally, with no per-keystroke network search.

## Task model

Canonical statuses are:

- `ASSIGNED`
- `IN_PROGRESS`
- `BLOCKED`
- `REVIEW`
- `REVISION`
- `DONE`
- `CANCELLED`

`OVERDUE` is never a status. It is derived when `deadline < current time` and status is neither `DONE` nor `CANCELLED`. A blocked, review, revision, or in-progress task may simultaneously be overdue.

Priorities are `high`, `normal`, and `low`, defaulting to `normal`.

Tasks are cancelled instead of permanently deleted so analytics and history remain intact. A future Head-only reopen/recovery action may be added.

## Actors and permissions

Permissions are enforced by shared server-side business logic, not only by UI controls.

### Creator

For a task they created, the creator may directly change title, description, priority, deadline, assignee, subtasks, and permitted workflow state.

### Assignee

The assignee may change title, description, priority, subtasks, and status through permitted workflow actions. They may later add result or attachment metadata.

The assignee may not directly change the deadline or reassign the task. They must create a request unless they also qualify as the task creator or Head.

### Head / SUPER_ADMIN

The Head may manage every task and perform creator-level actions on any task. Head is also eligible to be creator or assignee.

## Lifecycle rules

### Acceptance (legacy) and auto-start

A task created through any current path (marketing group, private bot, Mini App, recurring generation, bulk creation) begins directly as `IN_PROGRESS` — the assignee does not accept it first. The assignment notification never offers an Accept action for these tasks, and no `TASK_ACCEPTED` event is recorded for them.

Tasks created before this rule was introduced may still exist as `ASSIGNED`; the `ACCEPT` transition (`ASSIGNED` → `IN_PROGRESS`) remains supported so those legacy tasks are not stranded, and the Mini App shows the Accept action only for a task whose current status is genuinely `ASSIGNED`. No existing record is migrated or rewritten by this change.

### Blocked

The assignee may mark a task `BLOCKED` with a required free-text reason. The system records reason, actor, and timestamp. Creator and Head will later be notified. Blocking and unblocking history must support duration analytics.

### Review and revision

The assignee submits completed work to `REVIEW`. The task creator or Head may approve it; one approval is sufficient and moves the task to `DONE`.

A reviewer may request revision with optional explanatory text. The task moves to `REVISION`, and the revision record remains in history. The assignee can resume work and submit it for review again. Revision count is calculated from retained records/events.

### Deadline change request

An assignee request contains the current deadline, requested new deadline, and a reason. It is visible to the creator and Head. The creator may approve; Head may approve when needed. One valid approval resolves the request, updates the task deadline, and appends immutable audit events atomically. Rejected requests remain in history. The first resolution wins, preventing duplicate approval.

### Reassignment request

An assignee request contains the requested assignee and a reason. Creator or Head may approve it. Creator may directly reassign their own task; Head may directly reassign any task. Requests, decisions, and direct reassignments remain auditable.

## Immutable activity history

Important mutations append an immutable task event containing task, actor, event type, relevant old and new values, metadata, and timestamp. Events include:

- `TASK_CREATED`, `TASK_ACCEPTED`, `STATUS_CHANGED`
- `TITLE_CHANGED`, `DESCRIPTION_CHANGED`, `PRIORITY_CHANGED`
- `DEADLINE_CHANGE_REQUESTED`, `DEADLINE_CHANGE_APPROVED`, `DEADLINE_CHANGE_REJECTED`, `DEADLINE_CHANGED`
- `REASSIGN_REQUESTED`, `REASSIGN_APPROVED`, `REASSIGN_REJECTED`, `ASSIGNEE_CHANGED`
- `TASK_BLOCKED`, `TASK_UNBLOCKED`
- `REVIEW_REQUESTED`, `REVISION_REQUESTED`, `TASK_COMPLETED`
- `TASK_CANCELLED`, `TASK_REOPENED`

Analytics must use history where historical state matters rather than attempting to infer everything from the current `tasks` row.

Membership changes append a separate, equally immutable `user_events` record (actor, target user, event type, old/new value, timestamp) for `USER_ACTIVATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, and `USER_ROLE_CHANGED`. Routine UI interactions are not logged this way — only state changes that affect who is on the active team or what they're allowed to do.

## Notifications and reports

A new task's assignment notification states the title, creator, deadline, priority, and `Status: In Progress`, with an Open Task button; it never offers Accept (see Lifecycle rules). When a bulk batch assigns more than one task to the same person, they receive one combined message listing all of their new tasks instead of one notification per task; a batch that spreads across several different people still sends one notification per person.

Deadline reminders fire for every active (non-`DONE`/`CANCELLED`) task at five thresholds relative to its deadline: 24 hours before, 3 hours before, at the deadline, 1 hour overdue, and 24 hours overdue. Before/at-deadline reminders go to the assignee only; the two overdue reminders escalate to the assignee, creator, and Head (deduplicated, so a creator who is also Head or the assignee receives one message, not two). Delivery is idempotent per `(task_id, deadline, reminder_type)` — a cron sweep that runs every few minutes, or runs twice, never resends a reminder that already went out for that exact deadline value. Changing a task's deadline starts a fresh reminder cycle for the new value; delivery history for the old deadline is untouched and does not block the new one. A threshold that passed more than a few hours before the sweep first sees it is treated as missed rather than fired retroactively, so deploying this feature (or recovering from a scheduler gap) does not burst-notify on old deadlines.

Scheduled reports use `Asia/Tashkent`:

- morning summary at 08:00 daily;
- evening summary at 19:00 daily;
- weekly report Sunday at 10:00.

Head receives team-wide reports; other employees receive only their own. Head can inspect all activity but should not receive a push for every small edit. Important pushes include overdue, blocked, deadline/reassignment requests, review, revision, and significant high-priority issues.

Scheduled report metrics are deterministic:

- `created`: task `created_at` is inside the reporting interval;
- `completed`: task `completed_at` is inside the interval;
- `on-time completed`: `completed_at <= deadline`, using the final approved deadline;
- `overdue during period`: deadline is inside the interval and completion was late or has not happened;
- `current overdue`: deadline is before report generation and status is not `DONE` or `CANCELLED`;
- `carry-over`: task was created before the period end and remains open at that end;
- `revision`: `REVISION_REQUESTED` events inside the interval;
- `blocked`: `TASK_BLOCKED` events inside a weekly interval; daily summaries show current blocked work;
- `deadline changes`: approved requests resolved inside the weekly interval. Analytics counts all requests created inside its window.

The weekly interval starts Monday 00:00 Asia/Tashkent and ends when the Sunday report runs. Morning summaries are delivered even when empty because they explicitly confirm no deadline today. Empty evening and weekly reports are skipped. A database ledger deduplicates every recipient and interval.

## Posting checklist

An exact, case-insensitive `#posting` token anywhere in a new task title or description attaches a persistent checklist: Telegram, Instagram, YouTube, and X / Twitter. Longer tags such as `#postings` do not match. Checklist state and every toggle are persisted and audited.

The assignee may toggle items while a task is `IN_PROGRESS` or `REVISION`. Creator and Head may inspect but cannot silently complete the assignee's checklist. Application logic and the database transition both reject REVIEW until every item is complete. Once attached, a checklist remains attached even if later text edits remove `#posting`.

## Recurring tasks

Creator or Head can turn a task into a future recurrence from Task Detail without adding lines to Telegram shorthand. Supported schedules are Monday–Friday, weekly on an ISO weekday, and monthly on days 1–31, with a local time and optional inclusive end date. Asia/Tashkent remains fixed at UTC+05:00. If a requested monthly day does not exist, that month's final day is used.

Every occurrence creates a new ordinary task with copied title, description, assignee, priority, and Posting behavior. It has its own history and references the recurring definition. `(recurring_definition_id, scheduled_occurrence_at)` is unique, and generation advances the definition in the same transaction, so overlapping scheduler runs cannot create duplicates. Pause, resume, schedule edits, and stop affect only future occurrences. Stop is final; existing tasks never change.

## Workload and analytics

Workload uses factual counts rather than effort points or invented utilization percentages: open, in progress, high priority, due today, due within 48 hours, overdue, blocked, and in review.

The Reports view uses a 30-day window by default. Employee data is attributed by assignee. Cycle time is `created_at` to `completed_at`. Status averages clamp history-derived status segments to the selected interval and average those segments. Revision rate is the share of tasks completed in the window that had at least one revision event. Review waiting and blocked duration are the corresponding status-segment averages. These are operational facts, not performance, salary, utilization, or KPI scores.

## Deferred features and exclusions

Subtasks and lightweight Telegram message relay remain planned. Relay should use Telegram copy/forward semantics and should not require permanent application storage of the message body or file.

MVP explicitly excludes AI features, categories, advanced project management, effort points, time tracking, internal task chat, Google Calendar, Notion, Bitrix, Gantt charts, salary/KPI features, gamification, and a generalized workflow engine.
