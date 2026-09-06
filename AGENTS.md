# Coding-agent instructions

These rules apply to every coding agent working in this repository.

1. Inspect the repository, branch, status, and nearby code before editing. Do not work directly on `main`; use the branch assigned to the task.
2. Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, and the relevant sprint scope in `docs/SPRINTS.md` before major work.
3. The production product must not use AI. AI tools are development aids only.
4. Respect the active sprint. Do not implement later-sprint features unless the user explicitly changes scope.
5. Do not silently alter unrelated behavior or overwrite unrelated user work.
6. Use TypeScript with strict typing and runtime validation at external boundaries.
7. Keep dependencies minimal and pinned. Do not add infrastructure or abstractions without a concrete need.
8. Keep business logic transport-independent. Telegram handlers and Mini App/API routes must call the same application services and domain permission rules.
9. Enforce authorization on the server in shared business logic. UI visibility is never an authorization control.
10. Keep database changes in ordered, versioned Supabase migrations. Preserve immutable task history and use database transactions for state-plus-event mutations.
11. Never commit secrets, `.env`, `.env.local`, service-role keys, bot tokens, or real Telegram identifiers.
12. Add meaningful tests for important business and permission rules. Run lint, typecheck, tests, and build before declaring work complete.
13. Prefer straightforward code over framework-like abstractions. This is a small internal system, not a microservice platform.
14. Report what changed, what was verified, and any remaining limitations after each task.
