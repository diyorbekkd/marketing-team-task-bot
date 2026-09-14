import type { DeadlineChangeRequest, Task, User } from "@/domain/models";
import type { ReminderType } from "@/domain/reminders";

export type NotificationFailureReason = "RECIPIENT_NOT_ONBOARDED" | "DELIVERY_FAILED";

export type AssignmentNotificationResult =
  | { readonly status: "SENT" }
  | {
      readonly status: "FAILED";
      readonly reason: "ASSIGNEE_NOT_ONBOARDED" | "DELIVERY_FAILED";
    };

export interface AssignmentNotificationInput {
  readonly task: Task;
  readonly creator: User;
  readonly assignee: User;
}

/** Sent instead of several individual notifyAssignment calls when one bulk
 * Telegram message assigns more than one task to the same person. */
export interface BulkAssignmentNotificationInput {
  readonly tasks: readonly Task[];
  readonly creator: User;
  readonly assignee: User;
}

export type WorkflowNotificationEvent =
  | "DEADLINE_CHANGE_REQUESTED"
  | "DEADLINE_CHANGE_APPROVED"
  | "DEADLINE_CHANGE_REJECTED"
  | "REVIEW_REQUESTED"
  | "TASK_ACCEPTED"
  | "TASK_COMPLETED"
  | "REVISION_REQUESTED"
  | "TASK_BLOCKED";

export interface WorkflowNotificationInput {
  readonly event: WorkflowNotificationEvent;
  readonly task: Task;
  readonly actor: User;
  readonly recipients: readonly User[];
  readonly deadlineRequest?: DeadlineChangeRequest;
  readonly comment?: string;
}

export type WorkflowNotificationDelivery =
  | {
      readonly recipientUserId: string;
      readonly status: "SENT";
    }
  | {
      readonly recipientUserId: string;
      readonly status: "FAILED";
      readonly reason: NotificationFailureReason;
    };

export interface WorkflowNotificationResult {
  readonly deliveries: readonly WorkflowNotificationDelivery[];
}

export interface ReminderNotificationInput {
  readonly task: Task;
  readonly reminderType: ReminderType;
  readonly recipients: readonly User[];
}

export type ReminderNotificationDelivery = WorkflowNotificationDelivery;

export interface ReminderNotificationResult {
  readonly deliveries: readonly ReminderNotificationDelivery[];
}

export interface NotificationDispatcher {
  notifyAssignment(input: AssignmentNotificationInput): Promise<AssignmentNotificationResult>;
  notifyBulkAssignment(input: BulkAssignmentNotificationInput): Promise<AssignmentNotificationResult>;
  notifyWorkflow(input: WorkflowNotificationInput): Promise<WorkflowNotificationResult>;
  notifyReminder(input: ReminderNotificationInput): Promise<ReminderNotificationResult>;
}
