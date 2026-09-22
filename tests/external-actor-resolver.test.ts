import { describe, expect, it } from "vitest";
import { ExternalIdentityNotLinkedError, SchemaNotReadyExternalActorResolver } from "../src/server/auth/external-actor-resolver";
import { FixtureExternalActorResolver } from "./stubs/fixture-external-actor-resolver";
import type { User } from "../src/domain/models";

const ACTIVE_USER: User = {
  id: "10000000-0000-4000-8000-000000000001",
  telegramUserId: "555000111",
  telegramUsername: "content_marketer",
  displayName: "Content Marketer",
  role: "CONTENT_MARKETER",
  isActive: true,
  deactivatedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("SchemaNotReadyExternalActorResolver (the only production-wired resolver today)", () => {
  it("always fails closed -- no provider/externalSubject can ever resolve", async () => {
    const resolver = new SchemaNotReadyExternalActorResolver();
    await expect(resolver.resolve({ provider: "content-os", externalSubject: "anything" })).rejects.toBeInstanceOf(ExternalIdentityNotLinkedError);
  });
});

describe("FixtureExternalActorResolver (test-only)", () => {
  it("resolves a linked provider/externalSubject pair to its User", async () => {
    const resolver = new FixtureExternalActorResolver(
      new Map([[FixtureExternalActorResolver.key("content-os", "siwc-user-abc123"), ACTIVE_USER]]),
    );
    const actor = await resolver.resolve({ provider: "content-os", externalSubject: "siwc-user-abc123" });
    expect(actor).toEqual(ACTIVE_USER);
  });

  it("rejects an unlinked identity", async () => {
    const resolver = new FixtureExternalActorResolver(new Map());
    await expect(resolver.resolve({ provider: "content-os", externalSubject: "unknown-subject" })).rejects.toBeInstanceOf(ExternalIdentityNotLinkedError);
  });
});
