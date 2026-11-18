-- Montage scope is only its effort level. Older footage/output values remain intact.
create or replace function public.save_task_video_brief(
  p_task_id uuid, p_actor_id uuid, p_kind text, p_brief jsonb, p_confirm boolean default false
) returns public.task_video_briefs
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_existing public.task_video_briefs;
  v_result public.task_video_briefs;
  v_scheduled_at timestamptz;
  v_duration integer;
  v_url text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'task not found' using errcode = 'P0002'; end if;
  if v_task.status in ('DONE','CANCELLED') or
     not exists (select 1 from public.users where id = p_actor_id and is_active) then
    raise exception 'video brief is unavailable' using errcode = '42501';
  end if;
  if p_kind not in ('SHOOT','EDIT') then raise exception 'invalid video kind' using errcode = '22023'; end if;
  select * into v_existing from public.task_video_briefs where task_id = p_task_id for update;
  if v_existing.task_id is not null and v_existing.kind <> p_kind then
    raise exception 'video kind cannot change' using errcode = '22023';
  end if;
  if v_task.workflow_step_id is not null and exists (
    select 1 from public.workflow_template_steps
    where id = v_task.workflow_step_id and video_kind is not null and video_kind <> p_kind
  ) then raise exception 'workflow video kind cannot change' using errcode = '22023'; end if;

  if p_confirm then
    -- Serialize confirmations for one operator before checking overlap.
    perform 1 from public.users where id = v_task.assignee_id for update;
    if p_kind <> 'SHOOT' or p_actor_id <> v_task.assignee_id or v_existing.task_id is null or
       v_existing.scenario_url is null or v_existing.on_camera_person is null or
       v_existing.location is null or v_existing.scheduled_at is null or v_existing.duration_minutes is null or
       v_existing.scheduled_at <= statement_timestamp() then
      raise exception 'shoot brief must be complete before operator confirmation' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.task_video_briefs b join public.tasks t on t.id = b.task_id
      where b.task_id <> p_task_id and b.kind = 'SHOOT' and b.confirmed_at is not null
        and t.assignee_id = v_task.assignee_id and t.status not in ('DONE','CANCELLED')
        and b.scheduled_at < v_existing.scheduled_at + make_interval(mins => v_existing.duration_minutes)
        and v_existing.scheduled_at < b.scheduled_at + make_interval(mins => b.duration_minutes)
    ) then raise exception 'operator already has a confirmed shoot at this time' using errcode = '23505'; end if;
    update public.task_video_briefs set confirmed_by = p_actor_id, confirmed_at = statement_timestamp(),
      updated_at = statement_timestamp() where task_id = p_task_id returning * into v_result;
    update public.tasks set shoot_at = v_result.scheduled_at where id = p_task_id;
    insert into public.task_events(task_id, actor_id, event_type, new_value)
    values (p_task_id, p_actor_id, 'SHOOT_CONFIRMED', jsonb_build_object('scheduledAt', v_result.scheduled_at));
    return v_result;
  end if;

  if p_actor_id <> v_task.creator_id and p_actor_id <> v_task.assignee_id and
     not exists (select 1 from public.users where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active) then
    raise exception 'video brief edit is not allowed' using errcode = '42501';
  end if;
  if coalesce(jsonb_typeof(p_brief), '') <> 'object' then
    raise exception 'video brief is required' using errcode = '22023';
  end if;
  if p_kind = 'SHOOT' then
    if p_actor_id = v_task.assignee_id and p_actor_id <> v_task.creator_id and
       not exists (select 1 from public.users where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active) then
      raise exception 'creator proposes the shoot brief' using errcode = '42501';
    end if;
    v_url := btrim(coalesce(p_brief ->> 'scenarioUrl',''));
    if v_url !~ '^https?://[^[:space:]]+$' or char_length(v_url) > 2048 or
       char_length(btrim(coalesce(p_brief ->> 'onCameraPerson',''))) not between 1 and 200 or
       char_length(btrim(coalesce(p_brief ->> 'location',''))) not between 1 and 300 or
       coalesce(p_brief ->> 'scheduledAt','') = '' or
       coalesce(p_brief ->> 'durationMinutes','') !~ '^[0-9]{1,4}$' then
      raise exception 'shoot brief is incomplete' using errcode = '22023';
    end if;
    v_scheduled_at := (p_brief ->> 'scheduledAt')::timestamptz;
    v_duration := (p_brief ->> 'durationMinutes')::integer;
    if v_scheduled_at <= statement_timestamp() or v_duration not between 5 and 1440 then
      raise exception 'shoot time or duration is invalid' using errcode = '22023'; end if;
    insert into public.task_video_briefs(task_id, kind, scenario_url, on_camera_person, location,
      scheduled_at, duration_minutes)
    values (p_task_id, p_kind, v_url, btrim(p_brief ->> 'onCameraPerson'),
      btrim(p_brief ->> 'location'), v_scheduled_at, v_duration)
    on conflict (task_id) do update set scenario_url = excluded.scenario_url,
      on_camera_person = excluded.on_camera_person, location = excluded.location,
      scheduled_at = excluded.scheduled_at, duration_minutes = excluded.duration_minutes,
      confirmed_by = null, confirmed_at = null, updated_at = statement_timestamp()
    returning * into v_result;
    update public.tasks set shoot_at = null where id = p_task_id;
  else
    if coalesce(p_brief ->> 'editLevel','') not in ('SIMPLE','STANDARD','COMPLEX') then
      raise exception 'edit level is required' using errcode = '22023';
    end if;
    -- Preserve old footage/output values on existing tasks; new briefs only need the level.
    insert into public.task_video_briefs(task_id, kind, edit_level)
    values (p_task_id, p_kind, p_brief ->> 'editLevel')
    on conflict (task_id) do update set edit_level = excluded.edit_level,
      updated_at = statement_timestamp()
    returning * into v_result;
  end if;
  insert into public.task_events(task_id, actor_id, event_type, new_value)
  values (p_task_id, p_actor_id, 'VIDEO_BRIEF_SAVED', jsonb_build_object('kind', p_kind));
  return v_result;
end;
$$;
revoke all on function public.save_task_video_brief(uuid,uuid,text,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.save_task_video_brief(uuid,uuid,text,jsonb,boolean) to service_role;
