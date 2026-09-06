import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendTelegramMessage = vi.fn();

vi.mock("../src/telegram/client", () => ({
  sendTelegramMessage,
}));

const validEnvironment = {
  TELEGRAM_BOT_TOKEN: "123456789:abcdefghijklmnopqrstuvwxyz_ABCD12345",
  TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
};

describe("Telegram webhook route", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(validEnvironment)) {
      vi.stubEnv(name, value);
    }
    sendTelegramMessage.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects requests with an invalid webhook secret", async () => {
    const { POST } = await import("../src/app/api/telegram/webhook/route");
    const response = await POST(
      new Request("https://tasks.example.com/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "wrong-secret",
        },
        body: JSON.stringify({ update_id: 1 }),
      }),
    );

    expect(response.status).toBe(401);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("returns a sanitized retryable response when reply delivery fails", async () => {
    sendTelegramMessage.mockRejectedValueOnce(new Error("secret-bearing transport details"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { POST } = await import("../src/app/api/telegram/webhook/route");
    const response = await POST(
      new Request("https://tasks.example.com/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": "test-webhook-secret",
        },
        body: JSON.stringify({
          update_id: 2,
          message: {
            message_id: 3,
            chat: { id: 42, type: "private" },
            text: "/start",
          },
        }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Telegram reply delivery failed." });
    expect(log).toHaveBeenCalledWith("Failed to deliver Telegram reply.");
  });
});
