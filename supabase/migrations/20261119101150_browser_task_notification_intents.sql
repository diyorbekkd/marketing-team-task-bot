-- The browser request row is committed in the same transaction as the task.
-- An unqueued notification can therefore be recovered after an app crash or
-- a transient Data API error, even when the initial enqueue never happened.
alter table public.browser_task_requests
  add column notification_queued_at timestamptz;

create index browser_task_requests_notification_due_idx
  on public.browser_task_requests(created_at)
  where task_id is not null and notification_queued_at is null;
