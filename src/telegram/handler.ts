import { ApplicationError } from "@/application/errors";
import type { AssistantService } from "@/application/assistant-service";
import type { MarketingService } from "@/application/marketing-service";
import type { Task, User } from "@/domain/models";
import type { PostingChecklist } from "@/domain/models";
import type { TaskAction } from "@/domain/workflow";
import { uz } from "@/i18n/uz";
import {
  BULK_SEPARATOR,
  TaskShorthandError,
  containsBulkSeparator,
  looksLikePositionalTask,
  looksLikeTaskShorthand,
  parseTaskMessage,
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
  return `#${task.id.slice(0, 8)} · ${task.title}\nMas’ul: ${assignee.displayName}\nMuddat: ${deadline}\nUstuvorlik: ${uz.priority[task.priority]}`;
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

/** A message is worth attempting to parse as a task (single or bulk) only if
 * it has one of the recognized shapes — this is the same false-positive
 * guard that always protected ordinary group conversation, now shared by
 * the private bot and by bulk's block-splitting. */
function looksLikeTaskCreationAttempt(text: string): boolean {
  return containsBulkSeparator(text) || looksLikeTaskShorthand(text) || looksLikePositionalTask(text);
}

function taskFormatError(reason: string): string {
  return [
    "❌ Vazifa yaratilmadi.",
    `Sabab: ${reason}`,
    "",
    "Kerakli format:",
    "Vazifa nomi",
    "@username",
    "DD.MM.YYYY HH:mm",
  ].join("\n");
}

/** The private bot is a dedicated conversation, so its parse-error help can
 * afford to also mention priority/description and the bulk separator —
 * concise, not a wall of documentation, and only shown when something
 * actually looked like an attempted task and failed. */
function privateTaskFormatHelp(reason?: string): string {
  return [
    ...(reason ? ["❌ Vazifa yaratilmadi.", `Sabab: ${reason}`, ""] : []),
    "Vazifa yaratish formati:",
    "",
    "Vazifa nomi",
    "@masul_username",
    "DD.MM.YYYY HH:mm",
    "priority",
    "description",
    "",
    "Bir nechta vazifa uchun ularni:",
    "",
    BULK_SEPARATOR,
    "",
    "bilan ajrating.",
  ].join("\n");
}

function notificationWarning(): string {
  return "⚠️ Vazifa saqlandi, lekin mas’ulga shaxsiy xabar yuborilmadi. Mas’ul botga shaxsiy chatda /start yuborsin.";
}

function postingChecklistMessage(taskId: string, checklist: PostingChecklist): {
  text: string;
  replyMarkup: TelegramOutgoingMessage["replyMarkup"];
} {
  const complete = checklist.items.every((item) => item.isCompleted);
  return {
    text: ["📤 Joylash tekshiruv ro‘yxati", "", ...checklist.items.map((item) => `${item.isCompleted ? "✅" : "⬜"} ${item.label}`)].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        ...checklist.items.map((item) => [{
          text: `${item.isCompleted ? "✅" : "⬜"} ${item.label}`,
          callback_data: `check:${item.id}`,
        }]),
        ...(complete ? [[{ text: "✅ Tekshiruvga yuborish", callback_data: `task:${taskId}:SUBMIT_REVIEW` }]] : []),
      ],
    },
  };
}

/**
 * Single entry point for creating one or several tasks from a Telegram
 * message, shared by the group and the private bot. Never throws for an
 * expected parse/validation outcome — every case (silent ignore, a helpful
 * error, a single confirmation, or a bulk partial-success report) is
 * returned directly, so the caller's generic error handling is reserved for
 * genuinely unexpected failures.
 */
async function handleTaskCreationText(
  service: MarketingService,
  actor: User,
  text: string,
  chatId: number,
  updateId: number,
  helpfulErrors: boolean,
): Promise<TelegramHandlerResult> {
  const parsedMessage = parseTaskMessage(text);
  if (parsedMessage.results.length === 0) {
    // e.g. a lone "---" with nothing real on either side — never an attempt.
    return { messages: [] };
  }

  if (!parsedMessage.isBulk) {
    const only = parsedMessage.results[0];
    if (only.error) {
      if (only.error instanceof TaskShorthandError) {
        console.warn(JSON.stringify({ event: "task_parse_failed", updateId, reason: only.error.message }));
      }
      return {
        messages: [{ chatId, text: helpfulErrors ? privateTaskFormatHelp(only.error.message) : taskFormatError(only.error.message) }],
      };
    }
    if (!only.parsed) return { messages: [] };
    try {
      const { task, assignee, notification } = await service.createTaskForUsername(actor, only.parsed, updateId);
      console.info(JSON.stringify({ event: "task_created", updateId, taskId: task.id, notificationStatus: notification.status }));
      return {
        messages: [{
          chatId,
          text: [
            `Vazifa yaratildi.\n${compactTask(task, assignee)}`,
            ...(notification.status === "FAILED" ? [notificationWarning()] : []),
          ].join("\n"),
        }],
      };
    } catch (error) {
      if (error instanceof ApplicationError) return { messages: [{ chatId, text: error.message }] };
      throw error;
    }
  }

  // Bulk: every block is independently reported. Parse-time failures (bad
  // date/title shape) and creation-time failures (unknown/inactive assignee,
  // a persistence error) are reconciled back to the block's original
  // 1-based position so the user sees exactly which of their blocks needs
  // fixing.
  const parseFailures = parsedMessage.results
    .filter((result): result is typeof result & { error: TaskShorthandError } => result.error !== null);
  const parseSuccesses = parsedMessage.results
    .filter((result): result is typeof result & { parsed: NonNullable<typeof result.parsed> } => result.parsed !== null);

  const outcomes = parseSuccesses.length > 0
    ? await service.createTasksBulk(actor, parseSuccesses.map((result) => result.parsed), updateId)
    : [];

  const createdCount = outcomes.filter((outcome) => outcome.status === "CREATED").length;
  const failures = [
    ...parseFailures.map((result) => ({ index: result.index, message: result.error.message })),
    ...outcomes
      .filter((outcome): outcome is Extract<typeof outcome, { status: "FAILED" }> => outcome.status === "FAILED")
      .map((outcome) => ({ index: parseSuccesses[outcome.index].index, message: outcome.errorMessage })),
  ].sort((a, b) => a.index - b.index);

  console.info(JSON.stringify({ event: "bulk_tasks_created", updateId, created: createdCount, failed: failures.length }));

  const lines = [
    `✅ ${createdCount} ta vazifa yaratildi`,
    ...(failures.length > 0 ? [`❌ ${failures.length} ta vazifa yaratilmadi`] : []),
    ...failures.flatMap((failure) => ["", `${failure.index}-vazifa:`, failure.message]),
    ...(parsedMessage.truncated ? ["", "Bir xabarda ko‘pi bilan 20 ta vazifa yaratish mumkin."] : []),
  ];
  return { messages: [{ chatId, text: lines.join("\n") }] };
}

export function createTelegramUpdateHandler(service: MarketingService, config: TelegramHandlerConfig, assistant?: AssistantService) {
  return async function handle(update: TelegramUpdate): Promise<TelegramHandlerResult> {
    try {
      if (update.callback_query?.data) {
        const assistantMatch = update.callback_query.data.match(/^ai:([0-9a-f-]{36})$/i);
        const checklistMatch = update.callback_query.data.match(/^check:([0-9a-f-]{36})$/i);
        const taskMatch = update.callback_query.data.match(
          /^task:([0-9a-f-]{36}):(ACCEPT|SUBMIT_REVIEW|APPROVE|REQUEST_REVISION|RESUME)$/i,
        );
        const deadlineMatch = update.callback_query.data.match(
          /^deadline:([0-9a-f-]{36}):(APPROVE|REJECT)$/i,
        );
        if (!taskMatch && !deadlineMatch && !checklistMatch && !assistantMatch) {
          return { messages: [], callbackQueryId: update.callback_query.id };
        }

        const actor = await service.requireActorByTelegramId(String(update.callback_query.from.id));
        if (assistantMatch) {
          if (update.callback_query.message?.chat.type !== "private" || !assistant) {
            throw new ApplicationError("FORBIDDEN", "AI amalini faqat botning shaxsiy chatida tasdiqlang.");
          }
          const result = await assistant.confirm(actor, assistantMatch[1]);
          return { callbackQueryId: update.callback_query.id,
            messages: [{ chatId: update.callback_query.message.chat.id, text: result.answer }] };
        }
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
              ? [{ chatId: update.callback_query.message.chat.id, text: `Vazifa holati: ${uz.taskStatus[task.status]}.` }]
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
                  text: `Muddat so‘rovi ${deadlineRequest.status === "APPROVED" ? "tasdiqlandi" : "rad etildi"}.`,
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
        if (/^\/start(?:@\w+)?\s+wl_/i.test(text)) {
          const code = text.match(/^\/start(?:@\w+)?\s+(wl_[A-Za-z0-9_-]{24})$/i)?.[1];
          const approved = code && message.chat.id === message.from.id
            ? await service.approveWebBotLogin(String(message.from.id), code)
            : false;
          return { messages: [{ chatId: message.chat.id, text: approved
            ? "✅ Web kirish tasdiqlandi. O‘zingiz ochgan brauzer sahifasiga qayting. Agar bu so‘rovni siz boshlamagan bo‘lsangiz, rahbarga xabar bering."
            : "Kirish havolasi eskirgan yoki noto‘g‘ri. Web sahifada yangi havola yarating." }] };
        }
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
              ? `Xush kelibsiz, ${user.displayName}. Rolingiz: ${uz.role[user.role]}. Vazifalarni boshqarish uchun Mini App’ni oching. Savol yoki reja uchun shu chatga yozing — AI yordamchi javob beradi.`
              : user.deactivatedAt
                ? "Siz hozir faol marketing jamoasida emassiz. Marketing rahbari bilan bog‘laning."
                : `Rahmat, ${user.displayName}. Hisobingiz Marketing rahbari tomonidan faollashtirilishini kutmoqda.`,
          }],
        };
      }

      const isGroupChat = ["group", "supergroup"].includes(message.chat.type);
      const isPrivateChat = message.chat.type === "private";
      const isConfiguredMarketingGroup = isGroupChat && String(message.chat.id) === config.marketingGroupId;

      if (isGroupChat) {
        if (!isConfiguredMarketingGroup) {
          if (looksLikeTaskCreationAttempt(text)) {
            throw new ApplicationError("FORBIDDEN", "Vazifalarni faqat belgilangan marketing guruhida yaratish mumkin.");
          }
          return { messages: [] };
        }

        if (looksLikeTaskCreationAttempt(text)) {
          const actor = await service.requireActorByTelegramId(String(message.from.id));
          return await handleTaskCreationText(service, actor, text, message.chat.id, update.update_id, false);
        }

        if (!firstWord.startsWith("/")) return { messages: [] };
      }

      // The exact same shared parser/validation/creation workflow used by
      // the group is available in a private conversation with the bot, for
      // any active, onboarded sender — this was previously blocked outright.
      if (isPrivateChat && looksLikeTaskCreationAttempt(text)) {
        const actor = await service.requireActorByTelegramId(String(message.from.id));
        return await handleTaskCreationText(service, actor, text, message.chat.id, update.update_id, true);
      }

      const actor = await service.requireActorByTelegramId(String(message.from.id));
      const action = commandAction(firstWord);
      if (action) {
        const taskId = text.split(/\s+/)[1];
        if (!taskId) throw new TaskShorthandError("Vazifaning to‘liq ID raqami kerak.");
        if (action === "SUBMIT_REVIEW") {
          const detail = await service.getTaskDetails(actor, taskId);
          if (detail.postingChecklist?.items.some((item) => !item.isCompleted)) {
            return { messages: [{ chatId: message.chat.id, ...postingChecklistMessage(taskId, detail.postingChecklist) }] };
          }
        }
        const task = await service.performTaskAction(actor, taskId, { action });
        return { messages: [{ chatId: message.chat.id, text: `Vazifa holati: ${uz.taskStatus[task.status]}.` }] };
      }

      const blockMatch = text.match(/^\/block\s+([0-9a-f-]{36})\s+(.+)$/is);
      if (blockMatch) {
        const task = await service.performTaskAction(actor, blockMatch[1], { action: "BLOCK", reason: blockMatch[2] });
        return { messages: [{ chatId: message.chat.id, text: `Vazifa bloklandi: ${task.blockedReason}` }] };
      }

      const revisionMatch = text.match(/^\/revision\s+([0-9a-f-]{36})(?:\s+(.+))?$/is);
      if (revisionMatch) {
        const task = await service.performTaskAction(actor, revisionMatch[1], {
          action: "REQUEST_REVISION",
          reason: revisionMatch[2],
        });
        return { messages: [{ chatId: message.chat.id, text: `Tuzatish so‘raldi. Vazifa holati: ${uz.taskStatus[task.status]}.` }] };
      }

      const deadlineMatch = text.match(/^\/deadline\s+([0-9a-f-]{36})\s+(\d{1,2}\.\d{1,2}(?:\.\d{4})?\s+\d{1,2}:\d{2})\s+(.+)$/is);
      if (deadlineMatch) {
        const request = await service.requestDeadlineChange(actor, deadlineMatch[1], {
          requestedDeadline: parseTashkentDeadline(deadlineMatch[2]),
          reason: deadlineMatch[3],
        });
        return { messages: [{ chatId: message.chat.id, text: `Muddatni o‘zgartirish so‘rovi yaratildi: ${request.id}` }] };
      }

      if (looksLikeTaskShorthand(text)) {
        throw new ApplicationError("FORBIDDEN", "Vazifalarni faqat belgilangan marketing guruhida yaratish mumkin.");
      }

      if (isPrivateChat && assistant && (firstWord === "/ai" || !firstWord.startsWith("/"))) {
        const question = firstWord === "/ai" ? text.replace(/^\/ai(?:@\w+)?\s*/i, "").trim() : text;
        if (!question) return { messages: [{ chatId: message.chat.id, text: "Nimani rejalash yoki aniqlashtirish kerak? Savolingizni yozing." }] };
        const response = await assistant.respond(actor, {
          source: "TELEGRAM", requestKey: `tg_${update.update_id}`, text: question,
        });
        return { messages: [{ chatId: message.chat.id,
          text: [response.answer?.slice(0, 2500) ?? "Javob tayyorlanmoqda. Birozdan keyin qayta urinib ko‘ring.",
            response.proposal ? `\n\n📌 Taklif:\n${response.proposal.summary}` : ""].join(""),
          ...(response.proposal ? { replyMarkup: { inline_keyboard: [[{
            text: "✅ Tasdiqlash va bajarish", callback_data: `ai:${response.turnId}`,
          }]] } } : {}),
        }] };
      }
      return { messages: [] };
    } catch (error) {
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
      if (!chatId) return { messages: [], callbackQueryId: update.callback_query?.id };
      const message = error instanceof TaskShorthandError
        ? taskFormatError(error.message)
        : error instanceof ApplicationError
          ? error.message
        : "Vazifalar xizmati vaqtincha ishlamayapti.";
      return { messages: [{ chatId, text: message }], callbackQueryId: update.callback_query?.id };
    }
  };
}
