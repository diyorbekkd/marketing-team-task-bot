import { ApplicationError } from "@/application/errors";
import type { MarketingService } from "@/application/marketing-service";
import type { Task, User } from "@/domain/models";
import type { TaskAction } from "@/domain/workflow";
import { TaskShorthandError, parseTaskShorthand, parseTashkentDeadline } from "./task-shorthand";
import type { TelegramUpdate } from "./update";

export interface TelegramOutgoingMessage {
  readonly chatId: number;
  readonly text: string;
  readonly replyMarkup?: {
    readonly inline_keyboard: ReadonlyArray<ReadonlyArray<{ readonly text: string; readonly callback_data: string }>>;
  };
}

export interface TelegramHandlerResult {
  readonly messages: readonly TelegramOutgoingMessage[];
  readonly callbackQueryId?: string;
}

function displayName(from: Readonly<{ first_name: string; last_name?: string }>): string {
  return [from.first_name, from.last_name].filter(Boolean).join(" ");
}

function compactTask(task: Task, assignee: User): string {
  const deadline = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(task.deadline));
  return `#${task.id.slice(0, 8)} · ${task.title}\nAssignee: ${assignee.displayName}\nDeadline: ${deadline}\nPriority: ${task.priority}`;
}

function actionKeyboard(task: Task) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  if (task.status === "ASSIGNED") rows.push([{ text: "Accept", callback_data: `task:${task.id}:ACCEPT` }]);
  if (["IN_PROGRESS", "REVISION"].includes(task.status)) {
    rows.push([{ text: "Send to review", callback_data: `task:${task.id}:SUBMIT_REVIEW` }]);
  }
  if (task.status === "REVIEW") {
    rows.push([{ text: "Approve", callback_data: `task:${task.id}:APPROVE` }]);
  }
  return rows.length ? { inline_keyboard: rows } : undefined;
}

function commandAction(command: string): TaskAction | null {
  const actions: Readonly<Record<string, TaskAction>> = {
    "/accept": "ACCEPT",
    "/review": "SUBMIT_REVIEW",
    "/approve": "APPROVE",
    "/resume": "RESUME",
  };
  return actions[command] ?? null;
}

export function createTelegramUpdateHandler(service: MarketingService) {
  return async function handle(update: TelegramUpdate): Promise<TelegramHandlerResult> {
    try {
      if (update.callback_query?.data) {
        const match = update.callback_query.data.match(/^task:([0-9a-f-]{36}):(ACCEPT|SUBMIT_REVIEW|APPROVE|RESUME)$/i);
        if (!match) return { messages: [], callbackQueryId: update.callback_query.id };
        const actor = await service.requireActorByTelegramId(String(update.callback_query.from.id));
        const task = await service.performTaskAction(actor, match[1], { action: match[2].toUpperCase() });
        return {
          callbackQueryId: update.callback_query.id,
          messages: update.callback_query.message
            ? [{ chatId: update.callback_query.message.chat.id, text: `Task is now ${task.status}.` }]
            : [],
        };
      }

      const message = update.message;
      if (!message?.text || !message.from) return { messages: [] };
      const text = message.text.trim();
      const firstWord = text.split(/\s+/, 1)[0]?.split("@", 1)[0]?.toLowerCase() ?? "";

      if (firstWord === "/start" && message.chat.type === "private") {
        const user = await service.onboardTelegram({
          telegramUserId: String(message.from.id),
          telegramUsername: message.from.username,
          displayName: displayName(message.from),
        });
        return {
          messages: [{
            chatId: message.chat.id,
            text: user.isActive
              ? `Welcome, ${user.displayName}. Your role is ${user.role}. Open the Mini App to manage tasks.`
              : `Thanks, ${user.displayName}. Your account is pending activation by Head of Marketing.`,
          }],
        };
      }

      const actor = await service.requireActorByTelegramId(String(message.from.id));
      const action = commandAction(firstWord);
      if (action) {
        const taskId = text.split(/\s+/)[1];
        if (!taskId) throw new TaskShorthandError("A full task ID is required.");
        const task = await service.performTaskAction(actor, taskId, { action });
        return { messages: [{ chatId: message.chat.id, text: `Task is now ${task.status}.` }] };
      }

      const blockMatch = text.match(/^\/block\s+([0-9a-f-]{36})\s+(.+)$/is);
      if (blockMatch) {
        const task = await service.performTaskAction(actor, blockMatch[1], { action: "BLOCK", reason: blockMatch[2] });
        return { messages: [{ chatId: message.chat.id, text: `Task blocked: ${task.blockedReason}` }] };
      }

      const revisionMatch = text.match(/^\/revision\s+([0-9a-f-]{36})(?:\s+(.+))?$/is);
      if (revisionMatch) {
        const task = await service.performTaskAction(actor, revisionMatch[1], {
          action: "REQUEST_REVISION",
          reason: revisionMatch[2],
        });
        return { messages: [{ chatId: message.chat.id, text: `Revision requested. Task is now ${task.status}.` }] };
      }

      const deadlineMatch = text.match(/^\/deadline\s+([0-9a-f-]{36})\s+(\d{1,2}\.\d{1,2}(?:\.\d{4})?\s+\d{1,2}:\d{2})\s+(.+)$/is);
      if (deadlineMatch) {
        const request = await service.requestDeadlineChange(actor, deadlineMatch[1], {
          requestedDeadline: parseTashkentDeadline(deadlineMatch[2]),
          reason: deadlineMatch[3],
        });
        return { messages: [{ chatId: message.chat.id, text: `Deadline request created: ${request.id}` }] };
      }

      if (/(^|\n)T:\s*/i.test(text) && /(^|\n)A:\s*/i.test(text)) {
        const parsed = parseTaskShorthand(text);
        const { task, assignee } = await service.createTaskForUsername(actor, parsed, update.update_id);
        return {
          messages: [
            { chatId: message.chat.id, text: `Task created.\n${compactTask(task, assignee)}` },
            {
              chatId: Number(assignee.telegramUserId),
              text: `New task assigned to you.\n${compactTask(task, assignee)}\nTask ID: ${task.id}`,
              replyMarkup: actionKeyboard(task),
            },
          ],
        };
      }

      return { messages: [] };
    } catch (error) {
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (!chatId) return { messages: [], callbackQueryId: update.callback_query?.id };
      const message = error instanceof TaskShorthandError || error instanceof ApplicationError
        ? error.message
        : "The task service is temporarily unavailable.";
      return { messages: [{ chatId, text: message }], callbackQueryId: update.callback_query?.id };
    }
  };
}
