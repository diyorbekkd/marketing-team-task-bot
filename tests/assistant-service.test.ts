import { describe, expect, it, vi } from "vitest";
import { AssistantService } from "../src/application/assistant-service";
import type { AssistantRepository, AssistantTurn } from "../src/application/ports/assistant-repository";
import type { AssistantModel } from "../src/application/ports/assistant-model";
import type { MarketingService } from "../src/application/marketing-service";
import type { Task, User } from "../src/domain/models";

const actor = { id: "10000000-0000-4000-8000-000000000001", displayName: "Editor",
  role: "OPERATOR_VIDEO_EDITOR", isActive: true } as User;
const turn: AssistantTurn = { id: "20000000-0000-4000-8000-000000000001", userId: actor.id,
  requestKey: "web_1", source: "WEB", userText: "Bugun nima qilay?", answerText: null,
  status: "PENDING", createdAt: "2026-11-16T12:00:00Z" };
const task = { id: "30000000-0000-4000-8000-000000000001", title: "Post tayyorlash" } as Task;

function fixture() {
  const repository = {
    claim: vi.fn(async () => ({ turn, fresh: true })),
    listRecent: vi.fn(async () => []),
    finish: vi.fn(async () => {}),
  } satisfies AssistantRepository;
  const model = {
    isAvailable: vi.fn(() => true),
    generate: vi.fn(async () => ({ answer: "Avval postni tayyorlang.", inputTokens: 100, outputTokens: 20 })),
  } satisfies AssistantModel;
  const marketing = {
    listTaskPage: vi.fn(async () => ({ tasks: [task] })),
    listUsers: vi.fn(async () => [actor]),
  } as unknown as MarketingService;
  return { service: new AssistantService(repository, model, marketing), repository, model, marketing };
}

describe("assistant authorization and cost boundary", () => {
  it("uses only the actor's scoped tasks and saves one answer", async () => {
    const { service, repository, model, marketing } = fixture();
    const result = await service.respond(actor, { source: "WEB", requestKey: "web_1", text: "Bugun nima qilay?" });
    expect(marketing.listTaskPage).toHaveBeenCalledWith(actor, "my", expect.objectContaining({ pageSize: 20, reportView: "open" }));
    expect(model.generate).toHaveBeenCalledWith(expect.objectContaining({ actor, tasks: [task] }));
    expect(repository.finish).toHaveBeenCalledWith(expect.objectContaining({ answer: "Avval postni tayyorlang." }));
    expect(result.answer).toBe("Avval postni tayyorlang.");
  });

  it("reuses a completed request without another model call", async () => {
    const { service, repository, model } = fixture();
    repository.claim.mockResolvedValue({ turn: { ...turn, status: "COMPLETE", answerText: "Tayyor." }, fresh: false });
    expect(await service.respond(actor, { source: "WEB", requestKey: "web_1", text: "Bugun nima qilay?" }))
      .toMatchObject({ reused: true, answer: "Tayyor." });
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("rejects inactive users before claiming or spending tokens", async () => {
    const { service, repository, model } = fixture();
    await expect(service.respond({ ...actor, isActive: false }, { source: "WEB", requestKey: "web_1", text: "Salom" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.claim).not.toHaveBeenCalled();
    expect(model.generate).not.toHaveBeenCalled();
  });

  it("records a failed generation for a later retry", async () => {
    const { service, repository, model } = fixture();
    model.generate.mockRejectedValue(new Error("provider unavailable"));
    await expect(service.respond(actor, { source: "WEB", requestKey: "web_1", text: "Salom" }))
      .rejects.toMatchObject({ code: "INTEGRATION_UNAVAILABLE" });
    expect(repository.finish).toHaveBeenCalledWith(expect.objectContaining({ answer: null }));
  });
});
