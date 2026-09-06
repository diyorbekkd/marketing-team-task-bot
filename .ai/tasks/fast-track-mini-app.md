# Fast-track Mini App worker task

## Owner and isolation

- Worker: Claude Sonnet in an isolated worktree/branch.
- Codex remains integrator and owns APIs, auth, database, CSP, and deployment.
- Modify only the files listed below. Do not modify package files or add dependencies.

## Allowed files

- `src/app/page.tsx`
- `src/app/globals.css`
- `src/components/mini-app/**` (new)
- `src/types/telegram-webapp.d.ts` (new, only if needed)

## Goal

Replace the Sprint 0 placeholder with a polished but practical mobile-first Telegram Mini App. It must work through the existing server API and remain usable in a normal desktop browser for visual/local development.

Required views and behavior:

1. Authenticate on mount by POSTing `{ initData: window.Telegram?.WebApp?.initData }` to `/api/auth/telegram`. If initData is absent, first try `/api/auth/me` so an existing local/session browser can load; otherwise show a clear “Open this app from Telegram” state.
2. Load `/api/users` and `/api/tasks?scope=...` using same-origin cookies.
3. Provide My Tasks, Today, Overdue, and (Head only) Team Tasks filters.
4. Provide List and simple Kanban modes. Kanban groups the canonical statuses without drag-and-drop.
5. Open a Task Detail panel/modal from a task card using `/api/tasks/:id`, showing description, deadline, assignee/creator names, blocked reason, events, and deadline requests.
6. Provide Quick Add with title, assignee, deadline, priority, and optional description. Convert a `datetime-local` value into an offset-bearing ISO value before POST `/api/tasks`.
7. Provide workflow controls based on current status and user relationship: accept, block (prompt/inline reason), resume, submit review, approve, request revision, cancel, reopen (Head). POST `/api/tasks/:id/actions` and refresh.
8. Assignee can request a deadline change with date/time and reason via `/api/tasks/:id/deadline-requests`. Creator/Head can approve/reject pending requests via `/api/deadline-requests/:id/resolve`.
9. Head sees pending users returned by `/api/users` and can activate them with a selected role via `/api/users/:id/activate`.
10. Use loading, empty, error, and pending-action states. Keep buttons accessible, labels explicit, keyboard focus visible, and respect reduced motion.

## Existing API shapes

- Auth success: `{ user }`; errors: `{ error, code, issues? }`.
- Users: `{ users: User[] }`.
- Tasks: `{ tasks: Task[] }`; create/action: `{ task }`.
- Detail: `{ task, events, deadlineRequests }`.
- Task fields are camelCase; statuses are `ASSIGNED`, `IN_PROGRESS`, `BLOCKED`, `REVIEW`, `REVISION`, `DONE`, `CANCELLED`.
- User roles are `OPERATOR_VIDEO_EDITOR`, `CONTENT_MARKETER`, `DIGITAL_MARKETER`, `SMM_MANAGER`, `HEAD_OF_MARKETING`.

## Design direction

Keep the existing warm editorial character, but make it a dense usable operations dashboard. Mobile width is primary, desktop may widen to a two-column layout. Avoid generic purple SaaS styling, excessive gradients, and decorative animations. Do not use external images or fonts.

## Verification and delivery

- Run `npm run typecheck`, `npm run lint`, and `npm run build`.
- Commit all allowed-file changes on the worker branch with a clear commit message.
- Report the commit hash and any remaining limitation.
