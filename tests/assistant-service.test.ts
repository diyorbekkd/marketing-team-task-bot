import { describe, expect, it, vi } from "vitest";
import { AssistantService } from "../src/application/assistant-service";
import type { AssistantRepository, AssistantTurn } from "../src/application/ports/assistant-repository";
import type { AssistantModel } from "../src/application/ports/assistant-model";
import type { MarketingService } from "../src/application/marketing-service";
import type { Task, User } from "../src/domain/models";
import { ApplicationError } from "../src/application/errors";

const actor = { id: "10000000-0000-4000-8000-000000000001", displayName: "Editor",
  role: "OPERATOR_VIDEO_EDITOR", isActive: true } as User;
const turn: AssistantTurn = { id: "20000000-0000-4000-8000-000000000001", userId: actor.id,
  requestKey: "web_1", source: "WEB", userText: "Bugun nima qilay?", answerText: null,
  status: "PENDING", createdAt: "2026-11-16T12:00:00Z",
  proposal: null, proposalStatus: null, proposalExpiresAt: null, actionResult: null };
const task = { id: "30000000-0000-4000-8000-000000000001", title: "Post tayyorlash",
  assigneeId: actor.id, creatorId: actor.id, status: "ASSIGNED" } as Task;

function fixture() {
  const repository = {
    claim: vi.fn(async () => ({ turn, fresh: true })),
    listRecent: vi.fn(async () => []),
    finish: vi.fn(async () => {}),
    setProposal: vi.fn(async () => {}),
    claimAction: vi.fn<AssistantRepository["claimAction"]>(async () => ({ fresh: false, result: "Bajarildi." })),
    finishAction: vi.fn(async () => {}),
  } satisfies AssistantRepository;
  const model = {
    isAvailable: vi.fn(() => true),
    generate: vi.fn<AssistantModel["generate"]>(async () => ({ answer: "Avval postni tayyorlang.", action: null,
      inputTokens: 100, outputTokens: 20 })),
  } satisfies AssistantModel;
  const marketing = {
    listTaskPage: vi.fn(async () => ({ tasks: [task] })),
    listUsers: vi.fn(async () => [actor]),
    createTaskQueued: vi.fn(async () => ({ task, assignee: actor, notification: { status: "QUEUED" } })),
    performTaskAction: vi.fn(async () => ({ ...task, status: "IN_PROGRESS" })),
    requestDeadlineChange: vi.fn(async () => ({ id: "40000000-0000-4000-8000-000000000001" })),
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

  it("proposes task creation and executes it only after a one-time confirmation", async () => {
    const { service, repository, model, marketing } = fixture();
    const action = { kind: "CREATE_TASK" as const, title: "Reels tayyorlash", assigneeId: actor.id,
      deadline: "2099-11-20T12:00:00+05:00", priority: "normal" as const, description: null };
    model.generate.mockResolvedValue({ answer: "Shu vazifani ochishni taklif qilaman.", action,
      inputTokens: 40, outputTokens: 20 });
    const response = await service.respond(actor, { source: "WEB", requestKey: "web_2", text: "Reels vazifasini och" });
    expect(response.proposal?.action).toEqual(action);
    expect(marketing.createTaskQueued).not.toHaveBeenCalled();
    expect(repository.setProposal).toHaveBeenCalledWith(expect.objectContaining({ proposal: response.proposal }));
    repository.claimAction.mockResolvedValueOnce({ fresh: true, proposal: response.proposal! });
    const confirmed = await service.confirm(actor, turn.id);
    expect(confirmed.answer).toContain("Vazifa yaratildi");
    expect(marketing.createTaskQueued).toHaveBeenCalledOnce();
    expect(repository.finishAction).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect((await service.confirm(actor, turn.id)).reused).toBe(true);
    expect(marketing.createTaskQueued).toHaveBeenCalledOnce();
  });

  it("offers only a permitted, unambiguous status proposal before confirmation", async () => {
    const { service, model, repository, marketing } = fixture();
    model.generate.mockResolvedValue({ answer: "Ishni boshlash mumkin.",
      action: { kind: "CHANGE_STATUS", taskId: task.id, action: "ACCEPT", reason: null, nextDeadline: null },
      inputTokens: 30, outputTokens: 15 });
    const response = await service.respond(actor, { source: "WEB", requestKey: "web_3", text: "Postni boshladim" });
    expect(response.proposal?.summary).toContain("Ishni boshlash");
    expect(marketing.performTaskAction).not.toHaveBeenCalled();
    expect(repository.setProposal).toHaveBeenCalledWith(expect.objectContaining({ proposal: response.proposal }));

    model.generate.mockResolvedValueOnce({ answer: "Tasdiqlayman.",
      action: { kind: "CHANGE_STATUS", taskId: task.id, action: "APPROVE", reason: null, nextDeadline: null },
      inputTokens: 30, outputTokens: 15 });
    const forbidden = await service.respond({ ...actor, id: "10000000-0000-4000-8000-000000000099" },
      { source: "WEB", requestKey: "web_4", text: "Postni tasdiqla" });
    expect(forbidden.proposal).toBeNull();
  });

  it("does not guess between two visible tasks with the same title", async () => {
    const { service, model, marketing } = fixture();
    vi.mocked(marketing.listTaskPage).mockResolvedValue({ tasks: [task, {
      ...task, id: "30000000-0000-4000-8000-000000000002",
    }] } as Awaited<ReturnType<MarketingService["listTaskPage"]>>);
    model.generate.mockResolvedValue({ answer: "Birinchi postni boshlaymiz.",
      action: { kind: "CHANGE_STATUS", taskId: task.id, action: "ACCEPT", reason: null, nextDeadline: null },
      inputTokens: 30, outputTokens: 15 });
    const response = await service.respond(actor, { source: "WEB", requestKey: "web_5", text: "Post tayyorlashni boshladim" });
    expect(response.proposal).toBeNull();
  });

  it("routes status changes and deadline requests through the permission-checking service", async () => {
    const { service, repository, marketing } = fixture();
    repository.claimAction.mockResolvedValueOnce({ fresh: true, proposal: { summary: "Holatni o‘zgartirish",
      action: { kind: "CHANGE_STATUS", taskId: task.id, action: "ACCEPT", reason: null, nextDeadline: null } } });
    await service.confirm(actor, turn.id);
    expect(marketing.performTaskAction).toHaveBeenCalledWith(actor, task.id,
      { action: "ACCEPT" }, { deferNotifications: true });

    repository.claimAction.mockResolvedValueOnce({ fresh: true, proposal: { summary: "Muddat so‘rovi",
      action: { kind: "REQUEST_DEADLINE", taskId: task.id,
        requestedDeadline: "2099-11-21T12:00:00+05:00", reason: "Mijoz javobi kutilmoqda" } } });
    await service.confirm(actor, turn.id);
    expect(marketing.requestDeadlineChange).toHaveBeenCalledWith(actor, task.id,
      { requestedDeadline: "2099-11-21T12:00:00+05:00", reason: "Mijoz javobi kutilmoqda" });
  });

  it("records a refused task action and never reports it as complete", async () => {
    const { service, repository, marketing } = fixture();
    repository.claimAction.mockResolvedValueOnce({ fresh: true, proposal: { summary: "Tasdiqlash",
      action: { kind: "CHANGE_STATUS", taskId: task.id, action: "APPROVE", reason: null, nextDeadline: null } } });
    vi.mocked(marketing.performTaskAction).mockRejectedValueOnce(new ApplicationError("FORBIDDEN", "Ruxsat yo‘q."));
    await expect(service.confirm(actor, turn.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.finishAction).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
