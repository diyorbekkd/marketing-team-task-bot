# Content OS Telegram web authentication

## Trust boundary

Task Bot owns Telegram identity, `public.users`, and the canonical shared-database migrations. Content OS owns the browser verifier, opaque session token, HttpOnly cookie, and Cloudflare routes. Neither the browser nor a cookie may assert a Telegram id, internal user id, role, or active state.

Both server runtimes use a server-only Supabase `service_role` binding. The private auth tables are outside the exposed `public` API schema, have RLS enabled, revoke ambient privileges (including `service_role` before narrowly granting back required DML), and store no raw verifier or session token. Production code must never log either raw value or any service/bot credential.

## Data model

- `private.content_os_login_challenges`: random UUIDv4 id, SHA-256 verifier hash, `PENDING | APPROVED | CONSUMED | CANCELLED`, ten-minute maximum lifetime, and approval/consumption/cancellation timestamps. Only an approved challenge carries a `public.users.id`.
- `private.content_os_web_sessions`: random UUID id, unique SHA-256 token hash, `public.users.id`, exact 30-day maximum lifetime, and optional revocation timestamp. It deliberately has no role column.

The `users_revoke_content_os_auth_on_deactivation` trigger permanently revokes all sessions and cancels all approved, unconsumed challenges when `public.users.is_active` changes from true to false. Reactivation requires a fresh login.

## Exact RPC contract

All functions are `SECURITY INVOKER`, set an empty `search_path`, revoke execution from `public`, `anon`, and `authenticated`, and grant execution only to `service_role`.

| RPC | Inputs | Result and behavior |
| --- | --- | --- |
| `content_os_auth_create_challenge` | `p_verifier_hash text` | `{ challenge_id, status, expires_at }`; accepts one lowercase 64-hex SHA-256 proof and creates a ten-minute `PENDING` challenge. |
| `content_os_auth_get_challenge_status` | `p_challenge_id uuid` | `{ status, expires_at }`; returns only `PENDING`, `APPROVED`, `CONSUMED`, `CANCELLED`, `EXPIRED`, or `UNAVAILABLE`, never identity. |
| `content_os_auth_approve_challenge` | `p_challenge_id uuid`, `p_telegram_user_id bigint` | `{ status }`; locks the challenge, resolves the Telegram id to a current active `public.users` row, and atomically binds it. Task Bot supplies the id from `callback_query.from.id`, never from browser input. |
| `content_os_auth_cancel_challenge` | `p_challenge_id uuid`, `p_telegram_user_id bigint` | `{ status }`; active Telegram callback sender may cancel a still-pending challenge. |
| `content_os_auth_redeem_challenge` | `p_challenge_id uuid`, `p_verifier_hash text`, `p_session_token_hash text` | `{ status, session_id, authenticated_user_id, display_name, role, expires_at }`; performs a fixed-work proof comparison, locks and consumes once, and inserts one 30-day session atomically. Identity fields are populated only for `REDEEMED`. |
| `content_os_auth_validate_session` | `p_session_token_hash text` | `{ status, session_id, authenticated_user_id, display_name, role, expires_at }`; returns `VALID` only for an unexpired, unrevoked session whose current user is active, with the current role read from `public.users`. Otherwise returns `INVALID` without identity. |
| `content_os_auth_revoke_session` | `p_session_token_hash text` | `boolean`; revokes only the matching session and is idempotent after the first successful revoke. |

The Content OS server hashes the raw verifier and raw session token with SHA-256 before calling these functions. A verifier mismatch, expiry, cancellation, pending approval, prior consumption, or inactive user never creates a session. The row lock makes duplicate/concurrent redemption one-shot.

## Telegram flow

1. Content OS creates the browser challenge and constructs `https://t.me/<existing-bot>?start=contentos_<challenge-id>`.
2. `/start contentos_<uuid>` bypasses onboarding. Task Bot checks both challenge readiness and current membership before displaying the approval buttons.
3. Tasdiqlash calls the approval RPC with the genuine Telegram callback sender. Bekor qilish calls the cancellation RPC the same way.
4. Normal `/start` remains unchanged: a new non-Head user is pending until Head assigns a role and activates them.

Callback data is bounded below Telegram's 64-byte limit:

- `contentos-login:approve:<uuid>`
- `contentos-login:cancel:<uuid>`

## Verification and release

`npm run db:test-content-os-auth` requires `CONTENT_OS_AUTH_TEST_DB_URL` and refuses the concurrent fixture unless the URL is local. The SQL lifecycle test runs inside a rolled-back transaction; the concurrency process uses two real connections and removes its committed fixtures afterward.

The PostgreSQL 17 rehearsal began from the exact eight-row live baseline, produced exactly 12 pending migrations, applied them with normal pinned Supabase CLI flow, ended at 20 ledger rows, and then returned an empty dry-run. It used no `--include-all`, history repair, or manual ledger edit. This evidence is local only; production apply and deploy remain prohibited until separately approved.
