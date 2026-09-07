import type { Task, User } from "@/domain/models";

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

export interface AssignmentNotifier {
  notifyAssignment(input: AssignmentNotificationInput): Promise<AssignmentNotificationResult>;
}
