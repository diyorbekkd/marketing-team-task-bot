# Independent code review prompt

Act as an independent senior code reviewer. Review only; do not edit files.

Read and compare:

1. `docs/PRODUCT.md`
2. `docs/ARCHITECTURE.md`
3. `.ai/CURRENT_SPRINT.md`
4. `.ai/PROJECT_STATE.md`
5. the current implementation
6. `.review/CONTEXT.md` and `.review/changes.diff`

Do not invent requirements. For every item, distinguish a confirmed defect from a risk or optional improvement. Cite files and line numbers where possible.

Severity definitions:

- CRITICAL: security vulnerability, authorization bypass, data corruption, product invariant violation, or secrets exposure.
- HIGH: broken business logic, race condition, missing permission check, incorrect state transition/audit history, or migration design defect.
- MEDIUM: important missing test, reliability issue, or maintainability issue with real impact.
- LOW: minor cleanup only.

Use exactly this structure:

# Claude Review

Verdict: PASS | PASS_WITH_NOTES | FAIL

## Critical

## High

## Medium

## Low

## Required fixes before merge

## Optional improvements

If no blocking findings exist, use `PASS` or `PASS_WITH_NOTES`.
