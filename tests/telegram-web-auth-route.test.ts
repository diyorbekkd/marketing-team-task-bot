import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { verifyTelegramWebIdToken, requireActorByTelegramId } = vi.hoisted(() => ({
  verifyTelegramWebIdToken: vi.fn(),
  requireActorByTelegramId: vi.fn(),
}));

vi.mock("../src/server/config", () => ({
  getAppConfig: () => ({ appUrl: "https://tasks.example.com" }),
  getTelegramWebConfig: () => ({ clientId: "test-bot", clientSecret: "test-secret" }),
  getTelegramConfig: () => ({ webhookSecret: "a-safe-test-webhook-secret" }),
}));
vi.mock("../src/server/application", () => ({
  getMarketingService: () => ({ requireActorByTelegramId }),
}));
vi.mock("../src/server/auth/telegram-web-login", async (original) => ({
  ...await original<typeof import("../src/server/auth/telegram-web-login")>(),
  verifyTelegramWebIdToken,
}));

describe("Telegram web OAuth routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    verifyTelegramWebIdToken.mockReset();
    requireActorByTelegramId.mockReset();
  });

  it("starts a PKCE flow with an HttpOnly state cookie", async () => {
    const { GET } = await import("../src/app/api/auth/web/start/route");
    const response = await GET(new NextRequest("https://tasks.example.com/api/auth/web/start"));
    const url = new URL(response.headers.get("location")!);

    expect(url.origin).toBe("https://oauth.telegram.org");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe("https://tasks.example.com/api/auth/web/callback");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("rejects a callback with a mismatched state before token exchange", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { GET } = await import("../src/app/api/auth/web/callback/route");
    const response = await GET(new NextRequest("https://tasks.example.com/api/auth/web/callback?code=code&state=wrong"));
    expect(response.headers.get("location")).toBe("https://tasks.example.com/?web_login=invalid");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("exchanges a valid code and creates the existing signed app session", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ id_token: "signed-id-token" }), { status: 200 }),
    );
    verifyTelegramWebIdToken.mockResolvedValueOnce("123456789");
    requireActorByTelegramId.mockResolvedValueOnce({ id: "10000000-0000-4000-8000-000000000001" });
    const { GET: start } = await import("../src/app/api/auth/web/start/route");
    const started = await start(new NextRequest("https://tasks.example.com/api/auth/web/start"));
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const cookie = started.headers.get("set-cookie")!.split(";")[0];
    const { GET: callback } = await import("../src/app/api/auth/web/callback/route");
    const response = await callback(new NextRequest(
      `https://tasks.example.com/api/auth/web/callback?code=code&state=${state}`,
      { headers: { cookie } },
    ));

    expect(response.headers.get("location")).toBe("https://tasks.example.com/");
    expect(response.cookies.get("marketing_session")?.value).toBeTruthy();
    expect(verifyTelegramWebIdToken).toHaveBeenCalledWith("signed-id-token", "test-bot");
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(requireActorByTelegramId).toHaveBeenCalledWith("123456789");
  });
});
