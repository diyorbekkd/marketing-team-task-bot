-- Sprint 9A / A4: least-privilege hardening of the 12 operational tables.
--
-- The live Supabase project's default privileges for new public tables owned
-- by postgres also give anon / authenticated / service_role TRUNCATE,
-- REFERENCES, TRIGGER and MAINTAIN. The foundation migration only revoked the
-- default SELECT/INSERT/UPDATE/DELETE, and every table migration revoked ALL
-- from public/anon/authenticated but never from service_role, so service_role
-- kept those four extra privileges on every operational table.
--
-- This migration resets service_role to EXACTLY the grants the existing
-- migration set already intends (no new privilege model):
--   users, tasks, deadline_change_requests, reassign_requests,
--   recurring_definitions                      SELECT, INSERT, UPDATE, DELETE
--   task_events, user_events, task_revisions,
--   task_checklists                            SELECT, INSERT
--   task_checklist_items, report_deliveries,
--   task_reminder_deliveries                   SELECT, INSERT, UPDATE
-- anon / authenticated / public grants are not touched (already none).
-- Default privileges are not changed here (separate owner decision).
-- Rollback: supabase/rollbacks/20261014120100_harden_service_role_table_privileges.down.sql

revoke all on table
  public.users, public.tasks, public.task_events, public.deadline_change_requests,
  public.reassign_requests, public.task_revisions, public.recurring_definitions,
  public.task_checklists, public.task_checklist_items, public.report_deliveries,
  public.user_events, public.task_reminder_deliveries
  from service_role;

grant select, insert, update, delete on table
  public.users, public.tasks, public.deadline_change_requests,
  public.reassign_requests, public.recurring_definitions
  to service_role;

grant select, insert on table
  public.task_events, public.user_events, public.task_revisions, public.task_checklists
  to service_role;

grant select, insert, update on table
  public.task_checklist_items, public.report_deliveries, public.task_reminder_deliveries
  to service_role;
