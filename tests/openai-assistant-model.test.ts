import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import type { User } from "../src/domain/models";

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: vi.fn() }));
vi.mock("@ai-sdk/openai", () => ({ openai: vi.fn((modelId: string) => ({ modelId })) }));

import { OpenAIAssistantModel } from "../src/server/assistant/openai-assistant-model";

describe("OpenAI API availability", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires a project API key even on Vercel", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(new OpenAIAssistantModel().isAvailable()).toBe(false);
  });

  it("enables the assistant with a server-only OpenAI key", () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    expect(new OpenAIAssistantModel().isAvailable()).toBe(true);
  });

  it("calls the direct OpenAI model without storing responses", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(generateText).mockResolvedValue({ text: "Avval postni tayyorlang.",
      usage: { inputTokens: 25, outputTokens: 8 } } as Awaited<ReturnType<typeof generateText>>);
    const actor = { id: "10000000-0000-4000-8000-000000000001", displayName: "Editor",
      role: "OPERATOR_VIDEO_EDITOR", isActive: true } as User;
    const reply = await new OpenAIAssistantModel().generate({
      actor, question: "Bugun nima qilay?", tasks: [], history: [], users: [actor],
    });
    expect(reply.answer).toBe("Avval postni tayyorlang.");
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: { modelId: "gpt-6.1-terra" },
      maxOutputTokens: 700,
      providerOptions: { openai: { reasoningEffort: "low", store: false } },
    }));
  });
});
