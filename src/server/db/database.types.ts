export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type UserRow = {
  id: string;
  telegram_user_id: number | string;
  telegram_username: string | null;
  display_name: string;
  role: "OPERATOR_VIDEO_EDITOR" | "CONTENT_MARKETER" | "DIGITAL_MARKETER" | "SMM_MANAGER" | "HEAD_OF_MARKETING";
  is_active: boolean;
  deactivated_at: string | null;
  deactivated_by: string | null;
  created_at: string;
  updated_at: string;
}

type UserEventRow = {
  id: string;
  user_id: string;
  actor_id: string | null;
  event_type: "USER_ACTIVATED" | "USER_DEACTIVATED" | "USER_REACTIVATED" | "USER_ROLE_CHANGED";
  old_value: Json | null;
  new_value: Json | null;
  metadata: Json;
  created_at: string;
}

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  priority: "high" | "normal" | "low";
  status: "ASSIGNED" | "IN_PROGRESS" | "BLOCKED" | "REVIEW" | "REVISION" | "DONE" | "CANCELLED";
  creator_id: string;
  assignee_id: string;
  deadline: string;
  publication_at: string | null;
  blocked_reason: string | null;
  source_telegram_update_id: number | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  recurring_definition_id: string | null;
  scheduled_occurrence_at: string | null;
  workflow_run_id: string | null;
  workflow_step_id: string | null;
  participant_ids: string[];
  workflow_next_deadline: string | null;
}

type WorkflowTemplateRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

type WorkflowTemplateStepRow = {
  id: string;
  template_id: string;
  position: number;
  title: string;
  description: string | null;
  assignee_role: UserRow["role"];
  priority: TaskRow["priority"];
  due_after_hours: number;
  estimated_minutes: number | null;
  checkpoint_titles: string[];
}

type WorkflowRunRow = {
  id: string;
  template_id: string;
  created_by: string;
  subject: string;
  assignee_map: Json;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  current_position: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  step_assignments: Json | null;
}

type AssistantTurnRow = {
  id: string;
  user_id: string;
  request_key: string;
  source: "WEB" | "TELEGRAM";
  user_text: string;
  answer_text: string | null;
  status: "PENDING" | "COMPLETE" | "FAILED";
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  completed_at: string | null;
}

type TaskCommentRow = {
  id: string;
  task_id: string;
  author_id: string;
  kind: "COMMENT" | "RESULT";
  body: string | null;
  attachment_url: string | null;
  created_at: string;
}

type TaskEventRow = {
  id: string;
  task_id: string;
  actor_id: string | null;
  actor_kind: "USER" | "SYSTEM";
  event_type: string;
  old_value: Json | null;
  new_value: Json | null;
  metadata: Json;
  created_at: string;
}

type UserTaskPlanRow = {
  user_id: string;
  task_id: string;
  is_important: boolean | null;
  urgent_override: boolean | null;
  planned_on: string | null;
  estimated_minutes: number | null;
  created_at: string;
  updated_at: string;
}

type TaskCheckpointRow = {
  id: string;
  task_id: string;
  title: string;
  due_at: string | null;
  position: number;
  created_by: string;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

type WebLoginChallengeRow = {
  id: string;
  browser_hash: string;
  code_hash: string;
  status: "PENDING" | "APPROVED" | "CONSUMED";
  user_id: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
}

type DeadlineRequestRow = {
  id: string;
  task_id: string;
  requested_by: string;
  current_deadline: string;
  requested_deadline: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

type ReassignRequestRow = {
  id: string;
  task_id: string;
  requested_by: string;
  current_assignee_id: string;
  requested_assignee_id: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

type RevisionRow = {
  id: string;
  task_id: string;
  requested_by: string;
  reason: string | null;
  created_at: string;
}

type RecurringDefinitionRow = {
  id: string;
  source_task_id: string;
  created_by: string;
  title: string;
  description: string | null;
  priority: TaskRow["priority"];
  assignee_id: string;
  frequency: "WEEKDAYS" | "WEEKLY" | "MONTHLY";
  weekday: number | null;
  day_of_month: number | null;
  local_time: string;
  timezone: "Asia/Tashkent";
  ends_on: string | null;
  status: "ACTIVE" | "PAUSED" | "STOPPED";
  next_occurrence_at: string | null;
  pause_reason: string | null;
  created_at: string;
  updated_at: string;
}

type ChecklistRow = { id: string; task_id: string; kind: "POSTING"; created_at: string }
type ChecklistItemRow = {
  id: string;
  checklist_id: string;
  label: string;
  position: number;
  is_completed: boolean;
  completed_by: string | null;
  completed_at: string | null;
}
type ReportDeliveryRow = {
  id: string;
  report_type: "DAILY_MORNING" | "DAILY_EVENING" | "WEEKLY";
  interval_key: string;
  recipient_user_id: string;
  status: "CLAIMED" | "SENT" | "FAILED" | "SKIPPED";
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
  attempt_count: number;
  next_attempt_at: string;
  claimed_at: string | null;
}

type ReminderDeliveryRow = {
  id: string;
  task_id: string;
  deadline: string;
  reminder_type: "H24_BEFORE" | "H3_BEFORE" | "AT_DEADLINE" | "H1_OVERDUE" | "H24_OVERDUE";
  status: "CLAIMED" | "SENT" | "FAILED";
  failure_reason: string | null;
  metadata: Json;
  created_at: string;
  completed_at: string | null;
  attempt_count: number;
  next_attempt_at: string;
  claimed_at: string | null;
}

type NotificationOutboxRow = {
  id: string;
  dedupe_key: string;
  notification_type: "ASSIGNMENT" | "BULK_ASSIGNMENT" | "WORKFLOW" | "REPORT";
  recipient_user_id: string;
  task_id: string | null;
  payload: Json;
  status: "PENDING" | "CLAIMED" | "SENT" | "FAILED";
  attempt_count: number;
  next_attempt_at: string;
  claimed_at: string | null;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

type NotificationPreferencesRow = {
  user_id: string;
  assignments: boolean;
  workflow: boolean;
  reminders: boolean;
  daily_check: boolean;
  reports: boolean;
  created_at: string;
  updated_at: string;
}

type TableDefinition<Row> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      users: TableDefinition<UserRow>;
      tasks: TableDefinition<TaskRow>;
      task_events: TableDefinition<TaskEventRow>;
      task_comments: TableDefinition<TaskCommentRow>;
      user_task_plans: TableDefinition<UserTaskPlanRow>;
      task_checkpoints: TableDefinition<TaskCheckpointRow>;
      web_login_challenges: TableDefinition<WebLoginChallengeRow>;
      deadline_change_requests: TableDefinition<DeadlineRequestRow>;
      reassign_requests: TableDefinition<ReassignRequestRow>;
      task_revisions: TableDefinition<RevisionRow>;
      recurring_definitions: TableDefinition<RecurringDefinitionRow>;
      task_checklists: TableDefinition<ChecklistRow>;
      task_checklist_items: TableDefinition<ChecklistItemRow>;
      report_deliveries: TableDefinition<ReportDeliveryRow>;
      user_events: TableDefinition<UserEventRow>;
      task_reminder_deliveries: TableDefinition<ReminderDeliveryRow>;
      notification_outbox: TableDefinition<NotificationOutboxRow>;
      user_notification_preferences: TableDefinition<NotificationPreferencesRow>;
      workflow_templates: TableDefinition<WorkflowTemplateRow>;
      workflow_template_steps: TableDefinition<WorkflowTemplateStepRow>;
      workflow_runs: TableDefinition<WorkflowRunRow>;
      assistant_turns: TableDefinition<AssistantTurnRow>;
    };
    Views: Record<never, never>;
    Functions: {
      claim_assistant_turn: {
        Args: { p_user_id: string; p_request_key: string; p_source: string; p_user_text: string };
        Returns: Json;
      };
      finish_assistant_turn: {
        Args: { p_turn_id: string; p_user_id: string; p_answer_text: string | null;
          p_input_tokens: number | null; p_output_tokens: number | null };
        Returns: AssistantTurnRow;
      };
      register_telegram_user: {
        Args: {
          p_telegram_user_id: string;
          p_telegram_username: string;
          p_display_name: string;
          p_expected_head_telegram_user_id: string;
        };
        Returns: UserRow;
      };
      create_task_with_event: {
        Args: {
          p_creator_id: string;
          p_assignee_id: string;
          p_title: string;
          p_description: string;
          p_priority: "high" | "normal" | "low";
          p_deadline: string;
          p_source_telegram_update_id: number | null;
        };
        Returns: TaskRow;
      };
      create_task_with_event_v2: {
        Args: {
          p_creator_id: string;
          p_assignee_id: string;
          p_title: string;
          p_description: string;
          p_priority: "high" | "normal" | "low";
          p_deadline: string;
          p_source_telegram_update_id: number | null;
          p_recurring_definition_id: string | null;
          p_scheduled_occurrence_at: string | null;
        };
        Returns: TaskRow;
      };
      update_task_with_events: {
        Args: { p_task_id: string; p_actor_id: string; p_patch: Json };
        Returns: TaskRow;
      };
      add_task_comment_with_event: {
        Args: {
          p_task_id: string;
          p_author_id: string;
          p_kind: "COMMENT" | "RESULT";
          p_body: string | null;
          p_attachment_url: string | null;
        };
        Returns: TaskCommentRow;
      };
      enqueue_notification_outbox: {
        Args: {
          p_dedupe_key: string;
          p_notification_type: NotificationOutboxRow["notification_type"];
          p_recipient_user_id: string;
          p_task_id: string | null;
          p_payload: Json;
        };
        Returns: NotificationOutboxRow;
      };
      claim_notification_outbox: { Args: { p_id: string }; Returns: boolean };
      claim_due_notification_outbox: { Args: { p_limit: number }; Returns: NotificationOutboxRow[] };
      complete_notification_outbox: {
        Args: { p_id: string; p_sent: boolean; p_error: string | null };
        Returns: undefined;
      };
      claim_report_delivery: {
        Args: { p_report_type: string; p_interval_key: string; p_recipient_user_id: string };
        Returns: boolean;
      };
      complete_report_delivery: {
        Args: {
          p_report_type: string;
          p_interval_key: string;
          p_recipient_user_id: string;
          p_status: string;
          p_failure_reason: string | null;
        };
        Returns: undefined;
      };
      claim_task_reminder_delivery: {
        Args: { p_task_id: string; p_deadline: string; p_reminder_type: string };
        Returns: Json;
      };
      complete_task_reminder_delivery: {
        Args: {
          p_task_id: string;
          p_deadline: string;
          p_reminder_type: string;
          p_status: string;
          p_failure_reason: string | null;
          p_metadata: Json;
        };
        Returns: undefined;
      };
      update_user_notification_preferences: {
        Args: {
          p_user_id: string;
          p_assignments: boolean;
          p_workflow: boolean;
          p_reminders: boolean;
          p_daily_check: boolean;
          p_reports: boolean;
        };
        Returns: NotificationPreferencesRow;
      };
      start_workflow_run: {
        Args: { p_template_id: string; p_actor_id: string; p_subject: string; p_assignee_map: Json };
        Returns: TaskRow;
      };
      start_workflow_run_v2: {
        Args: { p_template_id: string; p_actor_id: string; p_subject: string; p_first_deadline: string; p_step_assignments: Json };
        Returns: TaskRow;
      };
      submit_workflow_step_for_review: {
        Args: { p_task_id: string; p_actor_id: string; p_next_deadline: string | null };
        Returns: TaskRow;
      };
      complete_self_owned_task: {
        Args: { p_task_id: string; p_actor_id: string; p_next_deadline: string | null };
        Returns: TaskRow;
      };
      save_workflow_template_version: {
        Args: {
          p_actor_id: string;
          p_source_template_id: string | null;
          p_name: string;
          p_description: string | null;
          p_steps: Json;
        };
        Returns: string;
      };
      advance_workflow_run: {
        Args: { p_completed_task_id: string; p_actor_id: string };
        Returns: TaskRow | null;
      };
      recover_workflow_runs: { Args: Record<never, never>; Returns: TaskRow[] };
      toggle_posting_checklist_item: {
        Args: { p_item_id: string; p_actor_id: string };
        Returns: ChecklistItemRow;
      };
      add_task_checkpoint_with_event: {
        Args: { p_task_id: string; p_actor_id: string; p_title: string; p_due_at: string | null };
        Returns: TaskCheckpointRow;
      };
      toggle_task_checkpoint_with_event: {
        Args: { p_checkpoint_id: string; p_actor_id: string };
        Returns: TaskCheckpointRow;
      };
      remove_task_checkpoint_with_event: {
        Args: { p_checkpoint_id: string; p_actor_id: string };
        Returns: undefined;
      };
      generate_recurring_task: {
        Args: { p_definition_id: string; p_scheduled_occurrence_at: string; p_next_occurrence_at: string | null };
        Returns: TaskRow;
      };
      transition_task_with_events: {
        Args: { p_task_id: string; p_actor_id: string; p_new_status: TaskRow["status"]; p_reason: string | null };
        Returns: TaskRow;
      };
      create_deadline_change_request_with_event: {
        Args: { p_task_id: string; p_requested_by: string; p_requested_deadline: string; p_reason: string };
        Returns: DeadlineRequestRow;
      };
      resolve_deadline_change_request_with_events: {
        Args: {
          p_request_id: string;
          p_resolved_by: string;
          p_approve: boolean;
          p_resolution_note: string | null;
        };
        Returns: DeadlineRequestRow;
      };
      activate_user_with_event: {
        Args: { p_user_id: string; p_actor_id: string; p_role: UserRow["role"] };
        Returns: UserRow;
      };
      update_user_role_with_event: {
        Args: { p_user_id: string; p_actor_id: string; p_role: UserRow["role"] };
        Returns: UserRow;
      };
      deactivate_user_with_event: {
        Args: { p_user_id: string; p_actor_id: string };
        Returns: UserRow;
      };
      reactivate_user_with_event: {
        Args: { p_user_id: string; p_actor_id: string };
        Returns: UserRow;
      };
      reassign_task_with_event: {
        Args: { p_task_id: string; p_new_assignee_id: string; p_actor_id: string };
        Returns: TaskRow;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
