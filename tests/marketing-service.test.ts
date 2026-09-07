import { describe, expect, it, vi } from "vitest";
import { MarketingService } from "../src/application/marketing-service";
import type { AssignmentNotifier } from "../src/application/ports/assignment-notifier";
import type { MarketingRepository } from "../src/application/ports/marketing-repository";
import type { DeadlineChangeRequest, Task, User } from "../src/domain/models";

const ids = {
  head: "10000000-0000-4000-8000-000000000001",
  creator: "10000000-0000-4000-8000-000000000002",
  assignee: "10000000-0000-4000-8000-000000000003",
  unrelated: "10000000-0000-4000-8000-000000000004",
  task: "20000000-0000-4000-8000-000000000001",
  request: "30000000-0000-4000-8000-000000000001",
} as const;

function user(id: string, role: User["role"]): User {
  return {
    id,
    telegramUserId: id === ids.head ? "1001" : id === ids.creator ? "1002" : id === ids.assignee ? "1003" : "1004",
    telegramUsername: null,
    displayName: role,
    role,
    isActive: true,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
}

const head = user(ids.head, "HEAD_OF_MARKETING");
const creator = user(ids.creator, "CONTENT_MARKETER");
const assignee = user(ids.assignee, "SMM_MANAGER");
const unrelated = user(ids.unrelated, "DIGITAL_MARKETER");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: ids.task,
    title: "Launch campaign",
    description: null,
    priority: "normal",
    status: "ASSIGNED",
    creatorId: ids.creator,
    assigneeId: ids.assignee,
    deadline: "2026-09-08T13:00:00.000Z",
    blockedReason: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

function deadlineRequest(overrides: Partial<DeadlineChangeRequest> = {}): DeadlineChangeRequest {
  return {
    id: ids.request,
    taskId: ids.task,
    requestedBy: ids.assignee,
    currentDeadline: "2026-09-08T13:00:00.000Z",
    requestedDeadline: "2026-09-09T13:00:00.000Z",
    reason: "Waiting for approved assets",
    status: "PENDING",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

function repository(overrides: Partial<MarketingRepository> = {}): MarketingRepository {
  return {
    registerTelegramUser: vi.fn(),
    getUserById: vi.fn(async (id) => [head, creator, assignee, unrelated].find((candidate) => candidate.id === id) ?? null),
    getUserByTelegramId: vi.fn(),
    findActiveUserByUsername: vi.fn(),
    listUsers: vi.fn(async () => [head, creator, assignee, unrelated]),
    activateUser: vi.fn(),
    createTask: vi.fn(),
    getTask: vi.fn(async () => task()),
    listTasks: vi.fn(async () => [task()]),
    transitionTask: vi.fn(async (input) => task({ status: input.newStatus })),
    listTaskEvents: vi.fn(async () => []),
    createDeadlineChangeRequest: vi.fn(async () => deadlineRequest()),
    getDeadlineChangeRequest: vi.fn(async () => deadlineRequest()),
    listDeadlineChangeRequests: vi.fn(async () => []),
    resolveDeadlineChangeRequest: vi.fn(async (input) => deadlineRequest({
      status: input.approve ? "APPROVED" : "REJECTED",
      resolvedBy: input.resolvedBy,
      resolvedAt: "2026-09-06T13:00:00.000Z",
    })),
    ...overrides,
  };
}

function notifier(overrides: Partial<AssignmentNotifier> = {}): AssignmentNotifier {
  return {
    notifyAssignment: vi.fn(async () => ({ status: "SENT" as const })),
    ...overrides,
  };
}

describe("MarketingService MVP permissions", () => {
  it("passes the configured Head identity through the onboarding boundary", async () => {
    const repo = repository({ registerTelegramUser: vi.fn(async () => head) });
    const service = new MarketingService(repo, notifier());
    const identity = {
      telegramUserId: "1001",
      telegramUsername: "lead",
      displayName: "Team Lead",
    };

    await expect(service.onboardTelegram(identity, "1001")).resolves.toEqual(head);
    expect(repo.registerTelegramUser).toHaveBeenCalledWith(identity, "1001");
  });

  it("allows only the assignee to accept and block a task", async () => {
    const repo = repository();
    const service = new MarketingService(repo, notifier());

    await expect(service.performTaskAction(creator, ids.task, { action: "ACCEPT" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.performTaskAction(assignee, ids.task, { action: "ACCEPT" });

    expect(repo.transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ids.assignee,
      newStatus: "IN_PROGRESS",
    }));
  });

  it("allows either the creator or Head to complete a reviewed task", async () => {
    const reviewed = task({ status: "REVIEW" });
    for (const reviewer of [creator, head]) {
      const repo = repository({ getTask: vi.fn(async () => reviewed) });
      await new MarketingService(repo, notifier()).performTaskAction(reviewer, ids.task, { action: "APPROVE" });
      expect(repo.transitionTask).toHaveBeenCalledWith(expect.objectContaining({ newStatus: "DONE" }));
    }
  });

  it("preserves cancellation as a terminal state unless Head reopens it", async () => {
    const cancelled = task({ status: "CANCELLED", cancelledAt: "2026-09-06T13:00:00.000Z" });
    const repo = repository({ getTask: vi.fn(async () => cancelled) });
    const service = new MarketingService(repo, notifier());

    await expect(service.performTaskAction(creator, ids.task, { action: "ACCEPT" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.performTaskAction(creator, ids.task, { action: "REOPEN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.performTaskAction(head, ids.task, { action: "REOPEN" });
  });

  it("denies team-wide task data to a normal employee", async () => {
    const service = new MarketingService(repository(), notifier());
    await expect(service.listTasks(assignee, "team")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.listTasks(head, "team")).resolves.toHaveLength(1);
  });

  it("keeps Head's My Tasks personal while team filters remain team-wide", async () => {
    const repo = repository({
      listTasks: vi.fn(async () => [
        task({ id: ids.task, creatorId: ids.head }),
        task({ id: "20000000-0000-4000-8000-000000000002" }),
      ]),
    });
    const service = new MarketingService(repo, notifier());

    await expect(service.listTasks(head, "my")).resolves.toHaveLength(1);
    await expect(service.listTasks(head, "team")).resolves.toHaveLength(2);
  });

  it("activates only pending employees and does not allow Head transfer", async () => {
    const pending = { ...unrelated, isActive: false };
    const repo = repository({ getUserById: vi.fn(async () => pending) });
    const service = new MarketingService(repo, notifier());

    await expect(service.activateUser(assignee, pending.id, "DIGITAL_MARKETER")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.activateUser(head, pending.id, "HEAD_OF_MARKETING")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await service.activateUser(head, pending.id, "DIGITAL_MARKETER");
    expect(repo.activateUser).toHaveBeenCalledWith(pending.id, "DIGITAL_MARKETER");
  });

  it("derives Today and Overdue views in Asia/Tashkent without an OVERDUE status", async () => {
    const repo = repository({
      listTasks: vi.fn(async () => [
        task({ id: ids.task, deadline: "2026-09-06T18:00:00.000Z", status: "BLOCKED", blockedReason: "Dependency" }),
        task({ id: "20000000-0000-4000-8000-000000000002", deadline: "2026-09-07T18:00:00.000Z" }),
      ]),
    });
    const service = new MarketingService(repo, notifier());
    const now = new Date("2026-09-06T20:00:00.000Z");

    await expect(service.listTasks(assignee, "overdue", now)).resolves.toHaveLength(1);
    await expect(service.listTasks(assignee, "today", now)).resolves.toHaveLength(1);
  });

  it("permits only the assignee to request a deadline change", async () => {
    const repo = repository({ getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })) });
    const service = new MarketingService(repo, notifier());
    const input = { requestedDeadline: "2026-09-09T13:00:00.000Z", reason: "Assets are late" };

    await expect(service.requestDeadlineChange(creator, ids.task, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.requestDeadlineChange(assignee, ids.task, input);
    expect(repo.createDeadlineChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: ids.assignee }));
  });

  it("allows only creator or Head to resolve a pending deadline request", async () => {
    const repo = repository();
    const service = new MarketingService(repo, notifier());

    await expect(service.resolveDeadlineChangeRequest(unrelated, ids.request, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.resolveDeadlineChangeRequest(creator, ids.request, true);
    await service.resolveDeadlineChangeRequest(head, ids.request, false);
    expect(repo.resolveDeadlineChangeRequest).toHaveBeenCalledTimes(2);
  });

  it("rejects a request already resolved before invoking the transactional repository", async () => {
    const repo = repository({ getDeadlineChangeRequest: vi.fn(async () => deadlineRequest({ status: "APPROVED" })) });
    const service = new MarketingService(repo, notifier());

    await expect(service.resolveDeadlineChangeRequest(creator, ids.request, true)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repo.resolveDeadlineChangeRequest).not.toHaveBeenCalled();
  });

  it("uses the shared assignment notifier after persisting a task", async () => {
    const created = task();
    const repo = repository({ createTask: vi.fn(async () => created) });
    const assignmentNotifier = notifier();
    const service = new MarketingService(repo, assignmentNotifier);

    const result = await service.createTask(creator, {
      title: created.title,
      assigneeId: assignee.id,
      deadline: created.deadline,
      priority: created.priority,
    });

    expect(result).toEqual({ task: created, assignee, notification: { status: "SENT" } });
    expect(assignmentNotifier.notifyAssignment).toHaveBeenCalledWith({ task: created, creator, assignee });
  });

  it("keeps the persisted task result when assignment delivery fails", async () => {
    const created = task();
    const repo = repository({ createTask: vi.fn(async () => created) });
    const assignmentNotifier = notifier({
      notifyAssignment: vi.fn(async () => { throw new Error("delivery failed"); }),
    });
    const service = new MarketingService(repo, assignmentNotifier);

    const result = await service.createTask(creator, {
      title: created.title,
      assigneeId: assignee.id,
      deadline: created.deadline,
    });

    expect(result.task).toEqual(created);
    expect(result.notification).toEqual({ status: "FAILED", reason: "DELIVERY_FAILED" });
    expect(repo.createTask).toHaveBeenCalledTimes(1);
  });
});
