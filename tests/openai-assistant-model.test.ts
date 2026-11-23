import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { User } from "../src/domain/models";

vi.mock("server-only", () => ({}));
vi.mock("ai", () => ({ generateText: vi.fn(), Output: { object: vi.fn((value) => value) } }));
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
    vi.mocked(generateText).mockResolvedValue({ output: { answer: "Avval postni tayyorlang.", action: null },
      usage: { inputTokens: 25, outputTokens: 8 } } as Awaited<ReturnType<typeof generateText>>);
    const actor = { id: "10000000-0000-4000-8000-000000000001", displayName: "Editor",
      role: "OPERATOR_VIDEO_EDITOR", isActive: true } as User;
    const reply = await new OpenAIAssistantModel().generate({
      actor, question: "Bugun nima qilay?", tasks: [], history: [], users: [actor],
    });
    expect(reply.answer).toBe("Avval postni tayyorlang.");
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      model: { modelId: "gpt-6.1-terra" },
      maxOutputTokens: 900,
      providerOptions: { openai: { reasoningEffort: "low", store: false } },
    }));
  });

  it("omits failed history turns rather than sending an empty assistant message", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(generateText).mockResolvedValue({ output: { answer: "Tushunarli.", action: null },
      usage: { inputTokens: 25, outputTokens: 8 } } as Awaited<ReturnType<typeof generateText>>);
    const actor = { id: "10000000-0000-4000-8000-000000000001", displayName: "Editor",
      role: "OPERATOR_VIDEO_EDITOR", isActive: true } as User;
    await new OpenAIAssistantModel().generate({ actor, question: "Keyingi qadam?", tasks: [], users: [actor],
      history: [{ userText: "Oldingi savol", answerText: null }] as Parameters<OpenAIAssistantModel["generate"]>[0]["history"],
    });
    const args = vi.mocked(generateText).mock.calls.at(-1)?.[0];
    expect(args?.messages).toHaveLength(1);
    expect(args?.messages?.[0]).toMatchObject({ role: "user" });
  });

  it("sends an OpenAI-compatible structured output schema for all proposed actions", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.mocked(generateText).mockResolvedValue({ output: { answer: "Tushunarli.", action: null },
      usage: { inputTokens: 25, outputTokens: 8 } } as Awaited<ReturnType<typeof generateText>>);
    const actor = { id: "10000000-0000-4000-8000-000000000001", displayName: "Editor",
      role: "OPERATOR_VIDEO_EDITOR", isActive: true } as User;
    await new OpenAIAssistantModel().generate({ actor, question: "Checkpoint qo‘sh", tasks: [], history: [], users: [actor] });
    const outputOptions = vi.mocked(Output.object).mock.calls.at(-1)?.[0] as unknown as { schema: z.ZodType };
    const schema = outputOptions.schema;
    const json = z.toJSONSchema(schema, { target: "draft-07" });
    const encoded = JSON.stringify(json);
    expect(encoded).not.toContain('"oneOf"');
    expect(encoded).not.toContain('"const"');
    expect((json.properties?.action as { anyOf?: unknown[] })?.anyOf).toHaveLength(5);
  });
});
