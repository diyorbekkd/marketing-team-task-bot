import { timingSafeEqual } from "node:crypto";
import { getAppConfig, getTelegramConfig } from "@/server/config";

export const dynamic = "force-dynamic";

function authorized(request: Request, expected: string): boolean {
  const supplied = request.headers.get("x-preview-setup-secret") ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function telegram<T>(token: string, method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const result: { ok?: boolean; result?: T } = await response.json();
  if (!response.ok || !result.ok || result.result === undefined) throw new Error(`Telegram ${method} failed`);
  return result.result;
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "preview") return Response.json({ error: "Not found" }, { status: 404 });

  const { appUrl } = getAppConfig();
  const { botToken, webhookSecret } = getTelegramConfig();
  if (!authorized(request, webhookSecret)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const origin = new URL(appUrl);
  if (origin.protocol !== "https:" || !origin.hostname.endsWith(".vercel.app")) {
    return Response.json({ error: "Preview URL is invalid" }, { status: 400 });
  }
  const webhookUrl = new URL("/api/telegram/webhook", origin).toString();

  let stage = "getMe";
  try {
    const bot = await telegram<{ username: string }>(botToken, "getMe", {});
    stage = "getWebhookInfo";
    const current = await telegram<{ url: string; pending_update_count: number; last_error_date?: number }>(botToken, "getWebhookInfo", {});
    const currentHost = current.url ? new URL(current.url).hostname : null;
    if (currentHost && currentHost !== origin.hostname && !currentHost.includes("staging")) {
      return Response.json({ error: "Bot webhook points to another environment", bot: bot.username, currentHost }, { status: 409 });
    }

    stage = "setWebhook";
    await telegram<boolean>(botToken, "setWebhook", {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
    stage = "setChatMenuButton";
    await telegram<boolean>(botToken, "setChatMenuButton", {
      menu_button: { type: "web_app", text: "Vazifalar", web_app: { url: origin.origin } },
    });
    stage = "verifyWebhook";
    const verified = await telegram<{ url: string; pending_update_count: number; last_error_date?: number }>(botToken, "getWebhookInfo", {});
    return Response.json({ bot: bot.username, configured: verified.url === webhookUrl, pendingUpdates: verified.pending_update_count, hasLastError: Boolean(verified.last_error_date) });
  } catch {
    return Response.json({ error: "Telegram setup failed", stage }, { status: 502 });
  }
}
