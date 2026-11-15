import { describe, expect, it } from "vitest";
import { groupPlannedTasks } from "@/domain/planning";

describe("personal day matrix", () => {
  it("places every planned task in exactly one quadrant or the unclassified group", () => {
    const now = new Date("2026-11-15T20:00:00Z"); // 16 November in Tashkent
    const tasks = [
      { id: "important", title: "Important", assigneeId: "member", status: "IN_PROGRESS", deadline: "2026-11-16T04:00:00Z" },
      { id: "unclassified", title: "Unclassified", assigneeId: "member", status: "IN_PROGRESS", deadline: "2026-11-20T04:00:00Z" },
      { id: "later", title: "Later", assigneeId: "member", status: "IN_PROGRESS", deadline: "2026-11-20T04:00:00Z" },
      { id: "other-day", title: "Other day", assigneeId: "member", status: "IN_PROGRESS", deadline: "2026-11-20T04:00:00Z" },
    ];
    const plans = [
      { taskId: "important", plannedOn: "2026-11-16", isImportant: true, urgentOverride: null },
      { taskId: "unclassified", plannedOn: "2026-11-16", isImportant: null, urgentOverride: null },
      { taskId: "later", plannedOn: "2026-11-16", isImportant: false, urgentOverride: false },
      { taskId: "other-day", plannedOn: "2026-11-17", isImportant: true, urgentOverride: true },
    ];
    const groups = groupPlannedTasks(tasks, plans, "member", now);
    expect(groups.today.map((task) => task.id)).toEqual(["important", "unclassified", "later"]);
    expect(groups.important_urgent.map((task) => task.id)).toEqual(["important"]);
    expect(groups.later_other.map((task) => task.id)).toEqual(["later"]);
    expect(groups.unclassified.map((task) => task.id)).toEqual(["unclassified"]);
    expect(Object.values(groups).slice(1).reduce((sum, items) => sum + items.length, 0)).toBe(groups.today.length);
  });
});
