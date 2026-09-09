import { describe, expect, it, vi } from "vitest";
import { ReminderService } from "../src/application/reminder-service";
import type { MarketingRepository } from "../src/application/ports/marketing-repository";
import type { NotificationDispatcher, ReminderNotificationInput } from "../src/application/ports/notification-dispatcher";
import type { Task, User } from "../src/domain/models";

const head: User = {
  id: "10000000-0000-4000-8000-000000000001", telegramUserId: "1001", telegramUsername: "head",
  displayName: "Head", role: "HEAD_OF_MARKETING", isActive: true, deactivatedAt: null,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
};
const assignee: User = { ...head, id: "10000000-0000-4000-8000-000000000002", telegramUserId: "1002", displayName: "Diyorbek", role: "SMM_MANAGER" };
const creator: User = { ...head, id: "10000000-0000-4000-8000-000000000003", telegramUserId: "1003", displayName: "Aziz", role: "CONTENT_MARKETER" };
const inactiveCreator: User = { ...creator, isActive: false, deactivatedAt: "2026-09-02T00:00:00Z" };

const DEADLINE = "2026-09-10T13:00:00.000Z"; // 18:00 Tashkent
// Chosen so only H1_OVERDUE is inside its catch-up window: H3_BEFORE and
// AT_DEADLINE's windows have already closed, H24_OVERDUE hasn't opened yet.
// Keeps each test's assertions about a single reminder delivery unambiguous.
const NOW = new Date("2026-09-10T19:30:00.000Z"); // 5h30m overdue

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "20000000-0000-4000-8000-000000000001", title: "Import creative", description: null,
    priority: "normal", status: "IN_PROGRESS", creatorId: creator.id, assigneeId: assignee.id,
    deadline: DEADLINE, blockedReason: null, completedAt: null, cancelledAt: null,
    createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z",
    ...overrides,
  };
}

function repository(overrides: Partial<MarketingRepository> = {}): MarketingRepository {
  return {
    listTasks: vi.fn(async () => [task()]),
    listUsers: vi.fn(async () => [head, creator, assignee]),
    claimReminderDelivery: vi.fn(async () => true),
    completeReminderDelivery: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as MarketingRepository;
}

function dispatcher(overrides: Partial<NotificationDispatcher> = {}): NotificationDispatcher {
  return {
    notifyReminder: vi.fn(async ({ recipients }: ReminderNotificationInput) => ({
      deliveries: recipients.map((recipient) => ({ recipientUserId: recipient.id, status: "SENT" as const })),
    })),
    ...overrides,
  } as unknown as NotificationDispatcher;
}

describe("deadline reminder delivery", () => {
  it("does not remind on a DONE task", async () => {
    const repo = repository({ listTasks: vi.fn(async () => [task({ status: "DONE", completedAt: "2026-09-09T00:00:00Z" })]) });
    const notifier = dispatcher();
    const result = await new ReminderService(repo, notifier).deliver(NOW);
    expect(result.tasksChecked).toBe(0);
    expect(notifier.notifyReminder).not.toHaveBeenCalled();
  });

  it("does not remind on a CANCELLED task", async () => {
    const repo = repository({ listTasks: vi.fn(async () => [task({ status: "CANCELLED", cancelledAt: "2026-09-09T00:00:00Z" })]) });
    const notifier = dispatcher();
    const result = await new ReminderService(repo, notifier).deliver(NOW);
    expect(result.tasksChecked).toBe(0);
    expect(notifier.notifyReminder).not.toHaveBeenCalled();
  });

  it("sends upcoming reminders to the assignee only", async () => {
    const repo = repository();
    const notifier = dispatcher();
    await new ReminderService(repo, notifier).deliver(new Date("2026-09-09T13:05:00.000Z")); // 24h before
    expect(notifier.notifyReminder).toHaveBeenCalledWith(expect.objectContaining({
      reminderType: "H24_BEFORE",
      recipients: [assignee],
    }));
  });

  it("escalates an overdue reminder to the assignee, creator, and Head", async () => {
    const repo = repository();
    const notifier = dispatcher();
    await new ReminderService(repo, notifier).deliver(NOW);
    expect(notifier.notifyReminder).toHaveBeenCalledWith(expect.objectContaining({
      reminderType: "H1_OVERDUE",
      recipients: expect.arrayContaining([assignee, creator, head]),
    }));
  });

  it("deduplicates recipients when the assignee is also the creator", async () => {
    const repo = repository({ listTasks: vi.fn(async () => [task({ creatorId: assignee.id })]) });
    const notifier = dispatcher();
    await new ReminderService(repo, notifier).deliver(NOW);
    const call = (notifier.notifyReminder as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReminderNotificationInput;
    expect(call.recipients.filter((recipient) => recipient.id === assignee.id)).toHaveLength(1);
  });

  it("skips an inactive recipient without fabricating a chat ID or failing the sweep", async () => {
    const repo = repository({ listUsers: vi.fn(async () => [head, inactiveCreator, assignee]) });
    const notifier = dispatcher();
    const result = await new ReminderService(repo, notifier).deliver(NOW);
    expect(notifier.notifyReminder).toHaveBeenCalledWith(expect.objectContaining({
      recipients: expect.not.arrayContaining([expect.objectContaining({ id: inactiveCreator.id })]),
    }));
    expect(result.failed).toBe(0);
  });

  it("does not resend when the scheduler runs twice for the same task and deadline", async () => {
    let claimed = false;
    const repo = repository({
      claimReminderDelivery: vi.fn(async () => {
        if (claimed) return false;
        claimed = true;
        return true;
      }),
    });
    const notifier = dispatcher();
    const service = new ReminderService(repo, notifier);

    const first = await service.deliver(NOW);
    const second = await service.deliver(NOW);

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.deduplicated).toBe(1);
    expect(notifier.notifyReminder).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh reminder cycle when the deadline changes", async () => {
    const claims: string[] = [];
    const repo = repository({
      claimReminderDelivery: vi.fn(async (input) => {
        const key = `${input.taskId}:${input.deadline}:${input.reminderType}`;
        if (claims.includes(key)) return false;
        claims.push(key);
        return true;
      }),
    });
    const notifier = dispatcher();
    const service = new ReminderService(repo, notifier);

    await service.deliver(NOW); // original deadline, H1_OVERDUE claimed
    const newDeadline = "2026-09-11T15:00:00.000Z";
    const laterRepo = repository({
      listTasks: vi.fn(async () => [task({ deadline: newDeadline })]),
      claimReminderDelivery: repo.claimReminderDelivery,
    });
    const laterNow = new Date("2026-09-11T21:00:00.000Z"); // 5h after the NEW deadline, same isolated-window shape as NOW
    const result = await new ReminderService(laterRepo, notifier).deliver(laterNow);

    expect(result.sent).toBe(1);
    expect(notifier.notifyReminder).toHaveBeenCalledTimes(2);
  });

  it("does not corrupt task state when Telegram delivery fails", async () => {
    const repo = repository();
    const notifier = dispatcher({
      notifyReminder: vi.fn(async () => { throw new Error("network down"); }),
    });
    const result = await new ReminderService(repo, notifier).deliver(NOW);
    expect(result.failed).toBe(1);
    expect(repo.completeReminderDelivery).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED" }));
  });
});
