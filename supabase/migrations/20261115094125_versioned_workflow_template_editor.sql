-- Saving a template creates a new immutable version. Existing runs keep their
-- original template and step IDs; only future runs use the replacement.
create function public.save_workflow_template_version(
  p_actor_id uuid,
  p_source_template_id uuid,
  p_name text,
  p_description text,
  p_steps jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_step record;
begin
  if not exists (
    select 1 from public.users
    where id = p_actor_id and role = 'HEAD_OF_MARKETING' and is_active
  ) then
    raise exception 'only Head may save workflow templates' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 120 or
     char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'invalid workflow template details' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_steps), '') <> 'array' then
    raise exception 'workflow steps must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_steps) not between 1 and 50 then
    raise exception 'workflow must have 1 to 50 steps' using errcode = '22023';
  end if;
  if p_source_template_id is not null then
    perform 1 from public.workflow_templates
    where id = p_source_template_id and is_active for update;
    if not found then
      raise exception 'active source template not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.workflow_templates (id, slug, name, description, is_system, created_by)
  values (v_id, 'custom-' || v_id::text, btrim(p_name), nullif(btrim(p_description), ''), false, p_actor_id);

  for v_step in select value, ordinality from jsonb_array_elements(p_steps) with ordinality loop
    if jsonb_typeof(v_step.value) <> 'object' or
       char_length(btrim(coalesce(v_step.value ->> 'title', ''))) not between 1 and 200 or
       char_length(coalesce(v_step.value ->> 'description', '')) > 5000 or
       coalesce(v_step.value ->> 'assigneeRole', '') not in (
         'OPERATOR_VIDEO_EDITOR', 'CONTENT_MARKETER', 'DIGITAL_MARKETER', 'SMM_MANAGER', 'HEAD_OF_MARKETING'
       ) or
       coalesce(v_step.value ->> 'priority', '') not in ('high', 'normal', 'low') or
       coalesce(v_step.value ->> 'dueAfterHours', '') !~ '^[0-9]{1,3}$' or
       (v_step.value ->> 'dueAfterHours')::integer not between 1 and 720 then
      raise exception 'invalid workflow step' using errcode = '22023';
    end if;
    insert into public.workflow_template_steps
      (template_id, position, title, description, assignee_role, priority, due_after_hours)
    values (
      v_id, v_step.ordinality, btrim(v_step.value ->> 'title'),
      nullif(btrim(v_step.value ->> 'description'), ''),
      v_step.value ->> 'assigneeRole', v_step.value ->> 'priority',
      (v_step.value ->> 'dueAfterHours')::integer
    );
  end loop;

  if p_source_template_id is not null then
    update public.workflow_templates set is_active = false where id = p_source_template_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_workflow_template_version(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_workflow_template_version(uuid, uuid, text, text, jsonb) to service_role;
