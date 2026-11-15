import { NextRequest, NextResponse } from "next/server";
import { getMarketingService } from "@/server/application";
import { getTelegramConfig } from "@/server/config";
import { createSessionToken, SESSION_COOKIE_NAME, WEB_SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { WEB_BOT_LOGIN_COOKIE } from "@/server/auth/bot-link-login";
import { errorResponse } from "@/server/http/errors";

export async function POST(request: NextRequest) {
  try {
    const browserToken = request.cookies.get(WEB_BOT_LOGIN_COOKIE)?.value;
    if (!browserToken) return Response.json({ status: "EXPIRED" }, { headers: { "Cache-Control": "private, no-store" } });
    const user = await getMarketingService().consumeWebBotLogin(browserToken);
    if (!user) return Response.json({ status: "PENDING" }, { headers: { "Cache-Control": "private, no-store" } });
    const session = createSessionToken(
      { userId: user.id, telegramUserId: user.telegramUserId },
      getTelegramConfig().webhookSecret, new Date(), WEB_SESSION_MAX_AGE_SECONDS,
    );
    const response = NextResponse.json({ status: "SIGNED_IN" });
    response.cookies.set(WEB_BOT_LOGIN_COOKIE, "", {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: "/api/auth/link", maxAge: 0,
    });
    response.cookies.set(SESSION_COOKIE_NAME, session, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: WEB_SESSION_MAX_AGE_SECONDS,
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
