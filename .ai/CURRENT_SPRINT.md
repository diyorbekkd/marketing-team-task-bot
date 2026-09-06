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

- P0–P3: implemented; local quality gate passes.
- Live Supabase: all five migrations applied and access boundary verified.
- P4 remaining: deployment URL, configured group/Head IDs, Telegram webhook/menu, and real end-to-end smoke tests.
- P5: optional and not started.

## Definition of Done

- P0–P4 vertical slice is complete locally and all available live checks pass.
- External checks that genuinely cannot run are marked `PENDING_LIVE_VERIFICATION` without blocking other work.
- Permission, identity-forgery, workflow, audit, and request-resolution tests pass.
- Lint, typecheck, tests, build, secret scan, and final Opus security review pass without unresolved Critical/High findings.
