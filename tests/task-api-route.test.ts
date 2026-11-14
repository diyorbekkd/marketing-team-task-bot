import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTask, listTaskPage, getMarketingService, requireRequestActor } = vi.hoisted(() => ({
  createTask: vi.fn(),
  listTaskPage: vi.fn(),
  getMarketingService: vi.fn(),
  requireRequestActor: vi.fn(),
}));

vi.mock("../src/server/application", () => ({ getMarketingService }));
vi.mock("../src/server/auth/request-actor", () => ({ requireRequestActor }));

describe("Mini App task creation route", () => {
  beforeEach(() => {
    createTask.mockReset();
    listTaskPage.mockReset();
    getMarketingService.mockReset();
    requireRequestActor.mockReset();
    getMarketingService.mockReturnValue({ createTask, listTaskPage });
    requireRequestActor.mockResolvedValue({ id: "creator" });
  });

  it("calls the notification-aware creation workflow and returns its delivery result", async () => {
    const result = {
      task: { id: "task-1", title: "Publish reel" },
      assignee: { id: "assignee-1" },
      notification: { status: "FAILED", reason: "DELIVERY_FAILED" },
    };
    createTask.mockResolvedValueOnce(result);
    const input = {
      title: "Publish reel",
      assigneeId: "assignee-1",
      deadline: "2026-09-08T13:00:00.000Z",
    };
    const { POST } = await import("../src/app/api/tasks/route");

    const response = await POST(new Request("https://tasks.example.com/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }));

    expect(createTask).toHaveBeenCalledWith({ id: "creator" }, input);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(result);
  });

  it("passes validated query options to the paginated task workflow", async () => {
    const result = { tasks: [], pagination: { pageSize: 25, hasMore: false, nextCursor: null } };
    listTaskPage.mockResolvedValueOnce(result);
    const { GET } = await import("../src/app/api/tasks/route");

    const response = await GET(new Request(
      "https://tasks.example.com/api/tasks?scope=created&status=BLOCKED&priority=high&deadlineRange=next_7_days&search=creative&pageSize=25&sort=created_desc",
    ));

    expect(listTaskPage).toHaveBeenCalledWith(
      { id: "creator" },
      "created",
      { status: "BLOCKED", priority: "high", deadlineRange: "next_7_days", search: "creative", pageSize: "25", sort: "created_desc" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });
});
