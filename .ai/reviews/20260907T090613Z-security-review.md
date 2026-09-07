I now have a complete picture of the codebase and the diff. Let me compile the security review.

---

# Claude Security Review

Verdict: **PASS_WITH_NOTES**

## Critical

No critical findings.

## High

No high findings.

## Medium

### M1. Session signing key reuses Telegram webhook secret

`src/server/auth/session.ts:19` derives the session signing key from the webhook secret (`config.webhookSecret`), which is the same value compared in `src/telegram/webhook-security.ts:7` for webhook authentication. The HMAC derivation contexts differ (`"marketing-team-session-v1"` vs. raw SHA-256 comparison), so there is no practical cross-protocol attack. However, dual use of a single secret violates the principle of key separation: compromise of either protocol's internals (e.g., a future side-channel on the webhook hash comparison) could weaken the other.

`src/app/api/auth/telegram/route.ts:18`:
```typescript
const token = createSessionToken({ userId: user.id, telegramUserId: user.telegramUserId }, config.webhookSecret);
```

`src/server/auth/request-actor.ts:14`:
```typescript
const payload = verifySessionToken(token, getTelegramConfig().webhookSecret);
```

**Risk**: Low in practice (distinct HMAC domains prevent cross-use), but a single secret rotation event would now affect two subsystems simultaneously.

### M2. Full user list fetched on every workflow notification dispatch

`src/application/marketing-service.ts:308` — `dispatchWorkflowNotification` calls `this.repository.listUsers()` (fetching all users) on every workflow event. For the current 5-person team this is negligible, but every task action that triggers a notification (`SUBMIT_REVIEW`, `APPROVE`, `REQUEST_REVISION`, `BLOCK`, deadline requests, deadline resolutions) incurs this lookup. This is not a security vulnerability but a minor amplification vector: a rapid burst of legitimate workflow actions produces a proportional burst of full-table reads.

## Low

### L1. Notification dispatch errors silently classified as delivery failures

`src/application/marketing-service.ts:335-349` — When `this.notificationDispatcher.notifyWorkflow()` throws, the catch block logs `"DELIVERY_FAILED"` for each recipient. However, the `workflowMessage()` function (`src/server/notifications/telegram-notification-dispatcher.ts:53`) also throws on missing `deadlineRequest` context:

```typescript
if (!deadlineRequest) throw new Error("Deadline request context is required.");
```

A programming error (missing context) would be logged as `DELIVERY_FAILED`, obscuring the root cause. This doesn't affect workflow correctness (the mutation is already committed), but could delay diagnosis.

### L2. Deduplication split between service and dispatcher layers

Recipient deduplication happens at two levels:
- `marketing-service.ts:310` deduplicates `directRecipientIds` by user UUID via `new Set()`
- `telegram-notification-dispatcher.ts:181-187` deduplicates the final recipient list by `recipientKey()` (Telegram user ID)

Between these, `marketing-service.ts:331` merges `directRecipients` and `heads` without deduplication:
```typescript
const recipients = [...directRecipients, ...heads];
```

If a Head is also the task creator, they appear in both lists and would receive the message only once (because the dispatcher deduplicates by Telegram ID). This works correctly, but the layered deduplication makes correctness harder to verify on inspection. Not a vulnerability — merely a defense-in-depth observation.

### L3. `unhandled API error` log omits the error object

`src/server/http/errors.ts:26`:
```typescript
console.error("Unhandled API error.");
```

The actual error object is not logged, which means unexpected exceptions in production will produce an opaque log entry with no stack trace or message. This has no direct security impact but hinders incident investigation.

## Required fixes before merge

None. No Critical or High findings block this merge.

## Optional improvements

1. **Dedicated session signing secret (addresses M1)**: Introduce a separate `SESSION_SIGNING_SECRET` environment variable and config entry so that session tokens and webhook authentication use independent keys. This would allow independent rotation and cleaner trust boundaries.

2. **Targeted recipient lookup (addresses M2)**: Replace `listUsers()` in `dispatchWorkflowNotification` with a batch `getUsersByIds(ids)` query that fetches only the needed recipients plus any active Heads when `includeHeads` is true. This bounds the data fetched to what's needed.

3. **Log the error in the catch-all (addresses L3)**: In `errorResponse`, log the error object (sanitized of secrets) alongside the "Unhandled API error" message so unexpected failures leave useful traces. For example:
   ```typescript
   console.error("Unhandled API error:", error instanceof Error ? error.message : "unknown");
   ```

4. **Unify deduplication at one layer (addresses L2)**: Deduplicate the `directRecipients + heads` list by Telegram user ID inside `dispatchWorkflowNotification` before passing to the dispatcher, removing the dispatcher's need to re-deduplicate.
