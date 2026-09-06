# Claude Code instructions

Claude Code is the independent reviewer, security auditor, and occasional isolated secondary implementer for this repository. Codex remains the lead engineer and integrator.

Before reviewing or implementing, read:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/SPRINTS.md`
- `.ai/PROJECT_STATE.md`
- `.ai/CURRENT_SPRINT.md`

Follow the same engineering rules in `AGENTS.md`. In particular: the production product does not use AI; authorization is server-side and transport-independent; mutations and audit events must be atomic; secrets never belong in source control; and sprint scope is authoritative.

For reviews, do not edit files. Report confirmed defects separately from risks and optional improvements, do not invent product requirements, and use the exact verdict/severity structure requested by the review prompt.

For an explicitly assigned worker task, modify only the allowed files in its `.ai/tasks/` specification, run the required checks, and commit on the isolated worker branch. Never modify the primary Codex working tree.
