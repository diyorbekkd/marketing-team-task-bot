import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import type { MarketingRepository, NotificationOutboxRecord, NotificationPreferences } from "@/application/ports/marketing-repository";
import type {
  NotificationQueue,
  AssignmentNotificationInput,
  AssignmentNotificationResult,
  BulkAssignmentNotificationInput,
  NotificationDispatcher,
  ReminderNotificationInput,
  ReminderNotificationResult,
  WorkflowNotificationDelivery,
  WorkflowNotificationInput,
  WorkflowNotificationResult,
} from "@/application/ports/notification-dispatcher";
import type { ReportDispatcher } from "@/application/ports/report-dispatcher";
import { DeadlineChangeRequestSchema, TaskSchema, UserSchema } from "@/domain/models";

const AssignmentPayloadSchema = z.object({
  kind: z.literal("ASSIGNMENT"),
  input: z.object({ task: TaskSchema, creator: UserSchema, assignee: UserSchema }),
});
const BulkAssignmentPayloadSchema = z.object({
  kind: z.literal("BULK_ASSIGNMENT"),
  input: z.object({ tasks: z.array(TaskSchema).min(1), creator: UserSchema, assignee: UserSchema }),
});
const WorkflowPayloadSchema = z.object({
  kind: z.literal("WORKFLOW"),
  input: z.object({
    event: z.enum([
      "DEADLINE_CHANGE_REQUESTED", "DEADLINE_CHANGE_APPROVED", "DEADLINE_CHANGE_REJECTED",
      "REVIEW_REQUESTED", "TASK_ACCEPTED", "TASK_COMPLETED", "REVISION_REQUESTED", "TASK_BLOCKED",
    ]),
    task: TaskSchema,
    actor: UserSchema,
    recipients: z.array(UserSchema).length(1),
    deadlineRequest: DeadlineChangeRequestSchema.optional(),
    comment: z.string().optional(),
  }),
});
const ReportPayloadSchema = z.object({
  kind: z.literal("REPORT"),
  input: z.object({ recipient: UserSchema, text: z.string().min(1) }),
});
const OutboxPayloadSchema = z.discriminatedUnion("kind", [
  AssignmentPayloadSchema,
  BulkAssignmentPayloadSchema,
  WorkflowPayloadSchema,
  ReportPayloadSchema,
]);
type OutboxPayload = z.infer<typeof OutboxPayloadSchema>;

function dedupeKey(kind: string, value: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return `${kind}:${digest}`;
}

async function sendPayload(inner: NotificationDispatcher & ReportDispatcher, payload: OutboxPayload) {
  if (payload.kind === "ASSIGNMENT") {
    const result = await inner.notifyAssignment(payload.input);
    return result.status === "SENT"
      ? { sent: true as const }
      : { sent: false as const, error: result.reason };
  }
  if (payload.kind === "BULK_ASSIGNMENT") {
    const result = await inner.notifyBulkAssignment(payload.input);
    return result.status === "SENT"
      ? { sent: true as const }
      : { sent: false as const, error: result.reason };
  }
  if (payload.kind === "WORKFLOW") {
    const result = await inner.notifyWorkflow(payload.input);
    const delivery = result.deliveries[0];
    return delivery?.status === "SENT"
      ? { sent: true as const }
      : { sent: false as const, error: delivery?.reason ?? "DELIVERY_FAILED" };
  }
  try {
    await inner.sendReport(payload.input.recipient, payload.input.text);
    return { sent: true as const };
  } catch {
    return { sent: false as const, error: "DELIVERY_FAILED" };
  }
}

export class ReliableNotificationDispatcher implements NotificationDispatcher, ReportDispatcher, NotificationQueue {
  constructor(
    private readonly repository: MarketingRepository,
    private readonly inner: NotificationDispatcher & ReportDispatcher,
  ) {}

  private async preferences(userId: string): Promise<NotificationPreferences> {
    try {
      return await this.repository.getNotificationPreferences(userId);
    } catch {
      console.warn(JSON.stringify({ event: "notification_preferences_lookup_failed", userId }));
      return { assignments: true, workflow: true, reminders: true, dailyCheck: true, reports: true };
    }
  }

  private async enqueueAndSend(input: {
    key: string;
    type: NotificationOutboxRecord["notificationType"];
    recipientUserId: string;
    taskId?: string;
    payload: OutboxPayload;
  }) {
    const delivery = await this.repository.enqueueNotification({
      dedupeKey: input.key,
      notificationType: input.type,
      recipientUserId: input.recipientUserId,
      taskId: input.taskId,
      payload: input.payload,
    });
    if (delivery.status === "SENT") return { sent: true as const };
    if (!await this.repository.claimNotification(delivery.id)) {
      return { sent: false as const, error: "DELIVERY_QUEUED" };
    }
    try {
      const result = await sendPayload(this.inner, input.payload);
      await this.repository.completeNotification({ id: delivery.id, sent: result.sent, error: result.error });
      return result;
    } catch {
      await this.repository.completeNotification({ id: delivery.id, sent: false, error: "DISPATCH_THREW" });
      return { sent: false as const, error: "DISPATCH_THREW" };
    }
  }

  async notifyAssignment(input: AssignmentNotificationInput): Promise<AssignmentNotificationResult> {
    if (!(await this.preferences(input.assignee.id)).assignments) return { status: "SENT" };
    const payload = AssignmentPayloadSchema.parse({ kind: "ASSIGNMENT", input });
    const result = await this.enqueueAndSend({
      key: dedupeKey("assignment", { taskId: input.task.id, recipientId: input.assignee.id }),
      type: "ASSIGNMENT",
      recipientUserId: input.assignee.id,
      taskId: input.task.id,
      payload,
    });
    return result.sent ? { status: "SENT" } : {
      status: "FAILED",
      reason: input.assignee.telegramUserId.match(/^\d+$/) ? "DELIVERY_FAILED" : "ASSIGNEE_NOT_ONBOARDED",
    };
  }

  async queueAssignment(input: AssignmentNotificationInput): Promise<"QUEUED" | "SKIPPED"> {
    if (!(await this.preferences(input.assignee.id)).assignments) return "SKIPPED";
    const payload = AssignmentPayloadSchema.parse({ kind: "ASSIGNMENT", input });
    await this.repository.enqueueNotification({
      dedupeKey: dedupeKey("assignment", { taskId: input.task.id, recipientId: input.assignee.id }),
      notificationType: "ASSIGNMENT",
      recipientUserId: input.assignee.id,
      taskId: input.task.id,
      payload,
    });
    return "QUEUED";
  }

  async notifyBulkAssignment(input: BulkAssignmentNotificationInput): Promise<AssignmentNotificationResult> {
    if (!(await this.preferences(input.assignee.id)).assignments) return { status: "SENT" };
    const payload = BulkAssignmentPayloadSchema.parse({ kind: "BULK_ASSIGNMENT", input });
    const result = await this.enqueueAndSend({
      key: dedupeKey("bulk-assignment", {
        taskIds: input.tasks.map((task) => task.id).sort(),
        recipientId: input.assignee.id,
      }),
      type: "BULK_ASSIGNMENT",
      recipientUserId: input.assignee.id,
      taskId: input.tasks[0].id,
      payload,
    });
    return result.sent ? { status: "SENT" } : {
      status: "FAILED",
      reason: input.assignee.telegramUserId.match(/^\d+$/) ? "DELIVERY_FAILED" : "ASSIGNEE_NOT_ONBOARDED",
    };
  }

  async notifyWorkflow(input: WorkflowNotificationInput): Promise<WorkflowNotificationResult> {
    const uniqueRecipients = [...new Map(input.recipients.map((recipient) => [recipient.id, recipient])).values()];
    const deliveries: WorkflowNotificationDelivery[] = [];
    for (const recipient of uniqueRecipients) {
      if (!(await this.preferences(recipient.id)).workflow) {
        deliveries.push({ recipientUserId: recipient.id, status: "SENT" });
        continue;
      }
      const recipientInput = { ...input, recipients: [recipient] };
      const payload = WorkflowPayloadSchema.parse({ kind: "WORKFLOW", input: recipientInput });
      const result = await this.enqueueAndSend({
        key: dedupeKey("workflow", {
          event: input.event,
          taskId: input.task.id,
          taskUpdatedAt: input.task.updatedAt,
          requestId: input.deadlineRequest?.id,
          recipientId: recipient.id,
        }),
        type: "WORKFLOW",
        recipientUserId: recipient.id,
        taskId: input.task.id,
        payload,
      });
      deliveries.push(result.sent
        ? { recipientUserId: recipient.id, status: "SENT" }
        : {
            recipientUserId: recipient.id,
            status: "FAILED",
            reason: /^\d+$/.test(recipient.telegramUserId) ? "DELIVERY_FAILED" : "RECIPIENT_NOT_ONBOARDED",
          });
    }
    return { deliveries };
  }

  async queueWorkflow(input: WorkflowNotificationInput): Promise<void> {
    const recipients = [...new Map(input.recipients.map((recipient) => [recipient.id, recipient])).values()];
    for (const recipient of recipients) {
      if (!(await this.preferences(recipient.id)).workflow) continue;
      const payload = WorkflowPayloadSchema.parse({ kind: "WORKFLOW", input: { ...input, recipients: [recipient] } });
      await this.repository.enqueueNotification({
        dedupeKey: dedupeKey("workflow", {
          event: input.event,
          taskId: input.task.id,
          taskUpdatedAt: input.task.updatedAt,
          requestId: input.deadlineRequest?.id,
          recipientId: recipient.id,
        }),
        notificationType: "WORKFLOW",
        recipientUserId: recipient.id,
        taskId: input.task.id,
        payload,
      });
    }
  }

  async notifyReminder(input: ReminderNotificationInput): Promise<ReminderNotificationResult> {
    const enabled: typeof input.recipients[number][] = [];
    const skipped: WorkflowNotificationDelivery[] = [];
    for (const recipient of input.recipients) {
      if ((await this.preferences(recipient.id)).reminders) enabled.push(recipient);
      else skipped.push({ recipientUserId: recipient.id, status: "SENT" });
    }
    if (enabled.length === 0) return { deliveries: skipped };
    const result = await this.inner.notifyReminder({ ...input, recipients: enabled });
    return { deliveries: [...skipped, ...result.deliveries] };
  }

  async sendReport(recipient: z.infer<typeof UserSchema>, text: string, key?: string): Promise<void> {
    const preferences = await this.preferences(recipient.id);
    const enabled = key?.includes(":DAILY_EVENING:") ? preferences.dailyCheck : preferences.reports;
    if (!enabled) return;
    const payload = ReportPayloadSchema.parse({ kind: "REPORT", input: { recipient, text } });
    const result = await this.enqueueAndSend({
      key: key ?? dedupeKey("report", { recipientId: recipient.id, text }),
      type: "REPORT",
      recipientUserId: recipient.id,
      payload,
    });
    if (!result.sent) throw new Error("Report delivery is queued for retry.");
  }
}

export class NotificationRetryService {
  constructor(
    private readonly repository: MarketingRepository,
    private readonly inner: NotificationDispatcher & ReportDispatcher,
  ) {}

  async deliver(limit = 25) {
    const rows = await this.repository.claimDueNotifications(limit);
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const result = await sendPayload(this.inner, OutboxPayloadSchema.parse(row.payload));
        await this.repository.completeNotification({ id: row.id, sent: result.sent, error: result.error });
        if (result.sent) sent += 1; else failed += 1;
      } catch {
        await this.repository.completeNotification({ id: row.id, sent: false, error: "INVALID_PAYLOAD_OR_DISPATCH" });
        failed += 1;
      }
    }
    return { claimed: rows.length, sent, failed };
  }
}
