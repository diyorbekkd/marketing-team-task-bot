import "server-only";

import type {
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
import type { User } from "@/domain/models";
import { sendTelegramMessage } from "@/telegram/client";
import type { ReportDispatcher } from "@/application/ports/report-dispatcher";

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

function formatDeadlineShort(deadline: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(deadline));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("day")} ${value("month")}, ${value("hour")}:${value("minute")}`;
}

function formatDeadlineTime(deadline: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(deadline));
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
    case "TASK_ACCEPTED":
      return {
        text: [
          "✅ Task qabul qilindi",
          "",
          `Task: ${task.title}`,
          `Assignee: ${userLabel(actor)}`,
          `Deadline: ${formatDeadline(task.deadline)}`,
          "Status: In Progress",
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
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

function reminderMessage(input: ReminderNotificationInput, appUrl: string): TelegramNotificationMessage {
  const { task, reminderType } = input;
  const replyMarkup = { inline_keyboard: [openTaskButton(appUrl)] };

  switch (reminderType) {
    case "H24_BEFORE":
      return {
        text: ["⏰ Deadline yaqinlashmoqda", "", `Task: ${task.title}`, `Deadline: ${formatDeadline(task.deadline)}`, "Qoldi: 24 soat"].join("\n"),
        replyMarkup,
      };
    case "H3_BEFORE":
      return {
        text: ["⚠️ Deadline yaqin", "", `Task: ${task.title}`, `Deadline: ${formatDeadlineTime(task.deadline)}`, "Qoldi: 3 soat"].join("\n"),
        replyMarkup,
      };
    case "AT_DEADLINE":
      return {
        text: ["🔴 Deadline keldi", "", `Task: ${task.title}`, `Deadline: ${formatDeadlineTime(task.deadline)}`].join("\n"),
        replyMarkup,
      };
    case "H1_OVERDUE":
      return {
        text: ["🔴 Task kechikdi", "", `Task: ${task.title}`, `Deadline: ${formatDeadlineTime(task.deadline)}`, "Kechikish: 1 soat"].join("\n"),
        replyMarkup,
      };
    case "H24_OVERDUE":
      return {
        text: ["🚨 Task 24 soatdan beri overdue", "", `Task: ${task.title}`].join("\n"),
        replyMarkup,
      };
  }
}

async function sendToUniqueRecipients(
  botToken: string,
  recipients: readonly User[],
  message: TelegramNotificationMessage,
): Promise<readonly WorkflowNotificationDelivery[]> {
  const uniqueRecipients = new Map<string, User>();
  for (const recipient of recipients) {
    const key = recipientKey(recipient);
    if (!uniqueRecipients.has(key)) {
      uniqueRecipients.set(key, recipient);
    }
  }

  return Promise.all([...uniqueRecipients.values()].map(async (recipient) => {
    if (!/^\d+$/.test(recipient.telegramUserId)) {
      return {
        recipientUserId: recipient.id,
        status: "FAILED",
        reason: "RECIPIENT_NOT_ONBOARDED",
      } satisfies WorkflowNotificationDelivery;
    }

    try {
      await sendTelegramMessage(botToken, {
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
}

export class TelegramNotificationDispatcher implements NotificationDispatcher, ReportDispatcher {
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
        // New tasks start IN_PROGRESS immediately — no Accept step, and no
        // Accept button, since there is nothing left for the assignee to
        // accept.
        text: [
          "📋 Yangi task",
          "",
          task.title,
          "",
          `Creator: ${creator.displayName}`,
          `Deadline: ${formatDeadline(task.deadline)}`,
          `Priority: ${task.priority}`,
          "",
          "Status: In Progress",
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(this.appUrl)] },
      });
      return { status: "SENT" };
    } catch {
      return { status: "FAILED", reason: "DELIVERY_FAILED" };
    }
  }

  async notifyBulkAssignment(
    { tasks, assignee }: BulkAssignmentNotificationInput,
  ): Promise<AssignmentNotificationResult> {
    if (!/^\d+$/.test(assignee.telegramUserId)) {
      return { status: "FAILED", reason: "ASSIGNEE_NOT_ONBOARDED" };
    }

    try {
      await sendTelegramMessage(this.botToken, {
        chatId: assignee.telegramUserId,
        text: [
          `📋 ${tasks.length} ta yangi task`,
          "",
          ...tasks.map((task, index) => `${index + 1}. ${task.title} — ${formatDeadlineShort(task.deadline)}`),
          "",
          "Mini App'da tasklarni ko‘rishingiz mumkin.",
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(this.appUrl)] },
      });
      return { status: "SENT" };
    } catch {
      return { status: "FAILED", reason: "DELIVERY_FAILED" };
    }
  }

  async notifyWorkflow(input: WorkflowNotificationInput): Promise<WorkflowNotificationResult> {
    const message = workflowMessage(input, this.appUrl);
    const deliveries = await sendToUniqueRecipients(this.botToken, input.recipients, message);
    return { deliveries };
  }

  async notifyReminder(input: ReminderNotificationInput): Promise<ReminderNotificationResult> {
    const message = reminderMessage(input, this.appUrl);
    const deliveries = await sendToUniqueRecipients(this.botToken, input.recipients, message);
    return { deliveries };
  }

  async sendReport(recipient: User, text: string): Promise<void> {
    if (!recipient.isActive || !/^\d+$/.test(recipient.telegramUserId)) {
      throw new Error("Recipient is not actively Telegram-onboarded.");
    }
    await sendTelegramMessage(this.botToken, { chatId: recipient.telegramUserId, text });
  }
}
