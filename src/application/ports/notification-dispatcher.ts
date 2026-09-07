import type { DeadlineChangeRequest, Task, User } from "@/domain/models";

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

export type WorkflowNotificationEvent =
  | "DEADLINE_CHANGE_REQUESTED"
  | "DEADLINE_CHANGE_APPROVED"
  | "DEADLINE_CHANGE_REJECTED"
  | "REVIEW_REQUESTED"
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

export interface NotificationDispatcher {
  notifyAssignment(input: AssignmentNotificationInput): Promise<AssignmentNotificationResult>;
  notifyWorkflow(input: WorkflowNotificationInput): Promise<WorkflowNotificationResult>;
}
