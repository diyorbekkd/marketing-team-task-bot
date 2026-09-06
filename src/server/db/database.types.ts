export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type UserRow = {
  id: string;
  telegram_user_id: number | string;
  telegram_username: string | null;
  display_name: string;
  role: "OPERATOR_VIDEO_EDITOR" | "CONTENT_MARKETER" | "DIGITAL_MARKETER" | "SMM_MANAGER" | "HEAD_OF_MARKETING";
  is_active: boolean;
  created_at: string;
  updated_at: string;
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
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
