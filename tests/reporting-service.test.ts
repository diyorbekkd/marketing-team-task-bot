import { describe, expect, it, vi } from "vitest";
import { ReportingService } from "../src/application/reporting-service";
import type { MarketingRepository } from "../src/application/ports/marketing-repository";
import type { ReportDispatcher } from "../src/application/ports/report-dispatcher";
import type { Task, User } from "../src/domain/models";

const head: User = {
  id: "10000000-0000-4000-8000-000000000001", telegramUserId: "1001", telegramUsername: "head",
  displayName: "Head", role: "HEAD_OF_MARKETING", isActive: true, deactivatedAt: null,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
};
const employee: User = { ...head, id: "10000000-0000-4000-8000-000000000002", telegramUserId: "1002", displayName: "Diyorbek", role: "SMM_MANAGER" };
const inactive: User = { ...head, id: "10000000-0000-4000-8000-000000000003", telegramUserId: "1003", displayName: "Inactive", role: "CONTENT_MARKETER", isActive: false };

const task: Task = {
  id: "20000000-0000-4000-8000-000000000001", title: "Post campaign", description: null,
  priority: "normal", status: "IN_PROGRESS", creatorId: head.id, assigneeId: employee.id,
  deadline: "2026-09-09T07:00:00Z", blockedReason: null, completedAt: null, cancelledAt: null,
  createdAt: "2026-09-08T08:00:00Z", updatedAt: "2026-09-08T08:00:00Z",
};

function repository(claim = true): MarketingRepository {
  return {
    listUsers: vi.fn(async () => [head, employee, inactive]),
    listTasks: vi.fn(async () => [task]),
    listAllTaskEvents: vi.fn(async () => []),
    listDeadlineChangeRequests: vi.fn(async () => []),
    claimReportDelivery: vi.fn(async () => claim),
    completeReportDelivery: vi.fn(async () => undefined),
  } as unknown as MarketingRepository;
}

describe("scheduled report delivery", () => {
  it("sends one team report to Head and only personal data to an active employee", async () => {
    const sent: Array<{ recipient: User; text: string }> = [];
    const dispatcher: ReportDispatcher = { sendReport: vi.fn(async (recipient, text) => { sent.push({ recipient, text }); }) };
    const result = await new ReportingService(repository(), dispatcher).deliver("DAILY_MORNING", new Date("2026-09-09T03:00:00Z"));

    expect(result).toMatchObject({ recipients: 2, sent: 2, failed: 0 });
    expect(sent.map((delivery) => delivery.recipient.id)).toEqual([head.id, employee.id]);
    expect(sent.find((delivery) => delivery.recipient.id === head.id)?.text).toContain("Marketing — Bugun");
    expect(sent.find((delivery) => delivery.recipient.id === employee.id)?.text).toContain("Bugungi tasklaringiz");
  });

  it("does not send again when the database idempotency claim already exists", async () => {
    const dispatcher: ReportDispatcher = { sendReport: vi.fn() };
    const result = await new ReportingService(repository(false), dispatcher).deliver("WEEKLY", new Date("2026-09-13T05:00:00Z"));
    expect(result.deduplicated).toBe(2);
    expect(dispatcher.sendReport).not.toHaveBeenCalled();
  });
});
