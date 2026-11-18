-- A standalone video task and its mandatory brief are one audited transaction.
create function public.create_task_with_video_brief(
  p_creator_id uuid, p_assignee_id uuid, p_title text, p_description text,
  p_priority text, p_deadline timestamptz, p_video_kind text, p_video_brief jsonb
) returns public.tasks
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
begin
  if not exists (
    select 1 from public.users where id = p_assignee_id
      and is_active and role = 'OPERATOR_VIDEO_EDITOR'
  ) then
    raise exception 'video task requires active operator' using errcode = '22023';
  end if;
  if p_video_kind not in ('SHOOT', 'EDIT') then
    raise exception 'invalid video kind' using errcode = '22023';
  end if;

  select * into v_task from public.create_task_with_event_v2(
    p_creator_id, p_assignee_id, p_title, p_description, p_priority, p_deadline,
    null, null, null
  );
  perform public.save_task_video_brief(
    v_task.id, p_creator_id, p_video_kind, p_video_brief, false
  );
  return v_task;
end;
$$;
revoke all on function public.create_task_with_video_brief(uuid,uuid,text,text,text,timestamptz,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_task_with_video_brief(uuid,uuid,text,text,text,timestamptz,text,jsonb)
  to service_role;
