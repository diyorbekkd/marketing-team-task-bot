-- Supports cursor-paginated task lists, server-side filters, task detail
-- requests, and the bounded deadline-reminder sweep. These are ordinary
-- transactional indexes so the migration remains compatible with Supabase's
-- migration runner; the current production tables are small enough that an
-- online CONCURRENTLY build is unnecessary.

create index if not exists tasks_deadline_id_idx
  on public.tasks (deadline, id);

create index if not exists tasks_created_at_id_idx
  on public.tasks (created_at desc, id desc);

create index if not exists tasks_assignee_deadline_id_idx
  on public.tasks (assignee_id, deadline, id);

create index if not exists tasks_creator_deadline_id_idx
  on public.tasks (creator_id, deadline, id);

create index if not exists tasks_priority_deadline_id_idx
  on public.tasks (priority, deadline, id);

create index if not exists deadline_change_requests_task_created_at_idx
  on public.deadline_change_requests (task_id, created_at desc, id desc);
