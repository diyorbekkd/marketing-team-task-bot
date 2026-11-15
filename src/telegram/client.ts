import "server-only";

import { z } from "zod";

const TelegramApiResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

const TelegramBotInfoSchema = z.object({
  ok: z.literal(true),
  result: z.object({ username: z.string().regex(/^[A-Za-z0-9_]{5,32}$/) }),
});

export async function getTelegramBotUsername(botToken: string): Promise<string> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    signal: AbortSignal.timeout(8_000), cache: "no-store",
  });
  const parsed = TelegramBotInfoSchema.safeParse(await response.json());
  if (!response.ok || !parsed.success) throw new Error("Telegram bot nomini aniqlab bo‘lmadi.");
  return parsed.data.result.username;
}

export async function sendTelegramMessage(
  botToken: string,
  input: Readonly<{ chatId: number | string; text: string; replyMarkup?: unknown }>,
): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: input.chatId, text: input.text, reply_markup: input.replyMarkup }),
    signal: AbortSignal.timeout(8_000),
  });

  const payload: unknown = await response.json();
  const parsed = TelegramApiResponseSchema.safeParse(payload);
  if (!response.ok || !parsed.success || !parsed.data.ok) {
    const detail = parsed.success ? parsed.data.description : undefined;
    throw new Error(detail ? `Telegram API rejected the message: ${detail}` : "Telegram API rejected the message.");
  }
}

export async function answerTelegramCallback(botToken: string, callbackQueryId: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
    signal: AbortSignal.timeout(8_000),
  });
}
