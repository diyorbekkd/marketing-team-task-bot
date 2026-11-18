import { ConfigurationError, getTeamBootstrapConfig, getTelegramConfig } from "@/server/config";
import { getAssistantService, getMarketingService, getNotificationRetryService } from "@/server/application";
import { after } from "next/server";
import { answerTelegramCallback, sendTelegramMessage } from "@/telegram/client";
import { createTelegramUpdateHandler } from "@/telegram/handler";
import { TelegramUpdateSchema } from "@/telegram/update";
import { isValidWebhookSecret } from "@/telegram/webhook-security";

export const maxDuration = 30;

export async function POST(request: Request) {
  let config: ReturnType<typeof getTelegramConfig>;
  let teamConfig: ReturnType<typeof getTeamBootstrapConfig>;
  try {
    config = getTelegramConfig();
    teamConfig = getTeamBootstrapConfig();
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
    return Response.json({ error: "So‘rov tanasi to‘g‘ri JSON bo‘lishi kerak." }, { status: 400 });
  }

  const parsed = TelegramUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ error: "Telegram yangilanishi noto‘g‘ri." }, { status: 400 });
  }

  const message = parsed.data.message;
  console.info(JSON.stringify({
    event: "telegram_update_received",
    updateId: parsed.data.update_id,
    updateKind: parsed.data.callback_query ? "callback_query" : message ? "message" : "other",
    ...(message ? {
      message: {
        chatType: message.chat.type,
        hasSender: Boolean(message.from),
        hasText: typeof message.text === "string",
        textLength: message.text?.length ?? 0,
        entityTypes: [...new Set(message.entities?.map((entity) => entity.type) ?? [])],
      },
    } : {}),
  }));

  const result = await createTelegramUpdateHandler(getMarketingService(), {
    marketingGroupId: teamConfig.groupId,
    headTelegramUserId: teamConfig.headTelegramUserId,
  }, getAssistantService())(parsed.data);
  if (result.callbackQueryId) {
    await answerTelegramCallback(config.botToken, result.callbackQueryId);
  }
  for (const message of result.messages) {
    try {
      await sendTelegramMessage(config.botToken, message);
    } catch {
      // A non-2xx response asks Telegram to retry. This is preferable to
      // silently losing the reply until durable outbound delivery exists.
      console.error("Failed to deliver Telegram reply.");
      return Response.json({ error: "Telegram reply delivery failed." }, { status: 502 });
    }
  }

  if (parsed.data.callback_query?.data?.startsWith("ai:")) after(async () => {
    try { await getNotificationRetryService().deliver(25); }
    catch { console.error(JSON.stringify({ event: "post_response_assistant_telegram_delivery_failed" })); }
  });

  return Response.json({ ok: true });
}
