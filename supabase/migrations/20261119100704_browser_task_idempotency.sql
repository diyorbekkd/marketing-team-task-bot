-- One browser operation creates at most one task, including video briefs and
-- checkpoint templates. The request row and task commit in the same RPC.
create table public.browser_task_requests (
  request_id uuid primary key,
  actor_id uuid not null references public.users(id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  task_id uuid unique references public.tasks(id) on delete restrict,
  created_at timestamptz not null default now()
);

create function public.create_browser_task(
  p_request_id uuid, p_request_hash text,
  p_creator_id uuid, p_assignee_id uuid, p_title text, p_description text,
  p_priority text, p_deadline timestamptz,
  p_video_kind text, p_video_brief jsonb,
  p_template_id uuid, p_event_on date, p_deadline_override boolean
) returns public.tasks
language plpgsql security invoker set search_path = '' as $$
declare
  v_reserved uuid;
  v_request public.browser_task_requests;
  v_task public.tasks;
begin
  if p_request_id is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid browser request identity' using errcode = '22023';
  end if;
  if (p_video_kind is null) <> (p_video_brief is null)
     or (p_template_id is null) <> (p_event_on is null)
     or (p_video_kind is not null and p_template_id is not null) then
    raise exception 'invalid browser task kind' using errcode = '22023';
  end if;

  insert into public.browser_task_requests(request_id, actor_id, request_hash)
    values(p_request_id, p_creator_id, p_request_hash)
    on conflict (request_id) do nothing returning request_id into v_reserved;
  if v_reserved is null then
    select * into v_request from public.browser_task_requests where request_id = p_request_id;
    if v_request.actor_id is distinct from p_creator_id or v_request.request_hash is distinct from p_request_hash then
      raise exception 'browser request id belongs to a different operation' using errcode = '23505';
    end if;
    select * into v_task from public.tasks where id = v_request.task_id;
    if v_task.id is null then
      raise exception 'browser task request is incomplete' using errcode = '40001';
    end if;
    return v_task;
  end if;

  if p_template_id is not null then
    select * into v_task from public.create_task_from_template(
      p_creator_id, p_assignee_id, p_template_id, p_event_on,
      p_title, p_description, p_priority,
      case when p_deadline_override then p_deadline else null::timestamptz end);
  elsif p_video_kind is not null then
    select * into v_task from public.create_task_with_video_brief(
      p_creator_id, p_assignee_id, p_title, p_description,
      p_priority, p_deadline, p_video_kind, p_video_brief);
  else
    select * into v_task from public.create_task_with_event_v2(
      p_creator_id, p_assignee_id, p_title, p_description,
      p_priority, p_deadline, null::bigint, null::uuid, null::timestamptz);
  end if;
  update public.browser_task_requests set task_id = v_task.id where request_id = p_request_id;
  return v_task;
end;
$$;

alter table public.browser_task_requests enable row level security;
revoke all on table public.browser_task_requests from public, anon, authenticated;
grant select, insert, update on table public.browser_task_requests to service_role;
revoke all on function public.create_browser_task(uuid,text,uuid,uuid,text,text,text,timestamptz,text,jsonb,uuid,date,boolean)
  from public, anon, authenticated;
grant execute on function public.create_browser_task(uuid,text,uuid,uuid,text,text,text,timestamptz,text,jsonb,uuid,date,boolean)
  to service_role;
