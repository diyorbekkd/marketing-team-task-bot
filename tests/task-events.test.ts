import { describe, expect, it } from "vitest";
import { createTaskEvent } from "../src/domain/task-events";

const taskId = "1354b575-a9e8-4ab8-a2dc-bbdfc609edbd";
const userId = "2f90cf98-83f6-45c4-b002-09178f1c9a2f";

describe("task event drafts", () => {
  it("creates a typed user event with empty metadata", () => {
    const event = createTaskEvent({
      taskId,
      actor: { kind: "USER", userId },
      type: "TASK_CREATED",
      newValue: { status: "ASSIGNED" },
    });

    expect(event.metadata).toEqual({});
    expect(event.actor).toEqual({ kind: "USER", userId });
  });

  it("requires a user id for user-authored events", () => {
    expect(() =>
      createTaskEvent({
        taskId,
        actor: { kind: "USER" },
        type: "TASK_BLOCKED",
      }),
    ).toThrow();
  });
});
