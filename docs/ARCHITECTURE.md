# Architecture

## Shape of the system

Marketing Team Task Bot is one Next.js application backed by one Supabase PostgreSQL database. It is deliberately a modular monolith.

```text
Telegram updates ──> webhook adapter ──┐
                                      ├──> application/domain services ──> repositories ──> PostgreSQL
Mini App/API ──────> HTTP adapter ─────┘              │
                                                     └──> shared permission guards
```

The Telegram and Mini App transports validate and translate external data, resolve a verified actor, call the same application services, and format results. They do not own workflow or authorization rules.

The optional AI assistant follows the same actor boundary. A private Telegram message or signed browser request calls `AssistantService`, which fetches only the actor's task scope through `MarketingService`. `OpenAIAssistantModel` sends that bounded context, recent personal turns, and `src/server/assistant/TEAM_SOP.md` directly to the OpenAI API through the AI SDK's OpenAI provider. The Head chose this route to use an eligible ChatGPT Pro API credit benefit linked to their OpenAI API organization; Vercel AI Gateway credits and budgets do not apply to these direct requests. The model returns a typed answer and optional proposal; it has no write tool. The service validates task/user references and stores the proposal in the service-role-only `assistant_turns` row. Web and private-bot confirmation atomically claim the actor-bound proposal once, then call the existing task-creation, status-action, or deadline-request service. The table also provides idempotent request keys, a per-user daily limit, and private history. The model call has a 20-second timeout and 900 output-token cap. `OPENAI_API_KEY` stays on the server. New SOP text is reviewed in Preview before release.

Task creation shares application validation and the underlying `create_task_with_event_v2` state-plus-event function. Telegram group, private bot, recurring generation, and bulk creation call it through `MarketingRepository.createTask`. Browser Quick Add calls `create_browser_task_with_checkpoints`, which adds an idempotency record, invokes that shared function or a narrow video/template wrapper, and inserts optional manual checkpoints in the same transaction. The transports only parse raw text (`src/telegram/task-shorthand.ts`'s `parseTaskMessage`) or a typed browser request; they do not own permission rules. A bulk message's per-block idempotency reuses the existing unique `tasks.source_telegram_update_id` column with a deterministic synthetic key (`updateId * 100 + blockIndex`), making a duplicated Telegram webhook delivery a no-op for a whole batch.

## Runtime and repository boundaries

- `src/app`: Next.js UI and route handlers. Route handlers are adapters, not business services.
- `src/domain`: pure TypeScript task concepts, validators, event definitions, and permission rules. It does not import Next.js, Telegram, or Supabase.
- `src/server`: trusted application services, identity verification, database clients, and repository implementations/contracts.
- `src/telegram`: Telegram Bot API transport, update parsing, and reply formatting.
- `supabase/migrations`: ordered database schema and security changes.
- `tests`: unit tests focused on business boundaries.

Node.js is the default runtime. Edge runtime is not needed and would unnecessarily constrain cryptography and server dependencies.

## Data and transaction model

PostgreSQL is the source of truth. Current task state is stored in `tasks`; historical facts are appended to `task_events`. Requests and revision records retain workflow-specific details.

Every important state mutation must update the current projection and append its event in one PostgreSQL transaction. Repository contracts expose atomic state-plus-event operations. Later sprints will implement these as narrowly scoped PostgreSQL functions called through Supabase RPC, with concurrency predicates such as `status = 'PENDING'`. This prevents partial state changes and duplicate request approvals. General-purpose mutation RPCs or a workflow engine are intentionally avoided.

Task events are append-only. Database triggers reject update and delete attempts even from trusted application code. Corrections are represented by new events.

## Security and identity

Regular browser login uses Telegram OIDC authorization code with PKCE and one-time state stored in a short-lived HttpOnly, Secure, SameSite=Lax cookie. The callback exchanges the code server-side with BotFather client credentials, verifies Telegram's RS256 ID token against its JWKS with issuer/audience/age checks, then resolves the Telegram ID to an existing active team member. The resulting application cookie uses the same signed-session verifier as the Mini App, with a 14-day web lifetime. BotFather must allowlist the exact application origin and callback URL; no browser receives the client secret, bot token, or service-role key.

Mini App task creation sends a client-generated operation UUID to `create_browser_task_with_checkpoints`. That security-invoker RPC commits a browser request row and exactly one ordinary, video, or template task plus optional manual checkpoints in one transaction; replaying the same UUID and payload returns the same task without duplicating checkpoints. The request row is also a durable notification intent. Next.js `after()` reads pending intents, queues assignment/creator/topic messages in the outbox, and attempts delivery after the HTTP response. The existing five-minute retry cron recovers a crashed request or transient enqueue failure; outbox keys deduplicate concurrent retries. Bot-initiated task creation continues to await delivery so its Telegram reply can describe the outcome. Browser action routes enqueue their workflow messages before returning. Browser mutations return the committed task promptly and the UI refreshes lists in the background. Underlying task writes still use the shared `create_task_with_event_v2` function; video and template creation invoke their narrow transactional wrappers around it.

Browser task creation queues a creator confirmation when the assignee is someone else, and browser workflow actions include the actor in their bot notifications. Review submission has a separate actor confirmation without approval buttons. The posting checklist's browser route uses the existing permission-checking atomic RPC result directly, then reconciles the UI's immediate toggle with the returned item; Telegram callbacks retain their full checklist response.

Optional personal plans live in `user_task_plans` keyed by user and task. Shared checkpoints live in `task_checkpoints`; their mutations use narrow RPCs that check the actor, lock the task, and append immutable `task_events` in the same transaction. Both new public tables are RLS-enabled, with browser roles revoked and only server-side service-role access. The Mini App API derives the plan owner from the verified session rather than accepting a caller-provided user ID.

One-task checkpoint templates live in versioned `task_templates` rows; `task_template_instances` pins a created task to its original version and event date. An atomic RPC calls the shared task creation function, then inserts the instance and relative checkpoints. The signed offsets are applied to a Tashkent **date**, then the row's local time is attached; they are not elapsed 24-hour durations. A task-deadline trigger marks an instance's deadline as manually overridden, while the event-date rebase RPC restores the auto flag after its own update. Rebase locks the task and updates only incomplete, non-manual template checkpoints, appending audit events in the same transaction. Both new tables have RLS and service-role-only access.

`/api/plans` returns the signed-in user's personal plan metadata and today's checkpoints on their open assigned tasks. The checkpoint query filters by due time and joins tasks with an inner relation, so other users' checkpoint titles never cross the API boundary. "Mening kunim" groups this set with tasks whose shared deadline is today. Template edits use the service-role-only `save_workflow_template_version` transaction: a new template and steps are inserted, then the old active template is retired. Head-only archive is a conditional server-role update of `workflow_templates.is_active`; the `DELETE` route does not delete rows. Workflow runs and tasks retain their original template/step foreign keys.

Browser code never receives `SUPABASE_SERVICE_ROLE_KEY` or `TELEGRAM_BOT_TOKEN`. During the current server-mediated design, application tables are inaccessible to `anon` and `authenticated`; RLS is enabled with no permissive policies, and only trusted server code receives explicit table privileges through `service_role`.

Bot-confirmed browser login stores one-time token hashes in `web_login_challenges`. `/api/auth/link/start` sets a scoped HttpOnly cookie and returns a Telegram bot deep link. The private `/start wl_...` webhook path resolves the sender through the existing active-user service, then conditionally approves the challenge. `/api/auth/link/complete` conditionally consumes the approved challenge once and issues the ordinary signed session cookie. The table is RLS-enabled and accessible only through the server's service role. No BotFather OAuth client configuration is required for this login path.

Telegram webhook calls must include the configured secret token header. Incoming update JSON is runtime-validated before use.

Mini App authentication will verify Telegram `initData` server-side using Telegram's documented signature algorithm, expiration checks, and the bot secret. The backend derives `telegram_user_id` from verified data and resolves it to an active internal user. A raw browser-provided ID, username, role, or `isHead` flag is never trusted.

Application services receive an `ActorContext` created only after server verification. Shared guards determine whether that actor is Head, creator, or assignee. Every sensitive action checks those guards even if its UI control is hidden.

## Supabase access

`task_video_briefs` stores one typed video brief per ordinary task. A workflow task insert trigger attaches an empty brief when its versioned template step declares `video_kind`; the plan still opens one task at a time. A narrow service-role RPC saves the required fields or confirms a shoot in a transaction with an immutable `task_events` entry. Edit briefs now require only `edit_level`; a later level change preserves older footage/output columns on existing rows. Confirmation serializes on the operator row and rejects overlapping confirmed shoots. `tasks.shoot_at` mirrors only a confirmed start time so My Day and Calendar can read it in their existing task queries. Editing a shoot proposal or reassigning its task clears that mirror and its confirmation. Browser roles have no table or RPC access.

`VIDEO_MEDIA_CHAT_ID` and `VIDEO_MEDIA_TOPIC_ID` select an optional Telegram forum destination per deployment environment. A new `SHOOT_SCENARIO` outbox kind has a task ID and nullable user recipient; the dedicated enqueue RPC accepts only a shoot task. The server hashes task ID, scenario URL, brief-change timestamp, chat ID, and topic ID for deduplication and stores the destination and text in the durable payload. The existing retry worker sends it through Telegram `sendMessage` with `message_thread_id`; all other outbox kinds retain required user recipients. No group messages are read and no raw media is copied into the app.

The backend uses a server-only Supabase client with disabled session persistence. The service-role key is used only in the trusted Node.js runtime. No direct database client is created in the Mini App during Sprint 0.

Tables live in `public` for conventional Supabase tooling but are opt-in locked: explicit grants are revoked from public clients, RLS is enabled, and no browser policies are installed. If direct authenticated reads become useful later, they require narrowly scoped policies derived from verified identities and a documented security review.

## Configuration

Secrets and environment-specific identifiers come from environment variables. Separate runtime parsers validate application, Supabase, and Telegram configuration only when that capability is used. This allows builds and pure unit tests without real credentials while still failing early when a configured integration starts.

## Notifications and scheduling

Protected Vercel Cron handlers run the morning summary at 03:00 UTC, the weekday daily check at 12:30 UTC (17:30 Tashkent), the Sunday report at 05:00 UTC, recurrence and workflow-recovery sweeps every five minutes, deadline reminders every ten minutes, and notification retries every five minutes. Vercel sends `CRON_SECRET` in the Authorization header; handlers compare it in constant time and expose no secret values.

Report deliveries use a unique `(report_type, interval_key, recipient_user_id)` database ledger. Deadline reminders use an analogous `(task_id, deadline, reminder_type)` ledger in `task_reminder_deliveries`, so a deadline change naturally starts a fresh delivery cycle without needing to touch history for the old deadline. Only active rows created by real Telegram `/start` onboarding are eligible for either ledger. One recipient failure does not abort other recipients or other tasks. Recurring generation locks and advances each definition in the same transaction that creates its occurrence, with a second unique constraint on `(recurring_definition_id, scheduled_occurrence_at)`. The recurring sweep also treats an inactive assignee as a hard stop: it auto-pauses that definition instead of generating a task for someone no longer on the team, mirroring the auto-pause already applied at deactivation time.

Assignment, bulk-assignment, workflow, and report sends also use `notification_outbox`. Each recipient has a durable payload and dedupe key. Workers claim rows with `FOR UPDATE SKIP LOCKED`, recover stale claims after 15 minutes, use bounded exponential backoff, and stop after five attempts. A successful report retry updates the outbox row and the report audit ledger in the same database transaction. Reminder rows retain per-recipient delivery metadata so a retry does not resend to recipients who already received the reminder. This provides at-least-once transport with logical deduplication; Telegram cannot provide a cross-system exactly-once transaction.

User activation, role changes, deactivation, and reactivation are each a single-transaction Postgres function (`*_with_event`) that updates `public.users` and appends a `user_events` row atomically, the same pattern already used for task mutations and their `task_events` — so a membership state change can never commit without its audit record, or vice versa.

All schedule calculations use `Asia/Tashkent` (fixed UTC+05:00), while database timestamps remain `timestamptz`/UTC.

## Deployment

The expected production layout is a single Next.js deployment (for example, Vercel) plus one managed Supabase project and a Telegram HTTPS webhook pointed at the deployment. Migrations are applied in order during a controlled release. No production resources are created during Sprint 0.

The Vercel function region is pinned (`vercel.json`'s `regions`) to match the Supabase project's region rather than left on Vercel's default, since every database-touching request otherwise pays a full cross-region round trip on top of the client's own latency. Whenever the Supabase project's region changes, this pin should move with it.

The Mini App's first screen is served by one consolidated route, `/api/bootstrap` (`src/app/api/bootstrap/route.ts`), that runs the active-team-list and Home-task-summary reads in parallel server-side and returns both in one response — a thin consolidating route with no business logic of its own, calling the same `MarketingService` methods the per-resource routes (`/api/users`, `/api/tasks`) already call. Per-tab data that is not needed for the first screen (the Tasks-tab list for a specific filter, Reports) is fetched lazily by the client only once that tab is opened, not eagerly at mount.

Task collections use database-side visibility, search, status/priority/assignee/deadline filters, stable `(sort_value, id)` keyset cursors, and a maximum page size of 100. Internal full-history reads use 500-row keyset pages, avoiding PostgREST's standard 1,000-row response ceiling. Home requests query only non-terminal visible tasks. Supporting indexes cover deadline/created cursors and creator/assignee/priority access paths. The Calendar view is a separate client component; it consumes the already-loaded scoped task collection and never creates another per-day request.

Mutating browser API requests pass through `src/proxy.ts`, which rejects cross-site `Origin`/`Sec-Fetch-Site` values before route logic. HttpOnly, Secure, SameSite=Strict HMAC sessions and verified Telegram `initData` still provide identity; the proxy is an additional CSRF boundary, not a replacement for per-action authorization. Server-originated Telegram webhook and cron calls do not carry browser fetch metadata and continue through their own secret checks.

## Extended data structures

`task_checklists` and `task_checklist_items` persist the deterministic Posting workflow. `task_comments` stores immutable comment/result records. `recurring_definitions` stores future schedule/template state while generated tasks remain ordinary `tasks` rows. `workflow_templates` and `workflow_template_steps` define reusable sequential plans; `workflow_runs` stores a run's subject, role assignment map, and current position while every activated step is an ordinary task. `notification_outbox`, `report_deliveries`, and `task_reminder_deliveries` are durable delivery state. `user_notification_preferences` stores per-user opt-outs. `user_events` is the membership audit trail, parallel to `task_events`. `users.deactivated_at`/`deactivated_by` distinguish a deactivated former member from a still-pending one, both of which have `is_active = false`. All new public tables are RLS-enabled, browser roles are revoked, and only the trusted `service_role` receives the minimum required grants.
