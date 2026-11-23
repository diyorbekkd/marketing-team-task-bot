import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketingService } from "@/server/application";
import { getTelegramConfig } from "@/server/config";
import { errorResponse } from "@/server/http/errors";
import { TelegramInitDataError, verifyTelegramInitData } from "@/server/auth/telegram-init-data";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";
import { ApplicationError } from "@/application/errors";
import { getBootstrapData } from "@/server/bootstrap";

const BodySchema = z.object({ initData: z.string().min(1).max(8192) }).strict();

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const config = getTelegramConfig();
    const identity = verifyTelegramInitData(body.initData, config.botToken);
    const user = await getMarketingService().requireActorByTelegramId(identity.telegramUserId);
    const token = createSessionToken({ userId: user.id, telegramUserId: user.telegramUserId }, config.webhookSecret);
    // If the Home query fails, keep the valid login and let the client retry
    // the bootstrap request. The normal path returns everything in one trip.
    let initialData: Awaited<ReturnType<typeof getBootstrapData>> | null = null;
    try { initialData = await getBootstrapData(user); }
    catch { console.error(JSON.stringify({ event: "telegram_auth_bootstrap_failed" })); }
    const response = NextResponse.json(initialData ?? { user });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    if (error instanceof TelegramInitDataError) {
      return errorResponse(new ApplicationError("UNAUTHENTICATED", "Telegram autentifikatsiyasi bajarilmadi."));
    }
    return errorResponse(error);
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
