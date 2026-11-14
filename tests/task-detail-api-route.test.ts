import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  updateTask,
  listTaskComments,
  addTaskComment,
  getMarketingService,
  requireRequestActor,
} = vi.hoisted(() => ({
  updateTask: vi.fn(),
  listTaskComments: vi.fn(),
  addTaskComment: vi.fn(),
  getMarketingService: vi.fn(),
  requireRequestActor: vi.fn(),
}));

vi.mock("../src/server/application", () => ({ getMarketingService }));
vi.mock("../src/server/auth/request-actor", () => ({ requireRequestActor }));

describe("task editing and comments routes", () => {
  beforeEach(() => {
    updateTask.mockReset();
    listTaskComments.mockReset();
    addTaskComment.mockReset();
    getMarketingService.mockReset();
    requireRequestActor.mockReset();
    getMarketingService.mockReturnValue({ updateTask, listTaskComments, addTaskComment });
    requireRequestActor.mockResolvedValue({ id: "actor-1" });
  });

  it("passes a task patch through the authenticated service boundary", async () => {
    const updated = { id: "task-1", title: "Yangi nom", publicationAt: "2026-11-17T04:00:00.000Z" };
    updateTask.mockResolvedValueOnce(updated);
    const { PATCH } = await import("../src/app/api/tasks/[id]/route");
    const input = { title: "Yangi nom", publicationAt: "2026-11-17T04:00:00.000Z" };

    const response = await PATCH(new Request("https://tasks.example.com/api/tasks/task-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }), { params: Promise.resolve({ id: "task-1" }) });

    expect(updateTask).toHaveBeenCalledWith({ id: "actor-1" }, "task-1", input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(updated);
  });

  it("lists and appends immutable task discussion records", async () => {
    const comment = { id: "comment-1", kind: "RESULT", attachmentUrl: "https://drive.google.com/file/1" };
    listTaskComments.mockResolvedValueOnce([comment]);
    addTaskComment.mockResolvedValueOnce(comment);
    const { GET, POST } = await import("../src/app/api/tasks/[id]/comments/route");
    const context = { params: Promise.resolve({ id: "task-1" }) };

    const listResponse = await GET(new Request("https://tasks.example.com/api/tasks/task-1/comments"), context);
    expect(listTaskComments).toHaveBeenCalledWith({ id: "actor-1" }, "task-1");
    expect(await listResponse.json()).toEqual([comment]);

    const input = { kind: "RESULT", attachmentUrl: "https://drive.google.com/file/1" };
    const createResponse = await POST(new Request("https://tasks.example.com/api/tasks/task-1/comments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }), { params: Promise.resolve({ id: "task-1" }) });
    expect(addTaskComment).toHaveBeenCalledWith({ id: "actor-1" }, "task-1", input);
    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual(comment);
  });
});
