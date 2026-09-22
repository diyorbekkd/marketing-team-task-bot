import "server-only";

import { cookies } from "next/headers";
import { ApplicationError } from "@/application/errors";
import { getMarketingService } from "@/server/application";
import { getTelegramConfig } from "@/server/config";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";
import type { RequestActorProvider, RequestActorResolution } from "./request-actor-provider";

/**
 * The existing (and, before this change, only) auth path: the
 * `marketing_session` HttpOnly cookie set by `POST /api/auth/telegram`
 * after verifying real Telegram `initData`. Behavior here is copied
 * unchanged from the pre-existing `requireRequestActor()` -- only the
 * "no cookie present" case changed from an immediate throw to returning
 * null, so a request with no cookie at all can still be tried against
 * other providers (e.g. a signed Content OS service request) before the
 * orchestrator's final fallback throws the same
 * "Telegram authentication is required." error as before.
 */
export class CookieRequestActorProvider implements RequestActorProvider {
  async resolve(request: Request): Promise<RequestActorResolution | null> {
    void request;
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    const payload = verifySessionToken(token, getTelegramConfig().webhookSecret);
    if (!payload) throw new ApplicationError("UNAUTHENTICATED", "The session is invalid or expired.");

    const actor = await getMarketingService().requireActorById(payload.userId);
    if (actor.telegramUserId !== payload.telegramUserId) {
      throw new ApplicationError("UNAUTHENTICATED", "The session identity no longer matches.");
    }
    return { actor, source: "COOKIE" };
  }
}
