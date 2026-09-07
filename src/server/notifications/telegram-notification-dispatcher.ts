import "server-only";

import type {
  AssignmentNotificationInput,
  AssignmentNotificationResult,
  NotificationDispatcher,
  WorkflowNotificationDelivery,
  WorkflowNotificationInput,
  WorkflowNotificationResult,
} from "@/application/ports/notification-dispatcher";
import type { User } from "@/domain/models";
import { sendTelegramMessage } from "@/telegram/client";

interface TelegramNotificationMessage {
  readonly text: string;
  readonly replyMarkup?: unknown;
}

function formatDeadline(deadline: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(deadline));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")}.${value("month")}.${value("year")} ${value("hour")}:${value("minute")}`;
}

function userLabel(user: User): string {
  return user.telegramUsername ? `@${user.telegramUsername}` : user.displayName;
}

function recipientKey(user: User): string {
  return /^\d+$/.test(user.telegramUserId)
    ? `telegram:${user.telegramUserId}`
    : `user:${user.id}`;
}

function openTaskButton(appUrl: string) {
  return [{ text: "📋 Open Task", web_app: { url: appUrl } }];
}

function workflowMessage(input: WorkflowNotificationInput, appUrl: string): TelegramNotificationMessage {
  const { actor, deadlineRequest, event, task } = input;

  switch (event) {
    case "DEADLINE_CHANGE_REQUESTED": {
      if (!deadlineRequest) throw new Error("Deadline request context is required.");
      return {
        text: [
          "📅 Deadline o‘zgartirish so‘rovi",
          "",
          `Task: ${task.title}`,
          `Assignee: ${userLabel(actor)}`,
          "",
          "Current deadline:",
          formatDeadline(deadlineRequest.currentDeadline),
          "",
          "Requested deadline:",
          formatDeadline(deadlineRequest.requestedDeadline),
          "",
          "Reason:",
          deadlineRequest.reason,
        ].join("\n"),
        replyMarkup: {
          inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `deadline:${deadlineRequest.id}:APPROVE` }],
            [{ text: "❌ Reject", callback_data: `deadline:${deadlineRequest.id}:REJECT` }],
            openTaskButton(appUrl),
          ],
        },
      };
    }
    case "DEADLINE_CHANGE_APPROVED": {
      if (!deadlineRequest) throw new Error("Deadline request context is required.");
      return {
        text: [
          "✅ Deadline o‘zgartirildi",
          "",
          `Task: ${task.title}`,
          `New deadline: ${formatDeadline(deadlineRequest.requestedDeadline)}`,
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    }
    case "DEADLINE_CHANGE_REJECTED":
      return {
        text: ["❌ Deadline so‘rovi rad etildi", "", `Task: ${task.title}`].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    case "REVIEW_REQUESTED":
      return {
        text: [
          "📝 Task reviewga yuborildi",
          "",
          `Task: ${task.title}`,
          `Assignee: ${userLabel(actor)}`,
          `Deadline: ${formatDeadline(task.deadline)}`,
        ].join("\n"),
        replyMarkup: {
          inline_keyboard: [
            [{ text: "✅ Approve", callback_data: `task:${task.id}:APPROVE` }],
            [{ text: "🔄 Revision", callback_data: `task:${task.id}:REQUEST_REVISION` }],
            openTaskButton(appUrl),
          ],
        },
      };
    case "TASK_COMPLETED":
      return {
        text: ["✅ Task qabul qilindi", "", `Task: ${task.title}`].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    case "REVISION_REQUESTED":
      return {
        text: [
          "🔄 Revision kerak",
          "",
          `Task: ${task.title}`,
          ...(input.comment ? ["", "Comment:", input.comment] : []),
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    case "TASK_BLOCKED":
      return {
        text: [
          "⛔ Task blocked",
          "",
          `Task: ${task.title}`,
          `Assignee: ${userLabel(actor)}`,
          ...(input.comment ? ["", "Reason:", input.comment] : []),
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
  }
}

export class TelegramNotificationDispatcher implements NotificationDispatcher {
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

  async notifyWorkflow(input: WorkflowNotificationInput): Promise<WorkflowNotificationResult> {
    const message = workflowMessage(input, this.appUrl);
    const uniqueRecipients = new Map<string, User>();
    for (const recipient of input.recipients) {
      const key = recipientKey(recipient);
      if (!uniqueRecipients.has(key)) {
        uniqueRecipients.set(key, recipient);
      }
    }

    const deliveries = await Promise.all([...uniqueRecipients.values()].map(async (recipient) => {
      if (!/^\d+$/.test(recipient.telegramUserId)) {
        return {
          recipientUserId: recipient.id,
          status: "FAILED",
          reason: "RECIPIENT_NOT_ONBOARDED",
        } satisfies WorkflowNotificationDelivery;
      }

      try {
        await sendTelegramMessage(this.botToken, {
          chatId: recipient.telegramUserId,
          text: message.text,
          replyMarkup: message.replyMarkup,
        });
        return {
          recipientUserId: recipient.id,
          status: "SENT",
        } satisfies WorkflowNotificationDelivery;
      } catch {
        return {
          recipientUserId: recipient.id,
          status: "FAILED",
          reason: "DELIVERY_FAILED",
        } satisfies WorkflowNotificationDelivery;
      }
    }));

    return { deliveries };
  }
}
