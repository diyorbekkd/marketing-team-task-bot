-- Unlike the interactive toggle, assistant confirmations only complete a checkpoint.
-- Locking the task and checkpoint makes a repeated confirmation a no-op.
create function public.complete_task_checkpoint_with_event(p_checkpoint_id uuid, p_actor_id uuid)
returns public.task_checkpoints
language plpgsql security invoker set search_path = '' as $$
declare
  v_task public.tasks;
  v_actor public.users;
  v_checkpoint public.task_checkpoints;
begin
  select * into v_actor from public.users where id = p_actor_id and is_active;
  select t.* into v_task from public.tasks t join public.task_checkpoints c on c.task_id = t.id
    where c.id = p_checkpoint_id for update of t;
  if v_actor.id is null or v_task.id is null or
     (v_actor.role <> 'HEAD_OF_MARKETING' and v_task.creator_id <> p_actor_id and v_task.assignee_id <> p_actor_id) then
    raise exception 'checkpoint actor is not authorized' using errcode = '42501';
  end if;
  select * into v_checkpoint from public.task_checkpoints where id = p_checkpoint_id for update;
  if v_checkpoint.id is null then raise exception 'checkpoint not found' using errcode = 'P0002'; end if;
  if v_checkpoint.completed_at is not null then return v_checkpoint; end if;
  update public.task_checkpoints set completed_by = p_actor_id, completed_at = statement_timestamp()
    where id = p_checkpoint_id returning * into v_checkpoint;
  insert into public.task_events (task_id, actor_id, event_type, old_value, new_value, metadata)
  values (v_task.id, p_actor_id, 'CHECKPOINT_COMPLETED', 'false'::jsonb, 'true'::jsonb,
    jsonb_build_object('checkpointId', p_checkpoint_id, 'title', v_checkpoint.title));
  return v_checkpoint;
end;
$$;

revoke all on function public.complete_task_checkpoint_with_event(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_task_checkpoint_with_event(uuid, uuid) to service_role;
