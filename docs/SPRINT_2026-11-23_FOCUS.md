# Focus and reliable release sprint — 2026-11-23

## Goal

Each employee can choose the work that matters, make a realistic daily commitment, and see the next action needed to finish on time. The Head can see decisions needed without ranking people by task volume. Release only after task actions and their bot messages are reliable.

This sprint is built on the current Preview branch. Production remains unchanged until the release gates pass. The video operator's **production** bot check is deferred at the Head's request; its current delivery status remains unknown and will be reported later. Do not label that flow verified.

## Ownership

| Owner | Work | Completion evidence |
| --- | --- | --- |
| Codex | Make status/review/approval notifications recoverable after a process or enqueue failure; verify one message per intended recipient after retry. | Transaction/recovery tests, staging database check, and Preview bot round trip. |
| Codex | Add explicit web sign-out and simplify Home around today's decision; keep the matrix available behind planning. | Session cookie clears; signed-out APIs reject; no duplicate Today list; Preview desktop/mobile check. |
| Codex | Add daily focus: one primary and up to two supporting tasks chosen from all assigned open tasks, including overdue and future work. Show the next checkpoint, estimated effort, and blocked state. | Actor-scoped database rules, mobile UI, refresh persistence, timezone and permission tests. |
| Codex | Develop repeatable-task SOP drafts with the Head, starting from existing workflow templates. Publish only Head-approved rules to the AI knowledge file and align reusable task/checkpoint templates afterward. | Every SOP has an owner, trigger, inputs, steps, review criteria, exceptions, and revision date; Head confirms each rule before Preview AI tests. |
| Codex | Add one actionable at-risk status check-in for missed checkpoints, blocked work, or a deadline that needs renegotiation. Show the relevant task and choices to update status or request a new date. | Deterministic conditions, one useful nudge rather than a reminder burst, and no motivational or celebratory copy. |
| Codex | Measure signed-in first useful content and task/checkpoint latency, then optimize only the slow path. Rehearse all pending migrations and verify backup/restore readiness with the owner. | Median/p95 timings, migration/grant/count comparison, documented recovery point. |
| Head | Add `OPENAI_API_KEY` to the Vercel **Production** environment and keep the OpenAI project spend limit active. Never send the key in chat. | Variable name present in Production; production AI smoke after release. |
| Head | Test Preview as an ordinary employee: login, My Day/focus, task action, deadline request, report, and bot message. | Short pass/fail notes for each flow. |
| Head | Review 35 open production tasks, especially 34 overdue ones. Close obsolete work or agree new deadlines with owners; identify the recurring processes to document first. | Agreed list of active commitments and approved SOP decisions; no silent bulk edits. |
| Head | Report the video operator's production-bot status when available. | One real `/start`/private-message result; this check is deferred for now. |

## Order and release boundary

1. **Reliability:** durable action notification intent and recovery, sign-out, role and permission tests. No production deployment.
2. **Focus MVP:** daily primary/supporting choices and simpler Home, followed by actionable status check-ins. Develop and approve SOPs before adding SOP-driven checkpoint suggestions. Keep the existing deadline-request approval path and optional planning/checkpoint fields.
3. **Preview acceptance:** Head and ordinary employee test; inspect signed-in latency and accessibility on desktop/mobile. Fix confirmed issues.
4. **Release rehearsal:** confirmed database backup/restore path, all pending migrations in order, RLS/grants and data counts, Production AI key. Re-run full quality gate on the exact commit.
5. **Production:** deploy only the reviewed build, smoke-test Head/employee actions, AI, notifications, outbox, and rollback readiness. Operator production-bot verification stays explicitly deferred until the Head provides its status.

## Product limits

Quick Add stays title, owner, and deadline. Personal focus choices do not change the shared task priority or deadline. AI may suggest a plan, but factual reminders/reports stay deterministic and every AI write still requires explicit confirmation. Do not add task-count leaderboards, automatic priority scores, gamification, or mandatory SMART/video fields. Track focus commitments finished, agreed-deadline on-time rate, aged overdue work, and blocked duration for two weeks before adding more controls.

The [removal audit](REDUCTION_AUDIT_2026-11-23.md) identifies controls to hide before adding new ones. The Head deferred OKRs, leaderboards, motivational bot messages, and celebrations. Personal encouragement remains a human conversation. Helpful status check-ins stay in scope.

## Progress

- Started: the web profile now offers sign-out using the existing cookie-clearing endpoint. Employee Home leads with My Day; the duplicate Today list is removed and the optional matrix is collapsed. Head Home keeps team status tiles first. Production is unchanged.
- Next: durable action-notification recovery, followed by the persisted daily focus choices and SOP discovery. The remaining rows above are planned, not implemented or verified yet.
- Preview follow-up: checkpoint checkboxes now update independently and immediately. One slow toggle no longer disables the others; a failed request restores only its own item. The tap uses the existing atomic permission-checking database function in one call and avoids reloading the whole task detail after each toggle.
