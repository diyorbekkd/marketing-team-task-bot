import "server-only";

import { z } from "zod";
import { getTelegramConfig } from "@/server/config";

const TelegramApiResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
});

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const { botToken } = getTelegramConfig();
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(8_000),
  });

  const payload: unknown = await response.json();
  const parsed = TelegramApiResponseSchema.safeParse(payload);
  if (!response.ok || !parsed.success || !parsed.data.ok) {
    const detail = parsed.success ? parsed.data.description : undefined;
    throw new Error(detail ? `Telegram API rejected the message: ${detail}` : "Telegram API rejected the message.");
  }
}
