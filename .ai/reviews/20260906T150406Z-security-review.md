Good — no `process.env` or `NEXT_PUBLIC_` references in any client-facing app code. I now have all the information needed for the full review.

---

# Claude Security Review

Verdict: **PASS_WITH_NOTES**

## Critical

No critical findings.

## High

No high findings.

## Medium

### M1. `task_revisions` table lacks immutability protection

**File:** `supabase/migrations/20260906143255_foundation_schema.sql:134-140, 236`

The `task_events` table is protected by a trigger (`task_events_prevent_update_or_delete`, line 214-216) that rejects all UPDATE and DELETE, and its grant is limited to `SELECT, INSERT` (line 234). However, `task_revisions` — which serves a similar audit/history purpose — has no such trigger, and its grant (line 236) includes `UPDATE` and `DELETE`:

```sql
grant select, insert, update, delete on table public.task_revisions to service_role;
```

Per PRODUCT.md: "the revision record remains in history" and "Revision count is calculated from retained records/events." A bug or compromised service-role path could silently delete or alter revision records, breaking audit integrity.

**Recommendation:** Add an immutability trigger on `task_revisions` (identical to `task_events_prevent_update_or_delete`) and restrict the grant to `SELECT, INSERT` only.

### M2. `ALTER DEFAULT PRIVILEGES` revokes from `service_role` — future migration footgun

**File:** `supabase/migrations/20260906143255_foundation_schema.sql:239-244`

```sql
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
```

This revokes default privileges from `service_role` in addition to `anon`/`authenticated`. While this is a deliberate "opt-in locked" hardening measure, it means every future migration that creates a new table must include explicit grants for `service_role`, or the application will silently fail to access the table at runtime. If a future sprint migration omits the grant, the error surfaces only when the affected code path executes — not at migration time.

**Risk:** This is a correctness/reliability risk rather than a direct vulnerability, but the silent failure mode could mask security-adjacent issues (e.g., a developer adding a workaround that bypasses the intended access model).

**Recommendation:** Document this requirement prominently in the migration conventions. Consider a CI check or migration template that verifies explicit grants are present for every new table.

## Low

### L1. No replay or expiration enforcement on webhook updates

**File:** `src/app/api/telegram/webhook/route.ts`

The webhook endpoint validates the secret header and parses the Telegram update, but does not check `update_id` monotonicity or the message timestamp. Telegram itself provides ordering guarantees, so this is low risk in normal operation. However, if the webhook secret is compromised, an attacker could replay captured updates indefinitely.

Sprint 0 only handles `/start` (no mutations), so the practical impact is negligible. Later sprints that handle task-mutating commands should consider tracking the last processed `update_id` to reject replays.

### L2. No Content-Security-Policy headers

**File:** `src/app/layout.tsx`

The Mini App shell currently serves a static page with no user input or dynamic data. However, no CSP headers are configured. Before Sprint 6 (Mini App foundation with authenticated data), a restrictive CSP should be applied to mitigate XSS risk.

### L3. Singleton Supabase admin client shares one connection context

**File:** `src/server/db/supabase.ts:6-21`

The admin client is a module-level singleton initialized on first use. This is standard for Supabase in a serverless environment. However, if the service-role key is rotated in environment variables, the cached client retains the old credential until the process restarts. This is a minor operational concern, not a vulnerability.

### L4. Error messages in webhook could leak internal state

**File:** `src/app/api/telegram/webhook/route.ts:13`

On `ConfigurationError`, the error message is logged via `console.error(error.message)`. The response returns a generic 503. The `ConfigurationError` message includes variable names (e.g., "TELEGRAM_BOT_TOKEN") but not values (validated by `tests/config.test.ts:46`). The logging is appropriate for server-side diagnostics and does not leak secrets to the HTTP response. No action required.

## Required fixes before merge

1. **M1**: Add an immutability trigger on `task_revisions` and restrict its `service_role` grant to `SELECT, INSERT`. This table is documented as historical data that must be retained, and it currently has weaker protection than `task_events` despite serving a similar purpose.

## Optional improvements

1. **M2 mitigation**: Add a comment or linting rule in the migration file documenting that all new tables require explicit `service_role` grants due to the `ALTER DEFAULT PRIVILEGES` revocation.

2. **L1 mitigation**: In sprint 2+ when mutating commands are added, consider tracking the last processed `update_id` per webhook to reject replay attempts.

3. **L2 mitigation**: Add a baseline CSP via `next.config.ts` headers before Sprint 6.

4. **Webhook error resilience**: The webhook handler (line 36-38 of `route.ts`) does not catch errors from `sendTelegramMessage`. If the Telegram API call fails, Next.js returns a 500, causing Telegram to retry the update. Consider wrapping the send in a try/catch to always return 200, preventing infinite retry loops on transient Telegram API failures. This is a reliability concern, not a security concern.

---

**Summary:** The Sprint 0 foundation demonstrates strong security posture overall. The database layer correctly enables RLS, revokes all public/anon/authenticated access, uses `server-only` imports to prevent secret leakage to client bundles, enforces webhook authentication with timing-safe comparison, and defines a clear identity verification boundary. The one required fix — adding immutability protection to `task_revisions` — aligns with an existing pattern already applied to `task_events` and is straightforward to implement.
