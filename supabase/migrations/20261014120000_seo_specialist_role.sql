-- Sprint 9A / A1: add the approved SEO_SPECIALIST team role.
-- Widens the existing users.role CHECK only. Every existing role (including
-- the legacy SMM_MANAGER) stays valid and no row is touched. The constraint
-- keeps its live name, users_role_check (verified by the 2026-10-14
-- read-only catalog audit). Rollback: supabase/rollbacks/20261014120000_seo_specialist_role.down.sql

alter table public.users drop constraint users_role_check;

alter table public.users add constraint users_role_check check (
  role in (
    'OPERATOR_VIDEO_EDITOR',
    'CONTENT_MARKETER',
    'DIGITAL_MARKETER',
    'SMM_MANAGER',
    'SEO_SPECIALIST',
    'HEAD_OF_MARKETING'
  )
);
