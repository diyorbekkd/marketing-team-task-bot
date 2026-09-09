import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/application/errors";

const { performTaskAction, getMarketingService, requireRequestActor } = vi.hoisted(() => ({
  performTaskAction: vi.fn(),
  getMarketingService: vi.fn(),
  requireRequestActor: vi.fn(),
}));

vi.mock("../src/server/application", () => ({ getMarketingService }));
vi.mock("../src/server/auth/request-actor", () => ({ requireRequestActor }));

describe("Mini App task action route", () => {
  beforeEach(() => {
    performTaskAction.mockReset();
    getMarketingService.mockReset();
    requireRequestActor.mockReset();
    getMarketingService.mockReturnValue({ performTaskAction });
    requireRequestActor.mockResolvedValue({ id: "assignee-1" });
  });

  it("calls the shared workflow for an accept action from the Mini App — the same method Telegram uses", async () => {
    const task = { id: "task-1", status: "IN_PROGRESS" };
    performTaskAction.mockResolvedValueOnce(task);
    const { POST } = await import("../src/app/api/tasks/[id]/actions/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/tasks/task-1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ACCEPT" }),
      }),
      { params: Promise.resolve({ id: "task-1" }) },
    );

    expect(performTaskAction).toHaveBeenCalledWith({ id: "assignee-1" }, "task-1", { action: "ACCEPT" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ task });
  });

  it("surfaces a conflict instead of a silent success on a duplicate accept", async () => {
    performTaskAction.mockRejectedValueOnce(
      new ApplicationError("CONFLICT", "ACCEPT is not valid while task is IN_PROGRESS."),
    );
    const { POST } = await import("../src/app/api/tasks/[id]/actions/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/tasks/task-1/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "ACCEPT" }),
      }),
      { params: Promise.resolve({ id: "task-1" }) },
    );

    expect(response.status).toBe(409);
  });
});
