-- Rollback for 20261014120100_harden_service_role_table_privileges.sql.
-- NOT a migration. Restores the pre-hardening service_role privileges as
-- observed on live (repo-intended grants + the Supabase-default TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN). Privilege-only: no data is touched.
-- Rolling back re-opens the least-privilege gap; prefer fixing forward.

grant truncate, references, trigger, maintain on table
  public.users, public.tasks, public.task_events, public.deadline_change_requests,
  public.reassign_requests, public.task_revisions, public.recurring_definitions,
  public.task_checklists, public.task_checklist_items, public.report_deliveries,
  public.user_events, public.task_reminder_deliveries
  to service_role;
