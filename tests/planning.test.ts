import { describe, expect, it } from "vitest";
import { groupTodayWork } from "@/domain/planning";

describe("today's work matrix", () => {
  it("shows a task once when its deadline and multiple checkpoints fall today", () => {
    const now = new Date("2026-11-15T20:00:00Z"); // 16 November in Tashkent
    const tasks = [
      { id: "both", title: "Both", assigneeId: "member", status: "IN_PROGRESS", deadline: "2026-11-16T04:00:00Z" },
      { id: "checkpoint", title: "Checkpoint", assigneeId: "member", status: "IN_PROGRESS", deadline: "2026-11-20T04:00:00Z" },
      { id: "tomorrow", title: "Tomorrow", assigneeId: "member", status: "IN_PROGRESS", deadline: "2026-11-20T04:00:00Z" },
      { id: "other", title: "Other user", assigneeId: "other", status: "IN_PROGRESS", deadline: "2026-11-16T04:00:00Z" },
    ];
    const plans = [
      { taskId: "both", isImportant: true, urgentOverride: null },
      { taskId: "checkpoint", isImportant: false, urgentOverride: false },
    ];
    const checkpoints = [
      { taskId: "both", title: "Draft", dueAt: "2026-11-15T20:30:00Z", completedAt: null },
      { taskId: "both", title: "Review", dueAt: "2026-11-16T10:00:00Z", completedAt: "2026-11-15T19:00:00Z" },
      { taskId: "checkpoint", title: "Assets", dueAt: "2026-11-16T08:00:00Z", completedAt: null },
      { taskId: "tomorrow", title: "Later", dueAt: "2026-11-17T08:00:00Z", completedAt: null },
    ];
    const groups = groupTodayWork(tasks, plans, checkpoints, "member", now);
    expect(groups.today.map((item) => item.task.id)).toEqual(["both", "checkpoint"]);
    expect(groups.today[0].checkpoints.map((checkpoint) => checkpoint.title)).toEqual(["Draft", "Review"]);
    expect(groups.important_urgent.map((item) => item.task.id)).toEqual(["both"]);
    expect(groups.later_other.map((item) => item.task.id)).toEqual(["checkpoint"]);
    expect(Object.values(groups).slice(1).reduce((sum, items) => sum + items.length, 0)).toBe(groups.today.length);
  });
});
