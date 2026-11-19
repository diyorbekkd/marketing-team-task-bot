import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApplicationError } from "@/application/errors";
import { getMarketingService } from "@/server/application";
import { createSessionToken, SESSION_COOKIE_NAME, WEB_SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { readWebLoginState, verifyTelegramWebIdToken, WEB_LOGIN_COOKIE } from "@/server/auth/telegram-web-login";
import { getAppConfig, getTelegramConfig, getTelegramWebConfig } from "@/server/config";

const TokenResponseSchema = z.object({ id_token: z.string().min(1) });

function redirectHome(origin: string, error?: string) {
  const url = new URL("/", origin);
  if (error) url.searchParams.set("web_login", error);
  const response = NextResponse.redirect(url);
  response.cookies.set(WEB_LOGIN_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV !== "development",
    sameSite: "lax", path: "/api/auth/web", maxAge: 0,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const origin = new URL(getAppConfig().appUrl).origin;
  if (request.nextUrl.origin !== origin) return redirectHome(origin, "invalid");
  const params = request.nextUrl.searchParams;
  const verifier = readWebLoginState(request.cookies.get(WEB_LOGIN_COOKIE)?.value, params.get("state"));
  const code = params.get("code");
  if (!verifier || !code || code.length > 4096 || params.has("error")) {
    return redirectHome(origin, "invalid");
  }

  try {
    const { clientId, clientSecret } = getTelegramWebConfig();
    const redirectUri = new URL("/api/auth/web/callback", origin).toString();
    const tokenResponse = await fetch("https://oauth.telegram.org/token", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: redirectUri,
        client_id: clientId, code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!tokenResponse.ok) throw new Error("Telegram token exchange failed.");
    const { id_token } = TokenResponseSchema.parse(await tokenResponse.json());
    const telegramUserId = await verifyTelegramWebIdToken(id_token, clientId);
    const user = await getMarketingService().requireActorByTelegramId(telegramUserId);
    const session = createSessionToken(
      { userId: user.id, telegramUserId }, getTelegramConfig().webhookSecret,
      new Date(), WEB_SESSION_MAX_AGE_SECONDS,
    );
    const response = redirectHome(origin);
    response.cookies.set(SESSION_COOKIE_NAME, session, {
      httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: WEB_SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    return redirectHome(origin,
      error instanceof ApplicationError && error.code === "UNAUTHENTICATED" ? "inactive" : "failed");
  }
}
