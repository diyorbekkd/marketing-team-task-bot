import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, SESSION_COOKIE_NAME } from "../src/server/auth/session";
import type { User } from "../src/domain/models";

const WEBHOOK_SECRET = "test-webhook-secret-value-1234567890";

const { cookieGet, requireActorById, getMarketingService, getTelegramConfig } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  requireActorById: vi.fn(),
  getMarketingService: vi.fn(),
  getTelegramConfig: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("../src/server/application", () => ({ getMarketingService }));
vi.mock("../src/server/config", () => ({ getTelegramConfig }));

const ACTOR: User = {
  id: "10000000-0000-4000-8000-000000000001",
  telegramUserId: "555000111",
  telegramUsername: "content_marketer",
  displayName: "Content Marketer",
  role: "CONTENT_MARKETER",
  isActive: true,
  deactivatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("CookieRequestActorProvider (existing Telegram Mini App session behavior)", () => {
  beforeEach(() => {
    cookieGet.mockReset();
    requireActorById.mockReset();
    getMarketingService.mockReset();
    getTelegramConfig.mockReset();
    getMarketingService.mockReturnValue({ requireActorById });
    getTelegramConfig.mockReturnValue({ webhookSecret: WEBHOOK_SECRET, botToken: "unused" });
  });

  it("resolves the real actor for a valid session cookie -- unchanged from before this refactor", async () => {
    const token = createSessionToken({ userId: ACTOR.id, telegramUserId: ACTOR.telegramUserId }, WEBHOOK_SECRET);
    cookieGet.mockReturnValue({ name: SESSION_COOKIE_NAME, value: token });
    requireActorById.mockResolvedValue(ACTOR);

    const { CookieRequestActorProvider } = await import("../src/server/auth/cookie-request-actor-provider");
    const resolution = await new CookieRequestActorProvider().resolve(new Request("https://tasks.example.com/api/auth/me"));

    expect(requireActorById).toHaveBeenCalledWith(ACTOR.id);
    expect(resolution).toEqual({ actor: ACTOR, source: "COOKIE" });
  });

  it("returns null (not applicable) when there is no session cookie at all", async () => {
    cookieGet.mockReturnValue(undefined);
    const { CookieRequestActorProvider } = await import("../src/server/auth/cookie-request-actor-provider");
    const resolution = await new CookieRequestActorProvider().resolve(new Request("https://tasks.example.com/api/auth/me"));
    expect(resolution).toBeNull();
  });

  it("throws UNAUTHENTICATED for a malformed/expired session token, with the original message", async () => {
    cookieGet.mockReturnValue({ name: SESSION_COOKIE_NAME, value: "not-a-real-token" });
    const { CookieRequestActorProvider } = await import("../src/server/auth/cookie-request-actor-provider");
    await expect(new CookieRequestActorProvider().resolve(new Request("https://tasks.example.com/api/auth/me")))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", message: "The session is invalid or expired." });
  });

  it("throws UNAUTHENTICATED when the session's telegramUserId no longer matches the stored actor", async () => {
    const token = createSessionToken({ userId: ACTOR.id, telegramUserId: ACTOR.telegramUserId }, WEBHOOK_SECRET);
    cookieGet.mockReturnValue({ name: SESSION_COOKIE_NAME, value: token });
    requireActorById.mockResolvedValue({ ...ACTOR, telegramUserId: "999999999" });

    const { CookieRequestActorProvider } = await import("../src/server/auth/cookie-request-actor-provider");
    await expect(new CookieRequestActorProvider().resolve(new Request("https://tasks.example.com/api/auth/me")))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", message: "The session identity no longer matches." });
  });
});
