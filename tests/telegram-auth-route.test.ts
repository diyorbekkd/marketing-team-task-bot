import { afterEach, describe, expect, it, vi } from "vitest";

const testBotToken = ["123456789", "abcdefghijklmnopqrstuvwxyz_ABCD12345"].join(":");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Telegram Mini App authentication route", () => {
  it("returns a sanitized unauthorized response for forged init data", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", testBotToken);
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "test-webhook-secret");
    const { POST } = await import("../src/app/api/auth/telegram/route");
    const response = await POST(new Request("https://tasks.example.com/api/auth/telegram", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        initData: "auth_date=1788700000&user=%7B%22id%22%3A42%2C%22first_name%22%3A%22Forged%22%7D&hash=" + "0".repeat(64),
      }),
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Telegram authentication failed.",
      code: "UNAUTHENTICATED",
    });
  });
});
