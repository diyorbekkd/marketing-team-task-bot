import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/application/errors";

const {
  getDeactivationPreview, deactivateUser, reactivateUser, getMarketingService, requireRequestActor,
} = vi.hoisted(() => ({
  getDeactivationPreview: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  getMarketingService: vi.fn(),
  requireRequestActor: vi.fn(),
}));

vi.mock("../src/server/application", () => ({ getMarketingService }));
vi.mock("../src/server/auth/request-actor", () => ({ requireRequestActor }));

describe("team membership routes", () => {
  beforeEach(() => {
    getDeactivationPreview.mockReset();
    deactivateUser.mockReset();
    reactivateUser.mockReset();
    getMarketingService.mockReset();
    requireRequestActor.mockReset();
    getMarketingService.mockReturnValue({ getDeactivationPreview, deactivateUser, reactivateUser });
    requireRequestActor.mockResolvedValue({ id: "head-1", role: "HEAD_OF_MARKETING" });
  });

  it("returns the deactivation preview through the shared service", async () => {
    const preview = {
      user: { id: "member-1" },
      openTasks: [{ id: "task-1", title: "Import creative", status: "IN_PROGRESS", deadline: "2026-09-10T13:00:00.000Z" }],
      historicalTaskCount: 3,
      activeRecurringCount: 1,
    };
    getDeactivationPreview.mockResolvedValueOnce(preview);
    const { GET } = await import("../src/app/api/users/[id]/deactivation-preview/route");

    const response = await GET(
      new Request("https://tasks.example.com/api/users/member-1/deactivation-preview"),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(getDeactivationPreview).toHaveBeenCalledWith({ id: "head-1", role: "HEAD_OF_MARKETING" }, "member-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ historicalTaskCount: 3, activeRecurringCount: 1 });
  });

  it("deactivates a member with the chosen open-task handling", async () => {
    deactivateUser.mockResolvedValueOnce({ user: { id: "member-1", isActive: false }, openTasksHandled: 2, recurringPaused: 1 });
    const { POST } = await import("../src/app/api/users/[id]/deactivate/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/users/member-1/deactivate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openTasksAction: "CANCEL" }),
      }),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(deactivateUser).toHaveBeenCalledWith({ id: "head-1", role: "HEAD_OF_MARKETING" }, "member-1", { openTasksAction: "CANCEL" });
    expect(response.status).toBe(200);
  });

  it("surfaces forbidden when a non-Head tries to deactivate someone", async () => {
    deactivateUser.mockRejectedValueOnce(new ApplicationError("FORBIDDEN", "Only Head may manage team membership."));
    const { POST } = await import("../src/app/api/users/[id]/deactivate/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/users/member-1/deactivate", { method: "POST" }),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(response.status).toBe(403);
  });

  it("reactivates a member through the shared service", async () => {
    reactivateUser.mockResolvedValueOnce({ id: "member-1", isActive: true });
    const { POST } = await import("../src/app/api/users/[id]/reactivate/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/users/member-1/reactivate", { method: "POST" }),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(reactivateUser).toHaveBeenCalledWith({ id: "head-1", role: "HEAD_OF_MARKETING" }, "member-1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: { id: "member-1", isActive: true } });
  });
});
