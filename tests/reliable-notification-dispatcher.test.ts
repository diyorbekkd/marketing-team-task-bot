import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarketingRepository, NotificationOutboxRecord } from "../src/application/ports/marketing-repository";
import type { NotificationDispatcher } from "../src/application/ports/notification-dispatcher";
import type { ReportDispatcher } from "../src/application/ports/report-dispatcher";
import type { Task, User } from "../src/domain/models";
import { NotificationRetryService, ReliableNotificationDispatcher } from "../src/server/notifications/reliable-notification-dispatcher";

const creator: User = {
  id: "10000000-0000-4000-8000-000000000001", telegramUserId: "101", telegramUsername: "creator",
  displayName: "Creator", role: "CONTENT_MARKETER", isActive: true, deactivatedAt: null,
  createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z",
};
const assignee: User = {
  ...creator, id: "10000000-0000-4000-8000-000000000002", telegramUserId: "102",
  telegramUsername: "assignee", displayName: "Assignee", role: "SMM_MANAGER",
};
const task: Task = {
  id: "20000000-0000-4000-8000-000000000001", title: "Reels", description: null,
  priority: "high", status: "IN_PROGRESS", creatorId: creator.id, assigneeId: assignee.id,
  deadline: "2026-11-15T10:00:00.000Z", publicationAt: "2026-11-17T10:00:00.000Z",
  blockedReason: null, completedAt: null, cancelledAt: null,
  createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z",
};

function outbox(overrides: Partial<NotificationOutboxRecord> = {}): NotificationOutboxRecord {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    dedupeKey: "assignment:key",
    notificationType: "ASSIGNMENT",
    recipientUserId: assignee.id,
    taskId: task.id,
    payload: { kind: "ASSIGNMENT", input: { task, creator, assignee } },
    status: "PENDING",
    attemptCount: 0,
    ...overrides,
  };
}

function repository(overrides: Partial<MarketingRepository> = {}): MarketingRepository {
  return {
    enqueueNotification: vi.fn(async () => outbox()),
    enqueueShootScenarioNotification: vi.fn(async () => outbox({ notificationType: "SHOOT_SCENARIO", recipientUserId: null })),
    claimNotification: vi.fn(async () => true),
    claimDueNotifications: vi.fn(async () => []),
    completeNotification: vi.fn(async () => undefined),
    getNotificationPreferences: vi.fn(async () => ({ assignments: true, workflow: true, reminders: true, dailyCheck: true, reports: true })),
    updateNotificationPreferences: vi.fn(async (_userId, preferences) => preferences),
    ...overrides,
  } as unknown as MarketingRepository;
}

function dispatcher(overrides: Partial<NotificationDispatcher & ReportDispatcher> = {}): NotificationDispatcher & ReportDispatcher {
  return {
    notifyAssignment: vi.fn(async () => ({ status: "SENT" as const })),
    notifyBulkAssignment: vi.fn(async () => ({ status: "SENT" as const })),
    notifyWorkflow: vi.fn(async ({ recipients }) => ({
      deliveries: recipients.map((recipient: User) => ({ recipientUserId: recipient.id, status: "SENT" as const })),
    })),
    notifyReminder: vi.fn(async () => ({ deliveries: [] })),
    sendTopicMessage: vi.fn(async () => undefined),
    sendReport: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("durable Telegram notification outbox", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps shoot topic delivery off until both destination IDs are configured", async () => {
    vi.stubEnv("VIDEO_MEDIA_CHAT_ID", "");
    vi.stubEnv("VIDEO_MEDIA_TOPIC_ID", "");
    const repo = repository();
    const result = await new ReliableNotificationDispatcher(repo, dispatcher()).queueShootScenario({
      task, scenarioUrl: "https://example.com/scenario", changeToken: task.createdAt,
    });
    expect(result).toBe("SKIPPED");
    expect(repo.enqueueShootScenarioNotification).not.toHaveBeenCalled();
  });

  it("queues the scenario once for a configured group topic and retries delivery", async () => {
    vi.stubEnv("VIDEO_MEDIA_CHAT_ID", "-1001234567890");
    vi.stubEnv("VIDEO_MEDIA_TOPIC_ID", "42");
    const queued = outbox({ notificationType: "SHOOT_SCENARIO", recipientUserId: null,
      payload: { kind: "SHOOT_SCENARIO", input: { chatId: "-1001234567890", topicId: 42,
        text: "🎬 Syomka ssenariysi\nReels\n\nhttps://example.com/scenario" } } });
    const repo = repository({ enqueueShootScenarioNotification: vi.fn(async () => queued),
      claimDueNotifications: vi.fn(async () => [queued]) });
    const inner = dispatcher();
    const queue = new ReliableNotificationDispatcher(repo, inner);
    await queue.queueShootScenario({ task, scenarioUrl: "https://example.com/scenario", changeToken: task.createdAt });
    await queue.queueShootScenario({ task, scenarioUrl: "https://example.com/scenario", changeToken: task.createdAt });
    expect(repo.enqueueShootScenarioNotification).toHaveBeenCalledTimes(2);
    expect(vi.mocked(repo.enqueueShootScenarioNotification).mock.calls[0][0].dedupeKey)
      .toBe(vi.mocked(repo.enqueueShootScenarioNotification).mock.calls[1][0].dedupeKey);
    await queue.queueShootScenario({ task, scenarioUrl: "https://example.com/scenario", changeToken: "later-edit" });
    expect(vi.mocked(repo.enqueueShootScenarioNotification).mock.calls[2][0].dedupeKey)
      .not.toBe(vi.mocked(repo.enqueueShootScenarioNotification).mock.calls[1][0].dedupeKey);
    await new NotificationRetryService(repo, inner).deliver();
    expect(inner.sendTopicMessage).toHaveBeenCalledWith({ chatId: "-1001234567890", topicId: 42,
      text: expect.stringContaining("https://example.com/scenario") });
    expect(repo.completeNotification).toHaveBeenCalledWith({ id: queued.id, sent: true, error: undefined });
  });
  it("queues a browser assignment without waiting for Telegram", async () => {
    const repo = repository();
    const inner = dispatcher();
    const result = await new ReliableNotificationDispatcher(repo, inner)
      .queueAssignment({ task, creator, assignee });

    expect(result).toBe("QUEUED");
    expect(repo.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: "ASSIGNMENT", recipientUserId: assignee.id, taskId: task.id,
    }));
    expect(inner.notifyAssignment).not.toHaveBeenCalled();
    expect(repo.claimNotification).not.toHaveBeenCalled();
  });

  it("queues workflow notifications per recipient without sending them inline", async () => {
    const repo = repository();
    const inner = dispatcher();
    await new ReliableNotificationDispatcher(repo, inner).queueWorkflow({
      event: "TASK_COMPLETED", task, actor: creator, recipients: [assignee],
    });
    expect(repo.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: "WORKFLOW", recipientUserId: assignee.id, taskId: task.id,
    }));
    expect(inner.notifyWorkflow).not.toHaveBeenCalled();
  });

  it("queues the new plan and step activation messages with valid retry payloads", async () => {
    const repo = repository();
    const queue = new ReliableNotificationDispatcher(repo, dispatcher());
    for (const event of ["WORKFLOW_PLAN_SHARED", "WORKFLOW_STEP_ACTIVATED"] as const) {
      await queue.queueWorkflow({ event, task, actor: creator, recipients: [assignee] });
    }
    expect(repo.enqueueNotification).toHaveBeenCalledTimes(2);
  });

  it("claims before sending and marks the per-recipient row sent", async () => {
    const repo = repository();
    const inner = dispatcher();
    const result = await new ReliableNotificationDispatcher(repo, inner)
      .notifyAssignment({ task, creator, assignee });

    expect(result).toEqual({ status: "SENT" });
    expect(repo.enqueueNotification).toHaveBeenCalledWith(expect.objectContaining({
      notificationType: "ASSIGNMENT", recipientUserId: assignee.id, taskId: task.id,
    }));
    expect(repo.claimNotification).toHaveBeenCalledWith(outbox().id);
    expect(repo.completeNotification).toHaveBeenCalledWith({ id: outbox().id, sent: true, error: undefined });
  });

  it("persists failure for bounded cron retry instead of silently losing it", async () => {
    const repo = repository();
    const inner = dispatcher({ notifyAssignment: vi.fn(async () => ({ status: "FAILED" as const, reason: "DELIVERY_FAILED" as const })) });
    const result = await new ReliableNotificationDispatcher(repo, inner)
      .notifyAssignment({ task, creator, assignee });

    expect(result.status).toBe("FAILED");
    expect(repo.completeNotification).toHaveBeenCalledWith({
      id: outbox().id, sent: false, error: "DELIVERY_FAILED",
    });
  });

  it("replays due rows and completes them without creating a second outbox row", async () => {
    const due = outbox({ status: "CLAIMED", attemptCount: 2 });
    const repo = repository({ claimDueNotifications: vi.fn(async () => [due]) });
    const inner = dispatcher();
    const result = await new NotificationRetryService(repo, inner).deliver();

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0 });
    expect(inner.notifyAssignment).toHaveBeenCalledTimes(1);
    expect(repo.enqueueNotification).not.toHaveBeenCalled();
    expect(repo.completeNotification).toHaveBeenCalledWith({ id: due.id, sent: true, error: undefined });
  });
});
