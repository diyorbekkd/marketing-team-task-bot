import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramMessage } from "../src/telegram/client";

describe("Telegram Bot API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("includes the forum message_thread_id in the sendMessage request", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/sendMessage");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        chat_id: "-1001234567890", message_thread_id: 42, text: "Ssenariy havolasi",
      });
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendTelegramMessage("test-token", {
      chatId: "-1001234567890", messageThreadId: 42, text: "Ssenariy havolasi",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
