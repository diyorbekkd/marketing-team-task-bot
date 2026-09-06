import "server-only";

import { z } from "zod";

const TelegramApiResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

export async function sendTelegramMessage(
  botToken: string,
  input: Readonly<{ chatId: number; text: string; replyMarkup?: unknown }>,
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
