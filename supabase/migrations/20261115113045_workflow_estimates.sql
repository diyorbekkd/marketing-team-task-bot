-- Preserve the old template durations as planning estimates. New workflow
-- runs never use this value as a deadline.
update public.workflow_template_steps
set estimated_minutes = least(10080, due_after_hours * 60)
where estimated_minutes is null;
