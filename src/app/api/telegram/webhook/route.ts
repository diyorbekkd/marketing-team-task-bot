import { ConfigurationError, getTelegramConfig } from "@/server/config";
import { sendTelegramMessage } from "@/telegram/client";
import { handleTelegramUpdate, TelegramUpdateSchema } from "@/telegram/update";
import { isValidWebhookSecret } from "@/telegram/webhook-security";

export async function POST(request: Request) {
  let config: ReturnType<typeof getTelegramConfig>;
  try {
    config = getTelegramConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error(error.message);
      return Response.json({ error: "Telegram integration is not configured." }, { status: 503 });
    }
    throw error;
  }

  const receivedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!isValidWebhookSecret(receivedSecret, config.webhookSecret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = TelegramUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ error: "Invalid Telegram update." }, { status: 400 });
  }

  const reply = handleTelegramUpdate(parsed.data);
  if (reply) {
    await sendTelegramMessage(reply.chatId, reply.text);
  }

  return Response.json({ ok: true });
}
