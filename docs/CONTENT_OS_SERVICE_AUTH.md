# Content OS → task-bot server-to-server auth

Handoff spec for the Content OS side (`ibox-content-funnel`) to implement a
real signing client against this repo's server-to-server auth path. This
document describes the **contract only** — nothing here is enabled in
production. See `CONTENT_OS_SERVICE_AUTH_ENABLED` in `.env.example` and
`src/server/auth/external-actor-resolver.ts`'s `SchemaNotReadyExternalActorResolver`
for the two independent gates that currently block every request on this
path, by design, until Codex's identity-link schema exists.

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
| `x-content-os-actor-provider` | Fixed string identifying the calling system, e.g. `"content-os"` |
| `x-content-os-actor-subject` | Content OS's own identity claim for the acting user — its SIWC `oai-authenticated-user-id`, **not** a `public.users.id` |
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

## Actor resolution — do not assume `public.users.id`

`x-content-os-actor-subject` is **never** treated as a `public.users.id`. It is looked up via `ExternalActorResolver.resolve({ provider, externalSubject })` (`src/server/auth/external-actor-resolver.ts`), which is expected to be backed by Codex's `external_identity_links` (or equivalent) table mapping `(provider, externalSubject) → public.users.id`. Until that table and a real resolver exist, `SchemaNotReadyExternalActorResolver` — the only production-wired implementation — always fails closed with `EXTERNAL_IDENTITY_NOT_LINKED`. Content OS should not attempt to guess or pre-map this on its own side; the mapping is owned here.

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

## What still blocks this path in production today

1. `CONTENT_OS_SERVICE_AUTH_ENABLED` defaults to `false`.
2. Even if enabled, `SchemaNotReadyExternalActorResolver` always throws — no real actor can ever be resolved until Codex's identity-link schema and a real resolver land.
3. `POST /api/tasks` still has no create-idempotency enforcement for this path (`TaskCreationIdempotencyStore` is an interface only, wired nowhere) — a network retry from a future Content OS caller could double-create a task exactly as it could from the Mini App today. Do not treat CREATE as safe to enable even after (1) and (2) are resolved, until this is addressed.
4. A resolved service-auth actor still cannot perform an action outside their real permissions (assignee-only, creator/Head-only, etc.) — there is no privilege escalation via this path, by construction (`ContentOsRequestActorProvider` returns a plain `public.users` actor to the exact same, unmodified permission checks every other caller goes through).
