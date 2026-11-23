# Distraction and removal audit — 2026-11-23

## Decision

Simplify the everyday path before adding gamification or a full OKR hierarchy. Keep task history, permissions, checkpoints, deadline requests, and video briefs. The recommendations below are about what people see and must decide each day; they do not silently delete stored work.

This is a code and product-flow audit, not measured feature adoption. Production is still on the older deployment, staging contains test data, and no signed-in usage telemetry proves which individual controls the team uses. Pilot a simpler Preview with the Head and one employee before retiring stored fields or notification types.

## Ranked cuts

| Priority | Current friction and evidence | Recommendation |
| --- | --- | --- |
| 1 | Task detail asks for personal importance, a manual urgency override, and an effort estimate; a task already has shared priority and a deadline. `TaskPlanningPanel` shows all three controls together, while `groupTodayWork` uses the urgency override only to choose an Eisenhower quadrant. | Keep the effort estimate and one impact choice in optional planning. Hide manual urgency override from the normal path; compute deadline urgency. Keep the matrix available in an advanced view until the pilot confirms it can be retired. Do not remove stored override data yet. |
| 2 | Home has My Day, four status tiles, a five-item Upcoming list, and for Head a template card plus workload. The top bar separately shows AI, add, workflow launch, and workflow plans. | Employee default: one focus block, next checkpoint/action, then a compact exception summary. Head default: decisions needed and workload. Move template/workflow controls into one labeled management menu. Collapse Upcoming and secondary status lists. |
| 3 | Reports opens with open-versus-completed bars, then carry-over, overdue, on-time rate, revision rate, extension count, cycle time, status durations, and for Head per-member metrics. Many figures are descriptive but have no immediate decision attached. | Default employee report: chosen work finished, agreed deadlines, and blockers. Default Head report: overdue needing a decision, blocked duration, review queue, and workload. Move detailed process metrics to an expandable analysis view. Avoid employee ranking and task-volume scores. |
| 4 | A task can trigger five deadline reminders (24h and 3h before, at deadline, 1h and 24h overdue), alongside daily/weekly reports and a daily check. | Keep transactional assignment/review/approval messages. Pilot fewer deadline nudges: one early actionable reminder and one overdue escalation. Measure missed deadlines and notification opt-outs before changing the schedule. |
| 5 | Workflow templates, single-task checkpoint templates, workflow plans, and recurring tasks are separate concepts with similar entry points. | Present a single labeled “Reusable work” entry for Head with clear choices inside. Retain both template engines and recurrence behavior; remove duplicate shortcuts from Home and the top bar. |
| 6 | `planned_on` is still stored in personal plans but is hidden and set to null by the current planning form. | Resolve it when implementing the new daily focus model: reuse it only if it can safely express a ranked commitment, otherwise migrate away after a data check. Do not expose a second planning date field. |

## Keep visible and easy

- Task title, one accountable owner, agreed deadline, current status, and the next permitted action.
- Checkpoints when they describe a real deliverable, with fast independent completion.
- Deadline change request, block reason, review/approval, and the task event trail. These protect accountability.
- Video brief fields only for operator tasks, and templates only when the creator chooses one.
- The AI assistant as an optional helper. Do not let its suggestions replace factual task state or add mandatory chat steps.

## Gamification and OKRs

Do **not** add points for creating or closing tasks, public leaderboards, or punitive streaks. Those would reward splitting work into small tickets and can discourage honest deadline renegotiation. After the focus loop works, a quiet personal weekly reflection can celebrate a finished commitment or milestone, with no score or comparison between employees.

A light outcome layer can monitor impact without creating a second task system: one mission for a 4–6 week period; at most three outcomes; each outcome has one owner, one or two measurable key results with a baseline and target, and optional links to existing tasks. Update the measured result and confidence once a week. Completing tasks must **not** automatically mark a key result achieved: a webinar can be delivered on time while attendance or qualified leads miss the target. First pilot the sprint's planned weekly outcomes in this shape. Avoid extra `initiative → project → epic → objective → key result → task → subtask` levels.

## Test of simplification

For two weeks, ask one employee to start each day from Home and name the next action in under a minute. Record whether they finish their chosen focus work, renegotiate a risky deadline early, and find review/approval without help. If a hidden control is repeatedly requested, restore it in the relevant context. If no one uses an advanced control, retire its UI before removing its data or API.
