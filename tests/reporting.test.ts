import { describe, expect, it } from "vitest";
import type { Task, TaskEvent } from "../src/domain/models";
import { calculateAnalytics, tashkentDayRange, weeklyMetrics, workloadMetrics } from "../src/domain/reporting";

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "20000000-0000-4000-8000-000000000001", title: "Campaign", description: null,
  priority: "high", status: "DONE", creatorId: "10000000-0000-4000-8000-000000000001",
  assigneeId: "10000000-0000-4000-8000-000000000002", deadline: "2026-09-08T13:00:00Z",
  blockedReason: null, completedAt: "2026-09-08T12:00:00Z", cancelledAt: null,
  createdAt: "2026-09-06T12:00:00Z", updatedAt: "2026-09-08T12:00:00Z", ...overrides,
});

const event = (overrides: Partial<TaskEvent> = {}): TaskEvent => ({
  id: crypto.randomUUID(), taskId: task().id, actorId: null, actorKind: "SYSTEM",
  eventType: "STATUS_CHANGED", oldValue: "ASSIGNED", newValue: "IN_PROGRESS", metadata: {},
  createdAt: "2026-09-07T12:00:00Z", ...overrides,
});

describe("report metrics", () => {
  it("uses midnight in Asia/Tashkent for daily boundaries", () => {
    const range = tashkentDayRange(new Date("2026-09-09T03:00:00Z"));
    expect(range.start.toISOString()).toBe("2026-09-08T19:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-09T19:00:00.000Z");
  });

  it("reports factual workload counts without a utilization score", () => {
    const now = new Date("2026-09-09T03:00:00Z");
    const tasks = [
      task({ id: crypto.randomUUID(), status: "IN_PROGRESS", completedAt: null, deadline: "2026-09-09T08:00:00Z" }),
      task({ id: crypto.randomUUID(), status: "BLOCKED", blockedReason: "Assets", completedAt: null, deadline: "2026-09-08T08:00:00Z" }),
    ];
    expect(workloadMetrics(tasks, now)).toMatchObject({
      open: 2, inProgress: 1, highPriority: 2, dueToday: 1, overdue: 1, blocked: 1,
    });
  });

  it("derives on-time, revisions, cycle time, and status duration from records and events", () => {
    const current = task();
    const events = [
      event(),
      event({ id: crypto.randomUUID(), oldValue: "IN_PROGRESS", newValue: "REVIEW", createdAt: "2026-09-08T10:00:00Z" }),
      event({ id: crypto.randomUUID(), eventType: "REVISION_REQUESTED", oldValue: "REVIEW", newValue: "REVISION", createdAt: "2026-09-08T11:00:00Z" }),
      event({ id: crypto.randomUUID(), oldValue: "REVIEW", newValue: "DONE", createdAt: "2026-09-08T12:00:00Z" }),
    ];
    const metric = calculateAnalytics({ tasks: [current], events, deadlineRequests: [], now: new Date("2026-09-09T12:00:00Z"), windowDays: 30 });
    expect(metric).toMatchObject({ created: 1, completed: 1, onTimeCompleted: 1, revisionCount: 1 });
    expect(metric.averageCycleHours).toBe(48);
    expect(metric.averageStatusHours.REVIEW).toBe(2);
  });

  it("defines weekly overdue separately from current overdue", () => {
    const lateDone = task({ completedAt: "2026-09-08T14:00:00Z" });
    const currentOverdue = task({ id: crypto.randomUUID(), status: "IN_PROGRESS", completedAt: null, deadline: "2026-09-08T12:00:00Z" });
    const metric = weeklyMetrics({ tasks: [lateDone, currentOverdue], events: [], requests: [], start: new Date("2026-09-07T00:00:00Z"), end: new Date("2026-09-09T00:00:00Z") });
    expect(metric.overdue).toBe(2);
    expect(metric.currentOverdue).toBe(1);
  });

  it("counts carry-over as work created before period end that is still open", () => {
    const stillOpen = task({ id: crypto.randomUUID(), status: "IN_PROGRESS", completedAt: null, createdAt: "2026-09-05T00:00:00Z", deadline: "2026-09-10T00:00:00Z" });
    const closedBefore = task({ id: crypto.randomUUID(), status: "DONE", completedAt: "2026-09-08T00:00:00Z", createdAt: "2026-09-05T00:00:00Z" });
    const metric = weeklyMetrics({ tasks: [stillOpen, closedBefore], events: [], requests: [], start: new Date("2026-09-07T00:00:00Z"), end: new Date("2026-09-09T00:00:00Z") });
    expect(metric.carryOver).toBe(1);
  });

  it("averages blocked and review durations from status-change history within the window", () => {
    const current = task({ status: "DONE" });
    const events: TaskEvent[] = [
      event({ id: crypto.randomUUID(), oldValue: "IN_PROGRESS", newValue: "BLOCKED", createdAt: "2026-09-07T00:00:00Z" }),
      event({ id: crypto.randomUUID(), oldValue: "BLOCKED", newValue: "IN_PROGRESS", createdAt: "2026-09-07T10:00:00Z" }),
      event({ id: crypto.randomUUID(), oldValue: "IN_PROGRESS", newValue: "REVIEW", createdAt: "2026-09-08T00:00:00Z" }),
      event({ id: crypto.randomUUID(), oldValue: "REVIEW", newValue: "DONE", createdAt: "2026-09-08T05:00:00Z" }),
    ];
    const metric = calculateAnalytics({ tasks: [current], events, deadlineRequests: [], now: new Date("2026-09-09T00:00:00Z"), windowDays: 30 });
    expect(metric.averageBlockedHours).toBe(10);
    expect(metric.averageReviewHours).toBe(5);
  });
});
