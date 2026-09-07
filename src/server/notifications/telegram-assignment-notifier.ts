import "server-only";

import type {
  AssignmentNotificationInput,
  AssignmentNotificationResult,
  AssignmentNotifier,
} from "@/application/ports/assignment-notifier";
import { sendTelegramMessage } from "@/telegram/client";

function formatDeadline(deadline: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(deadline));
}

export class TelegramAssignmentNotifier implements AssignmentNotifier {
  constructor(
    private readonly botToken: string,
    private readonly appUrl: string,
  ) {}

  async notifyAssignment(
    { task, creator, assignee }: AssignmentNotificationInput,
  ): Promise<AssignmentNotificationResult> {
    if (!/^\d+$/.test(assignee.telegramUserId)) {
      return { status: "FAILED", reason: "ASSIGNEE_NOT_ONBOARDED" };
    }

    try {
      await sendTelegramMessage(this.botToken, {
        chatId: assignee.telegramUserId,
        text: [
          "New task assigned to you.",
          `Title: ${task.title}`,
          `Creator: ${creator.displayName}`,
          `Deadline: ${formatDeadline(task.deadline)}`,
          `Priority: ${task.priority}`,
          `Task ID: ${task.id}`,
        ].join("\n"),
        replyMarkup: {
          inline_keyboard: [
            [{ text: "Accept", callback_data: `task:${task.id}:ACCEPT` }],
            [{ text: "Open task", web_app: { url: this.appUrl } }],
          ],
        },
      });
      return { status: "SENT" };
    } catch {
      return { status: "FAILED", reason: "DELIVERY_FAILED" };
    }
  }
}
