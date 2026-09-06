-- Telegram usernames may be renamed or reassigned. Claim the currently proven
-- username during onboarding and keep assignee lookup unambiguous.

create unique index users_telegram_username_unique_idx
  on public.users ((lower(telegram_username)))
  where telegram_username is not null;

create function private.claim_telegram_username()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_should_claim boolean := tg_op = 'INSERT';
begin
  if tg_op = 'UPDATE' then
    v_should_claim := old.telegram_username is distinct from new.telegram_username;
  end if;

  if new.telegram_username is not null and v_should_claim then
    update public.users
    set telegram_username = null
    where id <> new.id
      and lower(telegram_username) = lower(new.telegram_username);
  end if;
  return new;
end;
$$;

create trigger users_claim_telegram_username
before insert or update of telegram_username on public.users
for each row execute function private.claim_telegram_username();

comment on index public.users_telegram_username_unique_idx is
  'Current Telegram usernames are unique conveniences; stable identity remains telegram_user_id.';
