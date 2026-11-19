import { NextRequest, NextResponse } from "next/server";
import { getAppConfig, getTelegramWebConfig } from "@/server/config";
import { createWebLoginChallenge, WEB_LOGIN_COOKIE } from "@/server/auth/telegram-web-login";

export async function GET(request: NextRequest) {
  let appUrl: string;
  let clientId: string;
  try {
    appUrl = getAppConfig().appUrl;
    clientId = getTelegramWebConfig().clientId;
  } catch {
    return Response.json({ error: "Web login is not configured yet." }, { status: 503 });
  }

  const origin = new URL(appUrl).origin;
  if (request.nextUrl.origin !== origin) return NextResponse.redirect(origin);
  if (new URL(origin).protocol !== "https:" && process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Web login requires HTTPS." }, { status: 503 });
  }

  const { state, verifier, challenge } = createWebLoginChallenge();
  const redirectUri = new URL("/api/auth/web/callback", origin).toString();
  const authorization = new URL("https://oauth.telegram.org/auth");
  authorization.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const response = NextResponse.redirect(authorization);
  response.cookies.set(WEB_LOGIN_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: process.env.NODE_ENV !== "development",
    sameSite: "lax",
    path: "/api/auth/web",
    maxAge: 10 * 60,
  });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
