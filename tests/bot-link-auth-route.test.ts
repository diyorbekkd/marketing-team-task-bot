import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getTelegramBotUsername, createWebBotLogin, consumeWebBotLogin } = vi.hoisted(() => ({
  getTelegramBotUsername: vi.fn(), createWebBotLogin: vi.fn(), consumeWebBotLogin: vi.fn(),
}));

vi.mock("../src/telegram/client", () => ({ getTelegramBotUsername }));
vi.mock("../src/server/config", () => ({
  getTelegramConfig: () => ({ botToken: "test-token", webhookSecret: "a-safe-test-webhook-secret" }),
}));
vi.mock("../src/server/application", () => ({
  getMarketingService: () => ({ createWebBotLogin, consumeWebBotLogin }),
}));

describe("bot deep-link browser login", () => {
  beforeEach(() => {
    getTelegramBotUsername.mockReset().mockResolvedValue("ibox_task_test_bot");
    createWebBotLogin.mockReset().mockResolvedValue({
      code: `wl_${"a".repeat(24)}`, browserToken: "b".repeat(43), expiresAt: new Date("2026-11-15T10:10:00Z"),
    });
    consumeWebBotLogin.mockReset();
  });

  it("returns a bot link and binds the browser to an HttpOnly cookie", async () => {
    const { POST } = await import("../src/app/api/auth/link/start/route");
    const response = await POST(new NextRequest("https://tasks.example.com/api/auth/link/start", { method: "POST" }));
    const result = await response.json();
    expect(result.url).toBe(`https://t.me/ibox_task_test_bot?start=wl_${"a".repeat(24)}`);
    expect(response.headers.get("set-cookie")).toContain("marketing_web_bot_login=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
  });

  it("issues the app session only when that browser's challenge is approved", async () => {
    const { POST } = await import("../src/app/api/auth/link/complete/route");
    const cookie = `marketing_web_bot_login=${"b".repeat(43)}`;
    consumeWebBotLogin.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "10000000-0000-4000-8000-000000000001", telegramUserId: "42",
    });
    const pending = await POST(new NextRequest("https://tasks.example.com/api/auth/link/complete", {
      method: "POST", headers: { cookie },
    }));
    expect((await pending.json()).status).toBe("PENDING");
    expect(pending.headers.get("set-cookie")).toBeNull();

    const completed = await POST(new NextRequest("https://tasks.example.com/api/auth/link/complete", {
      method: "POST", headers: { cookie },
    }));
    expect((await completed.json()).status).toBe("SIGNED_IN");
    expect(completed.headers.get("set-cookie")).toContain("marketing_session=");
    expect(consumeWebBotLogin).toHaveBeenCalledWith("b".repeat(43));
  });

  it("cannot complete login without the initiating browser cookie", async () => {
    const { POST } = await import("../src/app/api/auth/link/complete/route");
    const response = await POST(new NextRequest("https://tasks.example.com/api/auth/link/complete", { method: "POST" }));
    expect((await response.json()).status).toBe("EXPIRED");
    expect(consumeWebBotLogin).not.toHaveBeenCalled();
  });
});
