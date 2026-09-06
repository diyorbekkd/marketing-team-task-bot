import { ConfigurationError, getTeamBootstrapConfig, getTelegramConfig } from "@/server/config";
import { getMarketingService } from "@/server/application";
import { answerTelegramCallback, sendTelegramMessage } from "@/telegram/client";
import { createTelegramUpdateHandler } from "@/telegram/handler";
import { TelegramUpdateSchema } from "@/telegram/update";
import { isValidWebhookSecret } from "@/telegram/webhook-security";

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
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = TelegramUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return Response.json({ error: "Invalid Telegram update." }, { status: 400 });
  }

  const result = await createTelegramUpdateHandler(getMarketingService(), {
    marketingGroupId: teamConfig.groupId,
    headTelegramUserId: teamConfig.headTelegramUserId,
  })(parsed.data);
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

  return Response.json({ ok: true });
}
