import type { MarketingRepository } from "./ports/marketing-repository";
import type { NotificationDispatcher } from "./ports/notification-dispatcher";
import type { Task, User } from "@/domain/models";
import { isOpenTask } from "@/domain/reporting";
import { dueReminderTypes, reminderDirectRecipientIds, reminderIncludesHeads, type ReminderType } from "@/domain/reminders";

export interface ReminderDeliverySummary {
  readonly tasksChecked: number;
  readonly sent: number;
  readonly deduplicated: number;
  readonly failed: number;
  readonly skippedNoRecipients: number;
}

/**
 * Resolves the same recipient set/dedup rules used elsewhere in the app
 * (active-only, deduplicated by id — the dispatcher further deduplicates by
 * Telegram id — creator+Head collapse to one message when they're the same
 * person) for a single reminder instance.
 */
function resolveRecipients(users: readonly User[], directIds: readonly string[], includeHeads: boolean): User[] {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const direct = [...new Set(directIds)].flatMap((id) => {
    const user = usersById.get(id);
    return user?.isActive ? [user] : [];
  });
  const heads = includeHeads ? users.filter((user) => user.isActive && user.role === "HEAD_OF_MARKETING") : [];
  const seen = new Set<string>();
  return [...direct, ...heads].filter((user) => {
    if (seen.has(user.id)) return false;
    seen.add(user.id);
    return true;
  });
}

export class ReminderService {
  constructor(
    private readonly repository: MarketingRepository,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  /**
   * Sweeps every open task for reminder thresholds that have just passed and
   * delivers each exactly once per (task, deadline, reminder type) — see
   * `docs/PRODUCT.md` for the idempotency-key rationale. Safe to call every
   * few minutes; a duplicate/overlapping run only ever deduplicates, it never
   * re-sends. One recipient or task failing never aborts the sweep.
   */
  async deliver(now = new Date()): Promise<ReminderDeliverySummary> {
    // Across all five thresholds and the six-hour catch-up window, no task
    // outside [now-30h, now+24h] can be eligible. Filtering in Postgres avoids
    // downloading the full task history on every ten-minute cron run.
    const hour = 60 * 60 * 1000;
    const [tasks, users] = await Promise.all([
      this.repository.listReminderCandidates({
        deadlineFrom: new Date(now.getTime() - 30 * hour).toISOString(),
        deadlineTo: new Date(now.getTime() + 24 * hour).toISOString(),
      }),
      this.repository.listUsers(),
    ]);
    const summary = { tasksChecked: 0, sent: 0, deduplicated: 0, failed: 0, skippedNoRecipients: 0 };

    for (const task of tasks) {
      if (!isOpenTask(task)) continue;
      const dueTypes = dueReminderTypes(task.deadline, now);
      if (dueTypes.length === 0) continue;
      summary.tasksChecked += 1;

      for (const type of dueTypes) {
        await this.deliverOne(task, type, users, summary);
      }
    }

    return summary;
  }

  private async deliverOne(
    task: Task,
    type: ReminderType,
    users: readonly User[],
    summary: { sent: number; deduplicated: number; failed: number; skippedNoRecipients: number },
  ): Promise<void> {
    const recipients = resolveRecipients(users, reminderDirectRecipientIds(type, task), reminderIncludesHeads(type));
    if (recipients.length === 0) {
      summary.skippedNoRecipients += 1;
      return;
    }

    const claim = await this.repository.claimReminderDelivery({ taskId: task.id, deadline: task.deadline, reminderType: type });
    if (!claim.claimed) {
      summary.deduplicated += 1;
      return;
    }

    const previousByRecipient = new Map(claim.deliveries.map((delivery) => [delivery.recipientUserId, delivery]));
    const pendingRecipients = recipients.filter((recipient) => previousByRecipient.get(recipient.id)?.status !== "SENT");
    if (pendingRecipients.length === 0) {
      await this.repository.completeReminderDelivery({
        taskId: task.id,
        deadline: task.deadline,
        reminderType: type,
        status: "SENT",
        metadata: { deliveries: claim.deliveries },
      });
      summary.deduplicated += 1;
      return;
    }

    try {
      const result = await this.dispatcher.notifyReminder({ task, reminderType: type, recipients: pendingRecipients });
      for (const delivery of result.deliveries) previousByRecipient.set(delivery.recipientUserId, delivery);
      const deliveries = recipients.map((recipient) => previousByRecipient.get(recipient.id) ?? {
        recipientUserId: recipient.id,
        status: "FAILED" as const,
        reason: "DELIVERY_FAILED",
      });
      const allSent = deliveries.every((delivery) => delivery.status === "SENT");
      const status = allSent ? "SENT" : "FAILED";
      await this.repository.completeReminderDelivery({
        taskId: task.id,
        deadline: task.deadline,
        reminderType: type,
        status,
        failureReason: allSent ? undefined : "PARTIAL_OR_TOTAL_DELIVERY_FAILED",
        metadata: { deliveries },
      });
      if (status === "SENT") summary.sent += 1; else summary.failed += 1;
      console.info(JSON.stringify({
        event: status === "SENT" ? "reminder_sent" : "reminder_failed",
        taskId: task.id, reminderType: type,
      }));
    } catch {
      summary.failed += 1;
      await this.repository.completeReminderDelivery({
        taskId: task.id, deadline: task.deadline, reminderType: type, status: "FAILED", failureReason: "DISPATCH_THREW",
      });
      console.warn(JSON.stringify({ event: "reminder_dispatch_failed", taskId: task.id, reminderType: type }));
    }
  }
}
