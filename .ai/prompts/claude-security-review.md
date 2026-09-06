# Independent security review prompt

Act as an independent senior application-security reviewer. Review only; do not edit files.

Read `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `.ai/CURRENT_SPRINT.md`, `.ai/PROJECT_STATE.md`, the implementation, `.review/CONTEXT.md`, and `.review/changes.diff`.

Concentrate on confirmed vulnerabilities and realistic risks involving:

- browser trust and forged Telegram user IDs;
- Telegram Mini App `initData` verification and replay/expiry handling;
- bot webhook authentication and unsafe update handling;
- service-role exposure or confused trust boundaries;
- Supabase grants, RLS, functions, views, and privileged database code;
- IDOR, privilege escalation, and creator/assignee/Head permission bypass;
- request approval races and first-resolution-wins behavior;
- non-atomic state mutations and audit events;
- secrets in source, logs, diffs, or client bundles.

Do not invent requirements. Separate confirmed defects, risks, and optional hardening. Cite files and line numbers where possible.

Use exactly this structure:

# Claude Security Review

Verdict: PASS | PASS_WITH_NOTES | FAIL

## Critical

## High

## Medium

## Low

## Required fixes before merge

## Optional improvements

If no blocking findings exist, use `PASS` or `PASS_WITH_NOTES`.
