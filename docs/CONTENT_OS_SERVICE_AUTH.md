# Content OS → task-bot server-to-server auth

Server-to-server contract used by Content OS to call Task Bot's authoritative
HTTP task paths. Nothing is enabled in production by this document;
`CONTENT_OS_SERVICE_AUTH_ENABLED` still defaults to `false` and the shared
secret remains server-only.

## Why this exists

The existing `marketing_session` cookie (`src/server/auth/session.ts`) only
gets minted by `POST /api/auth/telegram`, which requires real Telegram
`initData`. Content OS is not a Telegram client and has no way to produce
that. This path lets a trusted server (never a browser) authenticate
directly, while still resolving to a real `public.users` actor and still
running every existing permission rule (`src/domain/permissions.ts`,
`src/domain/workflow.ts`) unchanged — a service caller is never treated as
the task creator/assignee/reviewer by default; it only acts as whichever
real team member its request identity resolves to.

## Required headers

| Header | Value |
|---|---|
| `x-content-os-timestamp` | Unix seconds, integer, as a string |
| `x-content-os-actor-provider` | Fixed string `CONTENT_OS_TELEGRAM_SESSION` |
| `x-content-os-actor-subject` | The `public.users.id` returned by validation of the current Content OS Telegram web session |
| `x-content-os-signature` | Lowercase hex-encoded HMAC-SHA256, 64 characters |

All four must be present. A request missing any of them is rejected as
`UNAUTHENTICATED` (see `src/server/auth/content-os-request-actor-provider.ts`).
A request with **no** `x-content-os-signature` header at all is treated as
not using this auth path (falls through to cookie auth, which will then
also fail for a server-to-server caller with no cookie) — this lets the
same route serve both transports without them interfering.

## Canonical signing input

```
signingKey = HMAC-SHA256("content-os-service-auth-v1", secret)   // secret = CONTENT_OS_SERVICE_SECRET
bodyHash   = SHA-256(rawRequestBodyBytes) as lowercase hex        // empty string for a bodyless request
canonical  = timestamp + "\n" + METHOD + "\n" + path + "\n" + bodyHash + "\n" + provider + "\n" + externalSubject
signature  = HMAC-SHA256(canonical, signingKey) as lowercase hex
```

Exact rules:
- `timestamp`: the same integer sent in `x-content-os-timestamp`, as its decimal string form (no re-formatting).
- `METHOD`: uppercase (`POST`, `GET`, ...).
- `path`: the request URL's path only (e.g. `/api/tasks/…/actions`) — no scheme, host, or query string.
- `bodyHash`: hash of the **exact bytes sent on the wire**, before any re-serialization. If the body is empty (a `GET`), hash the empty string.
- `provider` / `externalSubject`: the exact header values, not re-encoded.
- Join with `\n` (single newline), in this order, no trailing newline.

Implementation reference: `src/server/auth/content-os-signature.ts` (`signContentOsRequest` / `verifyContentOsSignature`). Content OS's client should call an equivalent function with the identical canonical string construction — any difference in field order, casing, or separators produces a signature mismatch, which this repo will reject as `INVALID_SIGNATURE` (surfaced to the caller as a generic `UNAUTHENTICATED`, per the rule below).

## Expiry / replay rules

- `CONTENT_OS_SIGNATURE_MAX_SKEW_SECONDS = 60`. A request is rejected if `abs(now - timestamp) > 60`, in **either** direction — both a stale request and a suspiciously-future one are rejected the same way.
- There is no separate replay-cache/nonce check yet. The 60-second window plus (once wired) `TaskCreationIdempotencyStore` for creates is the current defense; a real anti-replay store is Codex's decision once the DB contract lands (see `src/application/ports/task-creation-idempotency-store.ts`).
- Sign immediately before sending. Do not sign ahead of time and queue the request — a queued request will very likely land outside the 60-second window.

## Actor resolution

Content OS first validates its opaque `content_os_session` through the
Task Bot-owned `content_os_auth_validate_session` RPC. That result contains
the current active `public.users.id`; Content OS signs that id as the subject.
Task Bot accepts only provider `CONTENT_OS_TELEGRAM_SESSION`, validates that
the subject is a UUID, reloads the current `public.users` row, and rechecks
`is_active`. Legacy `OPENAI_SIWC`, malformed, missing, and inactive identities
all fail closed.

The resolved actor must also be `is_active`; an inactive linked actor is rejected the same as an unlinked one.

## Response / error semantics

Auth failures on this path surface exactly like every other auth failure in this API (`src/server/http/errors.ts` — unchanged):

| Situation | HTTP status | `code` |
|---|---|---|
| Missing required header | 401 | `UNAUTHENTICATED` |
| Signature invalid, malformed, or secret mismatch | 401 | `UNAUTHENTICATED` |
| Timestamp outside the 60s window | 401 | `UNAUTHENTICATED` |
| `CONTENT_OS_SERVICE_AUTH_ENABLED` not true | *(not applicable — falls through to cookie auth, then the normal 401)* | `UNAUTHENTICATED` |
| No linked actor for `(provider, externalSubject)` | 401 | `UNAUTHENTICATED` |
| Linked actor exists but `is_active = false` | 401 | `UNAUTHENTICATED` |

Deliberately generic: the response body never distinguishes *why* a signed request failed (wrong secret vs. expired vs. unlinked identity all produce the same `UNAUTHENTICATED`/401), so a caller probing this endpoint cannot use the error to enumerate valid subjects or working secrets.

Once past auth, every route's **existing, unchanged** success/error semantics apply — see the wire-contract audit for `POST /api/tasks`, `POST /api/tasks/{id}/actions`, etc. Nothing about response shapes changes for a service-authenticated request; the resolved actor is passed to the exact same `MarketingService` methods as a cookie-authenticated one.

## Production gates

1. `CONTENT_OS_SERVICE_AUTH_ENABLED` defaults to `false`.
2. Both applications must be configured with the same server-only shared
   secret and the approved Task Bot origin; neither value is browser-visible.
3. A resolved service-auth actor still cannot perform an action outside their
   current relationship/role permissions. The provider returns a plain,
   freshly loaded `public.users` actor to the same `MarketingService` checks
   used by Telegram and the Mini App.
