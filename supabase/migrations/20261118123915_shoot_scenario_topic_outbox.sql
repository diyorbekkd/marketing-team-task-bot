-- A forum topic is a delivery target, not a team member. Reuse the bounded
-- notification retry queue without inventing a recipient user for the group.
alter table public.notification_outbox
  drop constraint notification_outbox_notification_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_notification_type_check
    check (notification_type in ('ASSIGNMENT', 'BULK_ASSIGNMENT', 'WORKFLOW', 'REPORT', 'SHOOT_SCENARIO'));
alter table public.notification_outbox
  alter column recipient_user_id drop not null;
alter table public.notification_outbox
  add constraint notification_outbox_recipient_check
    check (
      (notification_type = 'SHOOT_SCENARIO' and recipient_user_id is null and task_id is not null)
      or (notification_type <> 'SHOOT_SCENARIO' and recipient_user_id is not null)
    );

create function public.enqueue_shoot_scenario_notification(
  p_dedupe_key text, p_task_id uuid, p_payload jsonb
) returns public.notification_outbox
language plpgsql security invoker set search_path = '' as $$
declare
  v_row public.notification_outbox;
begin
  if coalesce(p_payload ->> 'kind', '') <> 'SHOOT_SCENARIO' or
     coalesce(jsonb_typeof(p_payload -> 'input'), '') <> 'object' or
     not exists (select 1 from public.task_video_briefs
                 where task_id = p_task_id and kind = 'SHOOT') then
    raise exception 'invalid shoot scenario notification' using errcode = '22023';
  end if;

  insert into public.notification_outbox (
    dedupe_key, notification_type, recipient_user_id, task_id, payload
  ) values (p_dedupe_key, 'SHOOT_SCENARIO', null, p_task_id, p_payload)
  on conflict (dedupe_key) do update
    set dedupe_key = excluded.dedupe_key
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.enqueue_shoot_scenario_notification(text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_shoot_scenario_notification(text,uuid,jsonb)
  to service_role;
