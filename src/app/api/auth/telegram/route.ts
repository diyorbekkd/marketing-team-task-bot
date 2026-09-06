import { NextResponse } from "next/server";
import { z } from "zod";
import { getMarketingService } from "@/server/application";
import { getTelegramConfig } from "@/server/config";
import { errorResponse } from "@/server/http/errors";
import { verifyTelegramInitData } from "@/server/auth/telegram-init-data";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/server/auth/session";

const BodySchema = z.object({ initData: z.string().min(1).max(8192) }).strict();

export async function POST(request: Request) {
  try {
    const body = BodySchema.parse(await request.json());
    const config = getTelegramConfig();
    const identity = verifyTelegramInitData(body.initData, config.botToken);
    const user = await getMarketingService().requireActorByTelegramId(identity.telegramUserId);
    const token = createSessionToken({ userId: user.id, telegramUserId: user.telegramUserId }, config.webhookSecret);
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
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
