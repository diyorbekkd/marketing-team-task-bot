import { describe, expect, it } from "vitest";
import { handleTelegramUpdate, TelegramUpdateSchema } from "../src/telegram/update";
import { isValidWebhookSecret } from "../src/telegram/webhook-security";

describe("Telegram foundation", () => {
  it("parses a valid update and creates the Sprint 0 start reply", () => {
    const update = TelegramUpdateSchema.parse({
      update_id: 1,
      message: {
        message_id: 2,
        chat: { id: 42, type: "private" },
        text: "/start payload",
      },
    });

    expect(handleTelegramUpdate(update)).toEqual({
      chatId: 42,
      text: "Marketing Team Task Bot is online. Team onboarding will be available in Sprint 1.",
    });
  });

  it("ignores unsupported messages", () => {
    const update = TelegramUpdateSchema.parse({
      update_id: 1,
      message: {
        message_id: 2,
        chat: { id: 42, type: "private" },
        text: "/task",
      },
    });

    expect(handleTelegramUpdate(update)).toBeNull();
  });

  it("compares the webhook secret without accepting missing values", () => {
    expect(isValidWebhookSecret("expected", "expected")).toBe(true);
    expect(isValidWebhookSecret("unexpected", "expected")).toBe(false);
    expect(isValidWebhookSecret(null, "expected")).toBe(false);
  });
});
