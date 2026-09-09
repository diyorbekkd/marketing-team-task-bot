import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/application/errors";

const { updateUserRole, getMarketingService, requireRequestActor } = vi.hoisted(() => ({
  updateUserRole: vi.fn(),
  getMarketingService: vi.fn(),
  requireRequestActor: vi.fn(),
}));

vi.mock("../src/server/application", () => ({ getMarketingService }));
vi.mock("../src/server/auth/request-actor", () => ({ requireRequestActor }));

describe("User role edit route", () => {
  beforeEach(() => {
    updateUserRole.mockReset();
    getMarketingService.mockReset();
    requireRequestActor.mockReset();
    getMarketingService.mockReturnValue({ updateUserRole });
    requireRequestActor.mockResolvedValue({ id: "head-1", role: "HEAD_OF_MARKETING" });
  });

  it("updates a teammate's role through the shared service", async () => {
    const user = { id: "member-1", role: "DIGITAL_MARKETER" };
    updateUserRole.mockResolvedValueOnce(user);
    const { POST } = await import("../src/app/api/users/[id]/role/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/users/member-1/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "DIGITAL_MARKETER" }),
      }),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(updateUserRole).toHaveBeenCalledWith({ id: "head-1", role: "HEAD_OF_MARKETING" }, "member-1", "DIGITAL_MARKETER");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user });
  });

  it("rejects an invalid role before it ever reaches the service", async () => {
    const { POST } = await import("../src/app/api/users/[id]/role/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/users/member-1/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "NOT_A_REAL_ROLE" }),
      }),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(response.status).toBe(400);
    expect(updateUserRole).not.toHaveBeenCalled();
  });

  it("rejects Head as a settable role at the schema level", async () => {
    const { POST } = await import("../src/app/api/users/[id]/role/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/users/member-1/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "HEAD_OF_MARKETING" }),
      }),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(response.status).toBe(400);
    expect(updateUserRole).not.toHaveBeenCalled();
  });

  it("surfaces a forbidden result when the service denies the change", async () => {
    updateUserRole.mockRejectedValueOnce(new ApplicationError("FORBIDDEN", "Only Head may change another teammate's role."));
    const { POST } = await import("../src/app/api/users/[id]/role/route");

    const response = await POST(
      new Request("https://tasks.example.com/api/users/member-1/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "DIGITAL_MARKETER" }),
      }),
      { params: Promise.resolve({ id: "member-1" }) },
    );

    expect(response.status).toBe(403);
  });
});
