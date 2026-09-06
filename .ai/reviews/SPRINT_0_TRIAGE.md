# Sprint 0 review triage

## Reviews

- General review: `20260906T144612Z-review.md` — `PASS_WITH_NOTES`
- Security review: `20260906T150406Z-security-review.md` — `PASS_WITH_NOTES`

## Findings

| Finding | Decision | Resolution |
| --- | --- | --- |
| General M1: secret config module lacks `server-only` | VALID | Added the guard and a Vitest-only empty alias. |
| General M2: outbound Telegram failures are unhandled | VALID in part | Catch and sanitize the failure. Return retryable `502`, not `200`: until durable outbound delivery exists, acknowledging would silently lose the reply. Mutating updates will gain idempotency before launch. |
| General L1: unrelated-member permission test missing | VALID | Added explicit denial coverage. |
| General L2: Telegram config parsed twice | VALID | Pass the already validated bot token into the client. |
| General L3: token may appear in transport errors | VALID risk | Validate token format and never log the caught transport error object. |
| Security M1: revision records are mutable | VALID | Added a follow-up migration with an immutability trigger and insert/select-only grant. |
| Security M2: explicit service-role grants are a migration footgun | VALID risk | Added a permanent migration rule to `AGENTS.md`; future migration reviews must enforce it. |
| Security L1: webhook replay protection | VALID, DEFERRED | Required before mutating Telegram commands; planned with update idempotency in Sprint 2. |
| Security L2: CSP absent | VALID, DEFERRED | Required before authenticated Mini App work in Sprint 6. |
| Security L3/L4 | OPTIONAL/NO ACTION | Singleton rotation behavior is acceptable; configuration logs contain names but no values. |

No Critical or High findings were reported. All required findings are resolved locally, subject to re-review and the Sprint 0 quality gate.
