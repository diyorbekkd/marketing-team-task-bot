const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrlText = process.env.APP_URL;
const statusOnly = process.argv.includes("--status");

function required(name, value) {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const appUrl = new URL(required("APP_URL", appUrlText));
if (appUrl.protocol !== "https:") throw new Error("APP_URL must use HTTPS.");
if (appUrl.pathname !== "/" || appUrl.search || appUrl.hash) {
  throw new Error("APP_URL must be an HTTPS origin without a path, query, or fragment.");
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${required("TELEGRAM_BOT_TOKEN", botToken)}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed.`);
  return result.result;
}

const webhookUrl = new URL("/api/telegram/webhook", appUrl).toString();

if (statusOnly) {
  const info = await telegram("getWebhookInfo", {});
  console.log(JSON.stringify({
    configuredForApp: info.url === webhookUrl,
    pendingUpdates: info.pending_update_count,
    hasLastError: Boolean(info.last_error_date),
  }));
} else {
  required("TELEGRAM_WEBHOOK_SECRET", webhookSecret);
  await telegram("setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  await telegram("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Tasks",
      web_app: { url: appUrl.toString() },
    },
  });
  console.log(JSON.stringify({ configured: true, appOrigin: appUrl.origin }));
}
