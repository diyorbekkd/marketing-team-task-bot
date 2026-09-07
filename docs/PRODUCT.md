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

To avoid treating group conversation as work, positional input is considered only in the configured marketing group when its assignee/deadline lines have the task shape. The sender and assignee must both resolve to active onboarded team members, and the deadline must be in the future before any task or audit event is created.

### Private bot chat

Private chat will later provide onboarding, task acceptance, requests, alerts, summaries, and a `/task` wizard. Sprint 0 includes only the transport skeleton.

### Telegram Mini App

The Mini App will eventually include Home, Tasks, Team, Calendar, and Reports. It will provide task lists and details, quick add, Kanban, factual workload counts, overdue/blocked/review queues, calendar, filters, search, reports, and activity history. Employee views are mainly personal; Head views are team-wide.

Quick Add stays short: title, assignee, and deadline are required; priority and description are optional.

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

### Acceptance

An assigned task begins as `ASSIGNED`. Acceptance transitions it to `IN_PROGRESS`.

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

## Notifications and reports

Future deadline notifications occur 24 hours before, 3 hours before, at the deadline, 1 hour overdue, and 24 hours overdue.

Scheduled reports use `Asia/Tashkent`:

- morning summary at 08:00 daily;
- evening summary at 19:00 daily;
- weekly report Sunday at 10:00.

Head receives team-wide reports; other employees receive only their own. Head can inspect all activity but should not receive a push for every small edit. Important pushes include overdue, blocked, deadline/reassignment requests, review, revision, and significant high-priority issues.

## Workload and analytics

Workload uses factual counts rather than effort points or invented utilization percentages: open, in progress, high priority, due today, due within 48 hours, overdue, blocked, and in review.

The event model must later support created versus completed work, carry-over, on-time completion, overdue rate/current overdue, blocked duration, time in status, cycle time, deadline extension requests, revisions, completions by employee, open workload, and repeated status bottlenecks.

## Deferred features and exclusions

Subtasks, simple checklist templates, and lightweight Telegram message relay are planned but not implemented in Sprint 0. Relay should use Telegram copy/forward semantics and should not require permanent application storage of the message body or file.

MVP explicitly excludes AI features and summaries, recurring tasks, categories, advanced project management, effort points, time tracking, internal task chat, Google Calendar, Notion, Bitrix, Gantt charts, salary/KPI features, gamification, and a generalized workflow engine.
