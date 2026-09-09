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
  blocked_reason: string | null;
  source_telegram_update_id: number | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  recurring_definition_id: string | null;
  scheduled_occurrence_at: string | null;
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
      deadline_change_requests: TableDefinition<DeadlineRequestRow>;
      reassign_requests: TableDefinition<ReassignRequestRow>;
      task_revisions: TableDefinition<RevisionRow>;
      recurring_definitions: TableDefinition<RecurringDefinitionRow>;
      task_checklists: TableDefinition<ChecklistRow>;
      task_checklist_items: TableDefinition<ChecklistItemRow>;
      report_deliveries: TableDefinition<ReportDeliveryRow>;
      user_events: TableDefinition<UserEventRow>;
      task_reminder_deliveries: TableDefinition<ReminderDeliveryRow>;
    };
    Views: Record<never, never>;
    Functions: {
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
      toggle_posting_checklist_item: {
        Args: { p_item_id: string; p_actor_id: string };
        Returns: ChecklistItemRow;
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
