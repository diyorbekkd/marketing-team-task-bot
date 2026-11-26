import { beforeEach, describe, expect, it, vi } from "vitest";

const { listUsers, listHomeTasks, getMarketingService, requireRequestActor } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listHomeTasks: vi.fn(),
  getMarketingService: vi.fn(),
  requireRequestActor: vi.fn(),
}));

vi.mock("../src/server/application", () => ({ getMarketingService }));
vi.mock("../src/server/auth/request-actor", () => ({ requireRequestActor }));

describe("Mini App bootstrap route", () => {
  beforeEach(() => {
    listUsers.mockReset();
    listHomeTasks.mockReset();
    getMarketingService.mockReset();
    requireRequestActor.mockReset();
    getMarketingService.mockReturnValue({ listUsers, listHomeTasks });
  });

  it("fetches the team list and the Home task summary in parallel and returns both in one response", async () => {
    const actor = { id: "actor-1", role: "OPERATOR_VIDEO_EDITOR" };
    requireRequestActor.mockResolvedValue(actor);
    const users = [{ id: "u1", displayName: "Editor", isActive: true }];
    const tasks = [{ id: "t1", title: "Publish reel" }];
    // Both queries must be in flight together (Promise.all), not sequential:
    // listHomeTasks must already have been invoked before listUsers's deliberately
    // slow promise settles. If the route awaited listUsers first, listHomeTasks
    // would not yet have been called at that point.
    let resolveUsers!: (value: typeof users) => void;
    listUsers.mockImplementation(() => new Promise((resolve) => { resolveUsers = resolve; }));
    listHomeTasks.mockImplementation(async () => tasks);

    const { GET } = await import("../src/app/api/bootstrap/route");
    const responsePromise = GET();
    await Promise.resolve(); // let the route's synchronous setup run
    expect(listHomeTasks).toHaveBeenCalled();
    resolveUsers(users);
    const response = await responsePromise;

    expect(listUsers).toHaveBeenCalledWith(actor);
    expect(listHomeTasks).toHaveBeenCalledWith(actor);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: actor,
      users: [{
        id: "u1",
        telegramUsername: undefined,
        displayName: "Editor",
        role: undefined,
        isActive: true,
        deactivatedAt: undefined,
      }],
      tasks,
    });
  });

  it("requests the team-wide scope for a Head of Marketing", async () => {
    const actor = { id: "head-1", role: "HEAD_OF_MARKETING" };
    requireRequestActor.mockResolvedValue(actor);
    listUsers.mockResolvedValue([]);
    listHomeTasks.mockResolvedValue([]);

    const { GET } = await import("../src/app/api/bootstrap/route");
    await GET();

    expect(listHomeTasks).toHaveBeenCalledWith(actor);
  });

  it("returns an error response instead of a partial result when either query fails", async () => {
    requireRequestActor.mockResolvedValue({ id: "actor-1", role: "OPERATOR_VIDEO_EDITOR" });
    listUsers.mockResolvedValue([]);
    listHomeTasks.mockRejectedValue(new Error("supabase unavailable"));

    const { GET } = await import("../src/app/api/bootstrap/route");
    const response = await GET();

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
