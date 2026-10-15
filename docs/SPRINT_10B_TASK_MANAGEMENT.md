# Sprint 10B task-management contract

Task Bot remains the authoritative migration and mutation owner. Content OS and Telegram use the same rows and the same Task Bot-owned RPCs; neither transport mirrors requests or reimplements request resolution.

## Accepted product decisions

1. Every active marketing user can view every non-archived marketing task.
2. Every active marketing user can view all Content OS content through trusted server reads.
3. Every active marketing user can create a task for any active marketing user.
4. A task creator directly manages content, assignee, and deadline on their own task.
5. An ordinary assignee uses `reassign_requests` and `deadline_change_requests` unless they are also the creator.
6. Active Head directly manages every task.
7. Only active Head resolves change requests.
8. Telegram and Content OS resolve the same request row through the same RPC.
9. Creators cancel tasks; Head archives/restores them.
10. Archive is soft and orthogonal to workflow status; task identity and history remain intact.
11. Telegram notifications cover meaningful assignment, request, revision, review, and approval outcomes.

## Reusable authorization rules

The transport-independent TypeScript predicates are in `src/domain/permissions.ts`:

- `canViewTask`: active team member and non-archived task; archived tasks require active Head.
- `canEditTask`: active creator or active Head, and task is not archived.
- `canDirectReassign`: `canEditTask` plus non-terminal workflow state.
- `canDirectChangeDeadline`: `canEditTask` plus non-terminal workflow state.
- `canRequestReassign`: active ordinary assignee, not creator/Head, non-terminal, non-archived.
- `canRequestDeadlineChange`: same relationship rule as reassignment requests.
- `canArchiveTask`: active Head and task is not archived.
- `canRestoreTask`: active Head and task is archived.

The application service repeats relationship checks before repository calls. The direct/request/archive RPCs independently validate active actor, role/relationship, task state, archive state, and active target assignee while holding the relevant task/request row lock.

## Authoritative database contract

Migration `20261015132700_sprint_10b_team_permissions_task_management.sql` adds:

- `task_archives`: one current archive marker per task (`task_id`, `archived_at`, `archived_by`, optional reason). It never changes `tasks.status`.
- `task_notification_deliveries`: semantic Telegram delivery claims, unique by `(dedupe_key, recipient_user_id)`.
- `update_task_content_with_events`: creator/Head content edit with field-specific immutable events.
- hardened `reassign_task_with_event`: creator/Head direct reassignment, active target, exactly one `ASSIGNEE_CHANGED` event.
- `change_task_deadline_with_event`: creator/Head direct deadline change with future-deadline validation.
- hardened deadline request create/resolve: ordinary assignee creates; active Head resolves; first resolution wins.
- reassign request create/resolve: ordinary assignee creates; active Head resolves; first resolution wins.
- `archive_task_with_event` / `restore_task_with_event`: Head-only and idempotent without changing workflow status.
- `tasks_prevent_hard_delete`: rejects every hard delete with `PT409`.
- `tasks_prevent_archived_update`: rejects operational updates until restore.

Direct assignee/deadline changes cancel an existing pending request for the same dimension as superseded and append an explicit cancellation event. Resolution validates the request snapshot so stale approval cannot overwrite a newer task value.

All new public tables have RLS enabled. `public`, `anon`, `authenticated`, and `service_role` are revoked first, then only the necessary `service_role` table privileges are restored. Every new public function is `SECURITY INVOKER`, has an empty search path, is revoked from browser roles, and is executable only by `service_role`.

## Server routes

- `GET /api/tasks?scope=all|my|today|overdue|review|archived`
- `GET|PATCH /api/tasks/:id`
- `POST /api/tasks/:id/reassign`
- `POST /api/tasks/:id/deadline`
- `POST /api/tasks/:id/reassign-requests`
- `POST /api/tasks/:id/deadline-requests`
- `POST /api/reassign-requests/:id/resolve`
- `POST /api/deadline-requests/:id/resolve`
- `POST /api/tasks/:id/archive`
- `POST /api/tasks/:id/restore`
- `GET /api/requests?status=PENDING|APPROVED|REJECTED|CANCELLED` (Head only)

Content OS calls these routes through the existing HMAC service boundary with
provider `CONTENT_OS_TELEGRAM_SESSION`. Its signed subject is the current
`public.users.id` obtained from the Task Bot-owned Telegram web-session RPC;
Task Bot reloads and revalidates that user before applying the same service
permissions and notification workflow as Telegram.

## Telegram and notification behavior

Deadline and reassign request buttons call the same service methods and database RPCs as Content OS. Reassign request callbacks use `reassign:<request-id>:APPROVE|REJECT`; deadline callbacks retain `deadline:<request-id>:APPROVE|REJECT`. A second callback after either channel resolved the row receives the normal conflict response and cannot append another event.

Assignment, reassignment, deadline, request, review, revision, approval, and blocked notifications use the existing `NotificationDispatcher`. Before dispatch, the service claims a semantic key in `task_notification_deliveries`. A duplicate webhook, concurrent response retry, or second transport cannot acquire the same recipient/event claim and therefore cannot resend it.

## Verification

- `scripts/test-team-permissions.sql`: PostgreSQL 17 lifecycle, authorization, RLS/grants, event, archive, hard-delete, and delivery-ledger contract.
- `scripts/test-team-permissions-concurrency.sql`: independent concurrent sessions resolve the same deadline/reassign request; exactly one returns `APPROVED`, the other returns `PT409`, and exactly one decision/change event exists.
- `npm run db:test-team-permissions`: refuses non-local database URLs before running either destructive fixture.

No production credentials, production data, deployment, push, or live migration are part of this contract.
