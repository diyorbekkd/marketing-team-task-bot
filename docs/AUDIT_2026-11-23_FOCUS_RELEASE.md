# Focus and production readiness audit — 2026-11-23

## Verdict

**Do not promote the current Preview to production yet.** The code quality gate passes, but operational and user-flow gates do not. Production is still on September commit `14ee177` with 8 migrations; Preview is on the November review branch with 29 migrations. The 21-migration jump needs a verified backup and a controlled release. Production has no `OPENAI_API_KEY`, and the active video operator's production bot has repeatedly failed to receive morning reports. Browser task status changes still commit before their notification is durably recorded.

This audit is read-only apart from this document. It covers repository code, automated checks, Vercel deployment/configuration/log summaries, and aggregate Supabase queries. The Head previously confirmed the Preview AI checkpoint creation/completion flow. This pass did **not** independently measure signed-in browser performance, test an employee/operator account, perform a mobile accessibility audit, or verify a production backup/restore. Public page and health timing cannot substitute for those checks.

## Evidence baseline

- Local lint, TypeScript check, 307 tests across 35 files, production build, and runtime dependency audit pass; the dependency audit reports 0 vulnerabilities. The existing PR's CI and Vercel Preview checks passed on the previous commit.
- Vercel production remains `14ee177`; `OPENAI_API_KEY` is configured for Preview only. Recent Preview runtime logs show only two info entries; a quiet log window is not a performance or correctness measurement.
- Staging has RLS on all 26 public tables. Neither `anon` nor `authenticated` has table grants, and neither can execute any of its 49 public functions. Supabase advisors report only INFO notices: 29 foreign keys without covering indexes and 14 unused indexes. These do not, by themselves, justify 29 new indexes for this small dataset.
- Production has 35 open tasks: **34 overdue**, including **28 created in the past 30 days**. Six open tasks are older than 30 days. Only 9 open tasks were updated in the past 7 days. Among assignees with open tasks, load ranges from 2 to 13. One open task is marked high priority. These are aggregate counts; the underlying task commitments need human triage before judging individual performance.
- Staging has 16 open tasks, 15 overdue, 11 recorded importance choices, 11 effort estimates, and 22 checkpoints. Staging is a small test dataset, not a measure of team adoption.
- A single public Preview page sample returned 200 with about 0.79 seconds TTFB; health took about 2.17 seconds in another sample and signed-out bootstrap returned 401 in about 1.03 seconds. These samples are geographically/network dependent and say nothing reliable about authenticated first load or interaction latency. There is no Real User Monitoring instrumentation in the app.

## Release gates, in order

| Priority | Finding | Evidence | Required result |
|---|---|---|---|
| Blocker | A browser status change can save while its bot notification is lost | `MarketingService.performTaskAction` persists the transition, then `dispatchWorkflowNotification` performs recipient lookup and enqueues separately; failures are caught. | Persist a notification intent in the same database transaction as the status/event change, or add a recovery sweep from immutable events with deduplication. Verify retry and actor/creator/assignee delivery on staging. |
| Blocker | Large production schema and app jump | Production 8 migrations / September code; Preview 29 migrations / November code. | Confirm recent backup and restore procedure; rehearse all 21 remaining migrations against production-shaped data; capture before/after counts and grants; deploy in a maintenance window with a single matching rollback plan. |
| Blocker | Production integrations are incomplete | Production `OPENAI_API_KEY` absent; operator morning bot delivery failed repeatedly. | Add the key to Production without sharing it in chat or Git, check spend cap, have operator open production bot and send `/start`, and verify a real private message. |
| Blocker | Role-specific acceptance incomplete | Head exercised many Preview flows; ordinary employee and video operator end-to-end checks remain. | Test login, My Day, task details, create/accept/review/approve, deadline request, reports, video brief, and bot notification for each relevant role. Confirm creator/assignee visibility and authorization errors. |

Production should not be called ready merely because local tests and Preview build pass. No production database or app change was made in this audit.

## Product fit: the main gap

The app is strong at recording assignments and events. It is weaker at deciding **which work matters today** and protecting the time to finish it.

1. `groupTodayWork` includes a task only when its final deadline, shoot, or checkpoint is today. An important task due later, or an overdue task with no checkpoint today, does not enter My Day. The four Eisenhower categories are therefore a classification of today's due items, not a daily plan across all commitments.
2. Importance is a personal `user_task_plans` choice. The Head's importance decision does not establish a shared team outcome. The global task priority has only high/normal/low; in production just one open task is high. There is no explicit weekly outcome or ranked daily commitment.
3. The morning employee bot report lists tasks due today and an overdue count. It does not nominate high-impact work that needs progress before its deadline or surface a missed checkpoint as a next action.
4. The AI's daily planning context contains task title, description, status, priority, owner, and deadline for at most 40 open tasks. It does not receive personal importance, effort estimates, all checkpoints, or an agreed team outcome for an ordinary “what should I start?” question. Its advice can sound useful without knowing what actually creates impact.
5. Thirty-four of 35 production open tasks are overdue, and 28 of those are recent. A red overdue count alone will not tell the team what to renegotiate, cancel, or finish first. This requires a one-time backlog triage and a lighter ongoing commitment process.

### Recommended small planning loop

- **Weekly:** Head chooses up to three measurable outcomes for the team and names one accountable owner for each. Link existing tasks to an outcome only when it helps; avoid mandatory fields on every task.
- **Morning, two minutes per person:** Show all assigned open tasks, including overdue and important future work. Pick **one primary and at most two secondary focus tasks** for today. Use the existing effort estimate where available. The app should display the next checkpoint/action, not just the final task deadline.
- **On assignment:** The owner accepts the task or requests a realistic deadline early. Flag unaccepted tasks and workloads above a modest in-progress limit for Head review; do not silently alter deadlines.
- **During the day:** Give one useful at-risk prompt when a checkpoint slips, the owner is blocked, or estimated remaining work exceeds time left. Make the prompt actionable: unblock, reduce scope, reassign, or request a new date. Avoid multiple generic reminders.
- **Evening:** Ask whether the primary focus outcome moved or finished, what is blocked, and what is the first action tomorrow. Show the Head exceptions and decisions needed, not a leaderboard of raw task counts.
- **AI:** Let it propose the focus three and break one into checkpoints using the agreed outcomes and plan data, with human confirmation. Do not add more AI write commands until this grounded advice works consistently.

Measure after two weeks: chosen focus tasks finished, agreed-deadline on-time rate, aged overdue work, time to accept/renegotiate, and blocked duration. Do not optimize employee rankings or task volume: both can reward small low-impact tasks.

## Speed and maintainability

- The web first load now combines identity, users, and Home tasks in `/api/bootstrap`, but My Day then fetches `/api/plans` separately. The Head's Home query selects all columns of every open task and paginates until exhausted. This is acceptable for 35 production open tasks, but its cost grows with backlog and it delays the primary focus view.
- Task detail loads events, comments, requests, checklist, recurrence, plan, checkpoints, workflow, video brief, and template data in parallel. Adding a checkpoint optimistically updates the panel, then refreshes the entire detail. That makes one small mutation trigger a broad reload. Profile this before changing the query plan; likely improvement is a compact detail response or targeted refresh.
- `MiniApp.tsx` is about 3,910 lines and owns navigation, task lists, details, forms, reports, workflow controls, user management, and modal state. Split by screen and lazy-load infrequent Head/admin flows after measuring route bundle and interaction timing. The line count is a maintenance signal, not proof of a slow bundle.
- Add real-user measurements for signed-in first useful content, bootstrap and plan API latency, task detail open, checkpoint action, and task creation (median and p95 on mobile and desktop). The current public HTTP samples and sparse runtime logs cannot validate perceived speed.

## Security and reliability

- Positive: server-only Supabase secret client, active actor lookup on requests, signed session tokens, Strict cookies, Origin/Sec-Fetch-Site mutation guard, Telegram identity checks, RLS and no browser-role database grants. Staging advisors have no warning/error findings, and runtime dependency audit is clean.
- Browser sessions last 14 days. No logout route or visible sign-out control was found. A pinned app on a shared office computer needs explicit sign-out; sensitive session revocation after account/device compromise should be designed separately from simply clearing the cookie. Deactivation does re-check the actor on each API request.
- The health endpoint only returns a static `ok`. Keep that liveness check, but add an authenticated/operator-only readiness check or monitor that separately verifies database reachability, cron recency, and outbox age without leaking internal details publicly.
- The AI SOP file currently says that no operating rules are approved. The AI can answer task questions but cannot yet teach the team's actual decision rules. Draft and approve a short SOP for priority, deadline negotiation, review turnaround, and video handoff before presenting it as institutional memory.
- Analytics and scheduled reports currently load all tasks and all task events before calculating aggregates. This is fine at current scale but will grow with history; add bounded SQL aggregates when measurements justify it. The 29 unindexed foreign key notices are candidates for targeted review, not a blanket migration.

## UI and UX: simplify the default path

- Employee Home currently shows four status tiles, My Day with five matrix categories, another Today task list, and Upcoming tasks. These can repeat or dilute the same work. Make the selected daily focus and next action first; collapse secondary status, matrix, and upcoming lists.
- Head Home should lead with decisions: overdue items needing a new plan, blocked owners, review queue, and workload imbalance. Templates and workflow controls should sit in a labeled Actions/Settings menu instead of competing icon buttons in the top bar.
- Keep the four-quadrant view as an optional planning tool, but avoid making manual urgency classification the daily default. Deadline proximity already supplies an urgency suggestion; impact needs a shared business outcome.
- Reconsider “Reja va natija” figures that compare tasks created and tasks completed in the same period: these are different cohorts and can mislead. Prefer focus commitments, completion against agreed dates, and work-in-progress aging with clear drill-downs.
- Code includes labeled inputs, focus-visible styles, responsive sheets, and reduced-motion support. A keyboard focus trap/Escape behavior was not found for modal sheets, and this audit did not verify contrast, screen reader flow, or mobile keyboard behavior in a signed-in browser. Test those before claiming accessible web use.

## Remove or defer

- Hide duplicate Home sections and move matrix/advanced planning out of the first screen; retain access for people who use them.
- De-emphasize raw “tasks created/completed” productivity comparisons and employee ranking. They do not measure impact.
- Do not add mandatory video, SMART, or AI fields to ordinary task creation. Keep the quick path title + owner + deadline and optional detail.
- Defer more AI actions, automated priority scores, gamification, and new integrations until the focus loop and notification delivery are reliable.

## Recommended execution order

1. Make browser status/approval notifications durable; test retry and the video operator's bot reachability.
2. Add explicit web sign-out; complete role-specific Preview acceptance and signed-in performance/accessibility measurements.
3. Triage the 35 production open tasks with the Head, especially the 34 overdue; agree on real current deadlines or close work that is no longer needed. Do not bulk-edit silently.
4. Confirm backup/restore and Production AI key, rehearse migration order, then deploy and smoke-test the exact reviewed build.
5. Build the small daily focus loop and team outcomes from real usage evidence; run a two-week adoption review before adding more features.
