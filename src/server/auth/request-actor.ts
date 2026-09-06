import "server-only";

import { cookies } from "next/headers";
import type { User } from "@/domain/models";
import { ApplicationError } from "@/application/errors";
import { getMarketingService } from "@/server/application";
import { getTelegramConfig } from "@/server/config";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";

export async function requireRequestActor(): Promise<User> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) throw new ApplicationError("UNAUTHENTICATED", "Telegram authentication is required.");

  const payload = verifySessionToken(token, getTelegramConfig().webhookSecret);
  if (!payload) throw new ApplicationError("UNAUTHENTICATED", "The session is invalid or expired.");

  const actor = await getMarketingService().requireActorById(payload.userId);
  if (actor.telegramUserId !== payload.telegramUserId) {
    throw new ApplicationError("UNAUTHENTICATED", "The session identity no longer matches.");
  }
  return actor;
}
