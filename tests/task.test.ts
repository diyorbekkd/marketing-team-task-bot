import { describe, expect, it } from "vitest";
import {
  CreateTaskInputSchema,
  isOverdue,
  TaskStatusSchema,
} from "../src/domain/task";

const assigneeId = "58d49447-475d-4a02-bbf9-ea168b760d15";

describe("task validation", () => {
  it("accepts the minimal task input and defaults priority", () => {
    const task = CreateTaskInputSchema.parse({
      title: "Create campaign brief",
      assigneeId,
      deadline: "2026-09-08T18:00:00+05:00",
    });

    expect(task.priority).toBe("normal");
    expect(task.title).toBe("Create campaign brief");
  });

  it("requires a deadline with a date, time, and offset", () => {
    expect(() =>
      CreateTaskInputSchema.parse({
        title: "Create campaign brief",
        assigneeId,
        deadline: "2026-09-08",
      }),
    ).toThrow();
  });

  it("does not admit OVERDUE as a canonical status", () => {
    expect(TaskStatusSchema.safeParse("OVERDUE").success).toBe(false);
  });

  it("derives overdue from deadline and terminal status", () => {
    const now = new Date("2026-09-08T13:00:00.000Z");
    const deadline = new Date("2026-09-08T12:00:00.000Z");

    expect(isOverdue({ deadline, status: "BLOCKED" }, now)).toBe(true);
    expect(isOverdue({ deadline, status: "DONE" }, now)).toBe(false);
    expect(isOverdue({ deadline, status: "CANCELLED" }, now)).toBe(false);
  });
});
