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
  return [{ text: "📋 Vazifani ochish", web_app: { url: appUrl } }];
}

function workflowMessage(input: WorkflowNotificationInput, appUrl: string): TelegramNotificationMessage {
  const { actor, deadlineRequest, event, task } = input;

  switch (event) {
    case "DEADLINE_CHANGE_REQUESTED": {
      if (!deadlineRequest) throw new Error("Deadline request context is required.");
      return {
        text: [
          "📅 Muddatni o‘zgartirish so‘rovi",
          "",
          `Vazifa: ${task.title}`,
          `Mas’ul: ${userLabel(actor)}`,
          "",
          "Joriy muddat:",
          formatDeadline(deadlineRequest.currentDeadline),
          "",
          "So‘ralgan muddat:",
          formatDeadline(deadlineRequest.requestedDeadline),
          "",
          "Sabab:",
          deadlineRequest.reason,
        ].join("\n"),
        replyMarkup: {
          inline_keyboard: [
            [{ text: "✅ Tasdiqlash", callback_data: `deadline:${deadlineRequest.id}:APPROVE` }],
            [{ text: "❌ Rad etish", callback_data: `deadline:${deadlineRequest.id}:REJECT` }],
            openTaskButton(appUrl),
          ],
        },
      };
    }
    case "DEADLINE_CHANGE_APPROVED": {
      if (!deadlineRequest) throw new Error("Deadline request context is required.");
      return {
        text: [
          "✅ Muddat o‘zgartirildi",
          "",
          `Vazifa: ${task.title}`,
          `Yangi muddat: ${formatDeadline(deadlineRequest.requestedDeadline)}`,
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    }
    case "DEADLINE_CHANGE_REJECTED":
      return {
        text: ["❌ Muddat so‘rovi rad etildi", "", `Vazifa: ${task.title}`].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    case "REVIEW_REQUESTED":
      return {
        text: [
          "📝 Vazifa tekshiruvga yuborildi",
          "",
          `Vazifa: ${task.title}`,
          `Mas’ul: ${userLabel(actor)}`,
          `Muddat: ${formatDeadline(task.deadline)}`,
        ].join("\n"),
        replyMarkup: {
          inline_keyboard: [
            [{ text: "✅ Tasdiqlash", callback_data: `task:${task.id}:APPROVE` }],
            [{ text: "🔄 Tuzatishga qaytarish", callback_data: `task:${task.id}:REQUEST_REVISION` }],
            openTaskButton(appUrl),
          ],
        },
      };
    case "TASK_ACCEPTED":
      return {
        text: [
          "✅ Vazifa qabul qilindi",
          "",
          `Vazifa: ${task.title}`,
          `Mas’ul: ${userLabel(actor)}`,
          `Muddat: ${formatDeadline(task.deadline)}`,
          "Holat: Jarayonda",
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    case "TASK_COMPLETED":
      return {
        text: ["✅ Vazifa tasdiqlandi", "", `Vazifa: ${task.title}`].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    case "REVISION_REQUESTED":
      return {
        text: [
          "🔄 Tuzatish kerak",
          "",
          `Vazifa: ${task.title}`,
          ...(input.comment ? ["", "Izoh:", input.comment] : []),
        ].join("\n"),
        replyMarkup: { inline_keyboard: [openTaskButton(appUrl)] },
      };
    case "TASK_BLOCKED":
      return {
        text: [
          "⛔ Vazifa bloklandi",
          "",
          `Vazifa: ${task.title}`,
          `Mas’ul: ${userLabel(actor)}`,
          ...(input.comment ? ["", "Sabab:", input.comment] : []),
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
        text: ["⏰ Muddat yaqinlashmoqda", "", `Vazifa: ${task.title}`, `Muddat: ${formatDeadline(task.deadline)}`, "Qoldi: 24 soat"].join("\n"),
        replyMarkup,
      };
    case "H3_BEFORE":
      return {
        text: ["⚠️ Muddat yaqin", "", `Vazifa: ${task.title}`, `Muddat: ${formatDeadlineTime(task.deadline)}`, "Qoldi: 3 soat"].join("\n"),
        replyMarkup,
      };
    case "AT_DEADLINE":
      return {
        text: ["🔴 Muddat keldi", "", `Vazifa: ${task.title}`, `Muddat: ${formatDeadlineTime(task.deadline)}`].join("\n"),
        replyMarkup,
      };
    case "H1_OVERDUE":
      return {
        text: ["🔴 Vazifa kechikdi", "", `Vazifa: ${task.title}`, `Muddat: ${formatDeadlineTime(task.deadline)}`, "Kechikish: 1 soat"].join("\n"),
        replyMarkup,
      };
    case "H24_OVERDUE":
      return {
        text: ["🚨 Vazifa 24 soatdan beri kechikmoqda", "", `Vazifa: ${task.title}`].join("\n"),
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
          "📋 Yangi vazifa",
          "",
          task.title,
          "",
          `Yaratuvchi: ${creator.displayName}`,
          `Muddat: ${formatDeadline(task.deadline)}`,
          `Ustuvorlik: ${task.priority === "high" ? "Yuqori" : task.priority === "low" ? "Past" : "Oddiy"}`,
          "",
          "Holat: Jarayonda",
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
          `📋 ${tasks.length} ta yangi vazifa`,
          "",
          ...tasks.map((task, index) => `${index + 1}. ${task.title} — ${formatDeadlineShort(task.deadline)}`),
          "",
          "Vazifalarni Mini App’da ko‘rishingiz mumkin.",
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
    await sendTelegramMessage(this.botToken, {
      chatId: recipient.telegramUserId,
      text,
      replyMarkup: { inline_keyboard: [[{ text: "📋 Vazifalarni tekshirish", web_app: { url: this.appUrl } }]] },
    });
  }
}
