import { ApplicationError } from "@/application/errors";
import type { MarketingService } from "@/application/marketing-service";
import type { Task, User } from "@/domain/models";
import type { PostingChecklist } from "@/domain/models";
import type { TaskAction } from "@/domain/workflow";
import {
  TaskShorthandError,
  looksLikeTaskShorthand,
  parseGroupTaskMessage,
  parseTashkentDeadline,
} from "./task-shorthand";
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

export interface TelegramHandlerConfig {
  readonly marketingGroupId: string;
  readonly headTelegramUserId: string;
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

function commandAction(command: string): TaskAction | null {
  const actions: Readonly<Record<string, TaskAction>> = {
    "/accept": "ACCEPT",
    "/review": "SUBMIT_REVIEW",
    "/approve": "APPROVE",
    "/resume": "RESUME",
  };
  return actions[command] ?? null;
}

function taskFormatError(reason: string): string {
  return [
    "❌ Task yaratilmadi.",
    `Sabab: ${reason}`,
    "",
    "Kerakli format:",
    "Task nomi",
    "@username",
    "DD.MM.YYYY HH:mm",
  ].join("\n");
}

function notificationWarning(): string {
  return "⚠️ Task saqlandi, lekin assignee'ga private xabar yuborilmadi. Assignee botga private chatda /start yuborsin.";
}

function postingChecklistMessage(taskId: string, checklist: PostingChecklist): {
  text: string;
  replyMarkup: TelegramOutgoingMessage["replyMarkup"];
} {
  const complete = checklist.items.every((item) => item.isCompleted);
  return {
    text: ["📤 Posting checklist", "", ...checklist.items.map((item) => `${item.isCompleted ? "✅" : "⬜"} ${item.label}`)].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        ...checklist.items.map((item) => [{
          text: `${item.isCompleted ? "✅" : "⬜"} ${item.label}`,
          callback_data: `check:${item.id}`,
        }]),
        ...(complete ? [[{ text: "✅ Reviewga yuborish", callback_data: `task:${taskId}:SUBMIT_REVIEW` }]] : []),
      ],
    },
  };
}

export function createTelegramUpdateHandler(service: MarketingService, config: TelegramHandlerConfig) {
  return async function handle(update: TelegramUpdate): Promise<TelegramHandlerResult> {
    try {
      if (update.callback_query?.data) {
        const checklistMatch = update.callback_query.data.match(/^check:([0-9a-f-]{36})$/i);
        const taskMatch = update.callback_query.data.match(
          /^task:([0-9a-f-]{36}):(ACCEPT|SUBMIT_REVIEW|APPROVE|REQUEST_REVISION|RESUME)$/i,
        );
        const deadlineMatch = update.callback_query.data.match(
          /^deadline:([0-9a-f-]{36}):(APPROVE|REJECT)$/i,
        );
        if (!taskMatch && !deadlineMatch && !checklistMatch) {
          return { messages: [], callbackQueryId: update.callback_query.id };
        }

        const actor = await service.requireActorByTelegramId(String(update.callback_query.from.id));
        if (checklistMatch) {
          const checklist = await service.togglePostingChecklistItem(actor, checklistMatch[1]);
          return {
            callbackQueryId: update.callback_query.id,
            messages: update.callback_query.message && checklist
              ? [{ chatId: update.callback_query.message.chat.id, ...postingChecklistMessage(checklist.taskId, checklist) }]
              : [],
          };
        }
        if (taskMatch) {
          if (taskMatch[2].toUpperCase() === "SUBMIT_REVIEW") {
            const detail = await service.getTaskDetails(actor, taskMatch[1]);
            if (detail.postingChecklist?.items.some((item) => !item.isCompleted)) {
              return {
                callbackQueryId: update.callback_query.id,
                messages: update.callback_query.message
                  ? [{ chatId: update.callback_query.message.chat.id, ...postingChecklistMessage(taskMatch[1], detail.postingChecklist) }]
                  : [],
              };
            }
          }
          const task = await service.performTaskAction(actor, taskMatch[1], { action: taskMatch[2].toUpperCase() });
          return {
            callbackQueryId: update.callback_query.id,
            messages: update.callback_query.message
              ? [{ chatId: update.callback_query.message.chat.id, text: `Task is now ${task.status}.` }]
              : [],
          };
        }

        if (deadlineMatch) {
          const deadlineRequest = await service.resolveDeadlineChangeRequest(
            actor,
            deadlineMatch[1],
            deadlineMatch[2].toUpperCase() === "APPROVE",
          );
          return {
            callbackQueryId: update.callback_query.id,
            messages: update.callback_query.message
              ? [{
                  chatId: update.callback_query.message.chat.id,
                  text: `Deadline request is now ${deadlineRequest.status}.`,
                }]
              : [],
          };
        }

        return { messages: [], callbackQueryId: update.callback_query.id };
      }

      const message = update.message;
      if (!message?.text || !message.from) return { messages: [] };
      const text = message.text.trim();
      const firstWord = text.split(/\s+/, 1)[0]?.split("@", 1)[0]?.toLowerCase() ?? "";

      if (firstWord === "/start" && message.chat.type === "private") {
        const user = await service.onboardTelegram(
          {
            telegramUserId: String(message.from.id),
            telegramUsername: message.from.username,
            displayName: displayName(message.from),
          },
          config.headTelegramUserId,
        );
        return {
          messages: [{
            chatId: message.chat.id,
            text: user.isActive
              ? `Welcome, ${user.displayName}. Your role is ${user.role}. Open the Mini App to manage tasks.`
              : `Thanks, ${user.displayName}. Your account is pending activation by Head of Marketing.`,
          }],
        };
      }

      const isGroupChat = ["group", "supergroup"].includes(message.chat.type);
      const isConfiguredMarketingGroup = isGroupChat && String(message.chat.id) === config.marketingGroupId;
      if (isGroupChat) {
        if (!isConfiguredMarketingGroup) {
          if (looksLikeTaskShorthand(text)) {
            throw new ApplicationError("FORBIDDEN", "Tasks may only be created in the configured marketing group.");
          }
          return { messages: [] };
        }

        let parsedTask = null;
        let taskParseError: unknown;
        try {
          parsedTask = parseGroupTaskMessage(text);
        } catch (error) {
          taskParseError = error;
        }

        if (parsedTask || taskParseError) {
          const actor = await service.requireActorByTelegramId(String(message.from.id));
          if (taskParseError) {
            if (taskParseError instanceof TaskShorthandError) {
              console.warn(JSON.stringify({
                event: "group_task_parse_failed",
                updateId: update.update_id,
                reason: taskParseError.message,
              }));
            }
            throw taskParseError;
          }

          const { task, assignee, notification } = await service.createTaskForUsername(
            actor,
            parsedTask!,
            update.update_id,
          );
          console.info(JSON.stringify({
            event: "group_task_created",
            updateId: update.update_id,
            taskId: task.id,
            notificationStatus: notification.status,
          }));
          return {
            messages: [{
              chatId: message.chat.id,
              text: [
                `Task created.\n${compactTask(task, assignee)}`,
                ...(notification.status === "FAILED" ? [notificationWarning()] : []),
              ].join("\n"),
            }],
          };
        }

        if (!firstWord.startsWith("/")) return { messages: [] };
      }

      const actor = await service.requireActorByTelegramId(String(message.from.id));
      const action = commandAction(firstWord);
      if (action) {
        const taskId = text.split(/\s+/)[1];
        if (!taskId) throw new TaskShorthandError("A full task ID is required.");
        if (action === "SUBMIT_REVIEW") {
          const detail = await service.getTaskDetails(actor, taskId);
          if (detail.postingChecklist?.items.some((item) => !item.isCompleted)) {
            return { messages: [{ chatId: message.chat.id, ...postingChecklistMessage(taskId, detail.postingChecklist) }] };
          }
        }
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

      if (looksLikeTaskShorthand(text)) {
        throw new ApplicationError("FORBIDDEN", "Tasks may only be created in the configured marketing group.");
      }

      return { messages: [] };
    } catch (error) {
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (!chatId) return { messages: [], callbackQueryId: update.callback_query?.id };
      const message = error instanceof TaskShorthandError
        ? taskFormatError(error.message)
        : error instanceof ApplicationError
          ? error.message
        : "The task service is temporarily unavailable.";
      return { messages: [{ chatId, text: message }], callbackQueryId: update.callback_query?.id };
    }
  };
}
