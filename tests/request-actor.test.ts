import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/application/errors";
import type { RequestActorProvider, RequestActorResolution } from "../src/server/auth/request-actor-provider";
import type { User } from "../src/domain/models";

// Module-level (hoisted) mock: the second describe block below exercises the
// real default provider chain, which includes the real
// CookieRequestActorProvider -- it needs a Next.js request context that
// plain vitest does not provide. No cookie present is exactly the scenario
// those tests want anyway.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const ACTOR: User = {
  id: "10000000-0000-4000-8000-000000000001",
  telegramUserId: "555000111",
  telegramUsername: null,
  displayName: "Test Actor",
  role: "CONTENT_MARKETER",
  isActive: true,
  deactivatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function fakeProvider(behavior: "null" | "resolve" | "throw", resolution?: RequestActorResolution): RequestActorProvider & { calls: number } {
  return {
    calls: 0,
    async resolve() {
      this.calls += 1;
      if (behavior === "null") return null;
      if (behavior === "throw") throw new ApplicationError("UNAUTHENTICATED", "provider-specific failure");
      return resolution!;
    },
  };
}

describe("resolveRequestActor orchestration", () => {
  it("returns the first provider's resolution without trying later providers", async () => {
    const first = fakeProvider("resolve", { actor: ACTOR, source: "CONTENT_OS_SERVICE" });
    const second = fakeProvider("resolve", { actor: ACTOR, source: "COOKIE" });
    const { resolveRequestActor } = await import("../src/server/auth/request-actor");

    const resolution = await resolveRequestActor(new Request("https://tasks.example.com/api/tasks"), [first, second]);

    expect(resolution.source).toBe("CONTENT_OS_SERVICE");
    expect(first.calls).toBe(1);
    expect(second.calls).toBe(0);
  });

  it("falls through a null (not-applicable) provider to try the next one", async () => {
    const notApplicable = fakeProvider("null");
    const applicable = fakeProvider("resolve", { actor: ACTOR, source: "COOKIE" });
    const { resolveRequestActor } = await import("../src/server/auth/request-actor");

    const resolution = await resolveRequestActor(new Request("https://tasks.example.com/api/tasks"), [notApplicable, applicable]);

    expect(resolution).toEqual({ actor: ACTOR, source: "COOKIE" });
    expect(notApplicable.calls).toBe(1);
    expect(applicable.calls).toBe(1);
  });

  it("propagates a provider's throw immediately -- does NOT fall through to a weaker later provider", async () => {
    const failing = fakeProvider("throw");
    const wouldSucceed = fakeProvider("resolve", { actor: ACTOR, source: "COOKIE" });
    const { resolveRequestActor } = await import("../src/server/auth/request-actor");

    await expect(resolveRequestActor(new Request("https://tasks.example.com/api/tasks"), [failing, wouldSucceed]))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", message: "provider-specific failure" });
    expect(wouldSucceed.calls).toBe(0);
  });

  it("throws the original fallback message when every provider returns null", async () => {
    const { resolveRequestActor } = await import("../src/server/auth/request-actor");
    await expect(resolveRequestActor(new Request("https://tasks.example.com/api/tasks"), [fakeProvider("null"), fakeProvider("null")]))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", message: "Telegram authentication is required." });
  });

  it("each provider gets an independent clone -- a POST body is still readable by a later provider even if an earlier one read it", async () => {
    let secondProviderBodyText: string | undefined;
    const bodyReadingFirst: RequestActorProvider = {
      async resolve(request) {
        await request.text();
        return null;
      },
    };
    const bodyReadingSecond: RequestActorProvider = {
      async resolve(request) {
        secondProviderBodyText = await request.text();
        return { actor: ACTOR, source: "COOKIE" };
      },
    };
    const { resolveRequestActor } = await import("../src/server/auth/request-actor");
    await resolveRequestActor(
      new Request("https://tasks.example.com/api/tasks", { method: "POST", body: JSON.stringify({ title: "x" }) }),
      [bodyReadingFirst, bodyReadingSecond],
    );
    expect(secondProviderBodyText).toBe(JSON.stringify({ title: "x" }));
  });
});

describe("requireRequestActor (default production wiring, real providers, no mocks)", () => {
  it("fails closed with the original cookie-only error when no cookie and no service-auth headers are present, and CONTENT_OS_SERVICE_AUTH_ENABLED is unset (default)", async () => {
    const { requireRequestActor } = await import("../src/server/auth/request-actor");
    await expect(requireRequestActor(new Request("https://tasks.example.com/api/tasks")))
      .rejects.toMatchObject({ code: "UNAUTHENTICATED", message: "Telegram authentication is required." });
  });

  it("a request carrying a Content OS signature header is still rejected when the flag is unset (default-disabled, not merely unconfigured)", async () => {
    const { requireRequestActor } = await import("../src/server/auth/request-actor");
    const request = new Request("https://tasks.example.com/api/tasks", {
      method: "POST",
      headers: {
        "x-content-os-signature": "a".repeat(64),
        "x-content-os-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-content-os-actor-provider": "content-os",
        "x-content-os-actor-subject": "siwc-user-abc123",
      },
      body: "{}",
    });
    await expect(requireRequestActor(request)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});
