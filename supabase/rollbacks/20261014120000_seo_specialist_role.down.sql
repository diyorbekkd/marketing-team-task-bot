-- Rollback for 20261014120000_seo_specialist_role.sql. NOT a migration.
-- Refuses to run while any user holds SEO_SPECIALIST, so rolling back can
-- never rewrite or delete existing team data. Reassign those users through
-- the normal role-edit flow first.

do $$
begin
  if exists (select 1 from public.users where role = 'SEO_SPECIALIST') then
    raise exception 'cannot roll back SEO_SPECIALIST: % user(s) still hold the role',
      (select count(*) from public.users where role = 'SEO_SPECIALIST')
      using errcode = '55000';
  end if;
end $$;

alter table public.users drop constraint users_role_check;

alter table public.users add constraint users_role_check check (
  role in (
    'OPERATOR_VIDEO_EDITOR',
    'CONTENT_MARKETER',
    'DIGITAL_MARKETER',
    'SMM_MANAGER',
    'HEAD_OF_MARKETING'
  )
);
