# Current sprint

## Fast-track MVP vertical slice

- Branch: `fast-track/mvp` (to be created after the Sprint 0 closeout commit)
- Base: `sprint-0/foundation`
- Objective: Produce a usable end-to-end Telegram and Mini App task workflow today. Missing live verification blocks only the affected external check, not implementation.

## Tasks

| Task | Owner | Dependencies | Likely files | Parallel safe | Acceptance criteria | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| P0 data, identity, permissions | Codex | Sprint 0 | Domain, server, migrations, API | false | Verified actor boundary and repository-backed shared services work with fakes and Supabase adapter | Permission/identity/repository tests |
| P1 Telegram onboarding/task creation | Codex | P0 | Telegram adapters, application services | false | Private onboarding and group shorthand create audited tasks | Parser/handler/service tests |
| P2 core lifecycle and requests | Codex | P0/P1 | Domain/services/migrations | false | Accept, block, review, revision, completion, and deadline request paths enforce permissions/audit | Workflow/concurrency tests |
| P3 Mini App | Codex; Claude Sonnet only after contracts stabilize | P0–P2 | `src/app`, isolated UI components | true only with explicit UI-only ownership | Authenticated task views, Kanban, detail, and Quick Add use shared APIs | Component/API smoke tests |
| P4 live integration/deployment | Codex | P0–P3 | Configuration/deployment | false | Live connections attempted safely; unavailable operations recorded as pending | Health/webhook/data smoke tests |
| P5 reminders | Codex | P4 | Scheduler/service | false | Idempotent due reminders implemented if time remains | Timing/idempotency tests |

## Current status

- P0–P4: implemented, deployed, and live-verified.
- Production workflow-notification hotfix: implemented, committed (`77b2c4b`), reviewed, and deployed to production. Live human-originated verification of the deadline-request and review notification round trips is still pending (see `.ai/PROJECT_STATE.md`).
- Telegram group-creation UX hotfix: safe no-mention positional parsing implemented, committed (`77b2c4b`), reviewed, deployed, and **live-verified with a real human group message** (task `74360fff…` created end to end: classifier → auth → assignee resolution → single task/audit event → group confirmation → notification `SENT`).
- Practical MVP audit + Mini App redesign: `docs/MVP_AUDIT.md` covers Telegram group, private bot, Mini App, business logic, date/time, reliability, and code quality. No P0s; P1s and useful P2s fixed. Mini App rebuilt with a blue SaaS visual system, a new Home dashboard, a Team workload tab, and bottom navigation, with no backend/API changes. Committed `2b37acc` and deployed to production.
- Live Supabase: all five migrations applied and access boundary verified; reachability reverified post-deploy.
- Production: `https://marketing-team-task-bot.vercel.app`; encrypted Vercel environment is complete; deployed commit `2b37acc`.
- Telegram: webhook/menu verified with zero pending updates and no last error; real Head `/start` onboarding succeeded.
- End-to-end: controlled group restriction/task creation, real outbound notifications, Supabase persistence, signed Mini App APIs, deadline approval, lifecycle, audit, and revision checks pass (prior deployment); the new positional syntax is now also live-verified. The ordinary-conversation non-trigger check, the deadline-request/review notification round trips, and an interactive click-through of the redesigned Mini App have not yet been exercised on this deployment by a real human — see `.ai/PROJECT_STATE.md` "Remaining tasks".
- Independent review: General `PASS_WITH_NOTES` and final Opus security `PASS_WITH_NOTES`, both with no Critical/High findings; the two Low findings from the final Opus pass were fixed pre-commit. The audit/redesign changed no authorization or business logic, so no additional security review was run over it.
- P5: optional and not started.

## Definition of Done

- P0–P4 vertical slice is complete locally and all available live checks pass.
- External checks that genuinely cannot run are marked `PENDING_LIVE_VERIFICATION` without blocking other work.
- Permission, identity-forgery, workflow, audit, and request-resolution tests pass.
- Lint, typecheck, tests, build, secret scan, and final Opus security review pass without unresolved Critical/High findings.
