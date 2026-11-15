import { NextRequest, NextResponse } from "next/server";
import { ApplicationError } from "@/application/errors";
import { getMarketingService } from "@/server/application";
import { getTelegramConfig } from "@/server/config";
import { errorResponse } from "@/server/http/errors";
import { WEB_BOT_LOGIN_COOKIE } from "@/server/auth/bot-link-login";
import { getTelegramBotUsername } from "@/telegram/client";

const LOGIN_TTL_SECONDS = 10 * 60;

export async function POST(request: NextRequest) {
  try {
    if (request.nextUrl.protocol !== "https:" && process.env.NODE_ENV !== "development") {
      throw new ApplicationError("INVALID_INPUT", "Web kirish uchun HTTPS kerak.");
    }
    const bot = await getTelegramBotUsername(getTelegramConfig().botToken).catch(() => {
      throw new ApplicationError("INTEGRATION_UNAVAILABLE", "Telegram botga ulanib bo‘lmadi. Keyinroq urinib ko‘ring.");
    });
    const { code, browserToken } = await getMarketingService().createWebBotLogin();
    const url = new URL(`https://t.me/${bot}`);
    url.searchParams.set("start", code);
    const response = NextResponse.json({ url: url.toString(), expiresIn: LOGIN_TTL_SECONDS });
    response.cookies.set(WEB_BOT_LOGIN_COOKIE, browserToken, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: "/api/auth/link", maxAge: LOGIN_TTL_SECONDS,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
