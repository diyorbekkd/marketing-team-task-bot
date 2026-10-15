import { describe, expect, it } from "vitest";
import { ContentOsRequestActorProvider } from "../src/server/auth/content-os-request-actor-provider";
import {
  CONTENT_OS_ACTOR_PROVIDER_HEADER,
  CONTENT_OS_ACTOR_SUBJECT_HEADER,
  CONTENT_OS_SIGNATURE_HEADER,
  CONTENT_OS_TIMESTAMP_HEADER,
  signContentOsRequest,
} from "../src/server/auth/content-os-signature";
import { FixtureExternalActorResolver } from "./stubs/fixture-external-actor-resolver";
import { ApplicationError } from "../src/application/errors";
import type { User } from "../src/domain/models";

const SECRET = "test-content-os-service-secret-value";
const NOW = new Date("2026-09-22T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const PROVIDER = "CONTENT_OS_TELEGRAM_SESSION";
const SUBJECT = "10000000-0000-4000-8000-000000000001";

const ACTIVE_ACTOR: User = {
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
const INACTIVE_ACTOR: User = { ...ACTIVE_ACTOR, id: "10000000-0000-4000-8000-000000000002", isActive: false };

function linkedResolver(user: User) {
  return new FixtureExternalActorResolver(new Map([[FixtureExternalActorResolver.key(PROVIDER, SUBJECT), user]]));
}

function signedRequest(options: {
  method?: string;
  url?: string;
  bodyText?: string;
  provider?: string | null;
  externalSubject?: string | null;
  timestamp?: number | null;
  secretForSigning?: string;
  signatureOverride?: string;
  omitSignature?: boolean;
}): Request {
  const method = options.method ?? "POST";
  const url = options.url ?? "https://tasks.example.com/api/tasks";
  const bodyText = options.bodyText ?? JSON.stringify({ title: "Draft a carousel" });
  const provider = options.provider === undefined ? PROVIDER : options.provider;
  const externalSubject = options.externalSubject === undefined ? SUBJECT : options.externalSubject;
  const timestamp = options.timestamp === undefined ? NOW_SECONDS : options.timestamp;

  const headers: Record<string, string> = {};
  if (provider !== null) headers[CONTENT_OS_ACTOR_PROVIDER_HEADER] = provider;
  if (externalSubject !== null) headers[CONTENT_OS_ACTOR_SUBJECT_HEADER] = externalSubject;
  if (timestamp !== null) headers[CONTENT_OS_TIMESTAMP_HEADER] = String(timestamp);

  if (!options.omitSignature) {
    headers[CONTENT_OS_SIGNATURE_HEADER] = options.signatureOverride ?? signContentOsRequest(
      { method, path: new URL(url).pathname, bodyText, provider: provider ?? "", externalSubject: externalSubject ?? "", timestamp: timestamp ?? 0 },
      options.secretForSigning ?? SECRET,
    );
  }

  return new Request(url, { method, headers, body: method === "GET" ? undefined : bodyText });
}

describe("ContentOsRequestActorProvider", () => {
  it("is fully inert (returns null) when the feature flag is disabled, even with a valid signature", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: false, secret: SECRET }), () => NOW);
    const resolution = await provider.resolve(signedRequest({}));
    expect(resolution).toBeNull();
  });

  it("returns null (not applicable) when enabled but no signature header is present -- lets cookie auth handle it", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    const resolution = await provider.resolve(signedRequest({ omitSignature: true }));
    expect(resolution).toBeNull();
  });

  it("resolves a valid, fully-signed, linked request to the real actor with source CONTENT_OS_SERVICE", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    const resolution = await provider.resolve(signedRequest({}));
    expect(resolution).toEqual({ actor: ACTIVE_ACTOR, source: "CONTENT_OS_SERVICE" });
  });

  it("throws (not null) for a wrong-secret signature -- a present-but-invalid signature is a security event", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    await expect(provider.resolve(signedRequest({ secretForSigning: "wrong-secret" }))).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects an expired timestamp", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    await expect(provider.resolve(signedRequest({ timestamp: NOW_SECONDS - 3600 }))).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects a tampered method (request re-dispatched with a different method than it was signed for)", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    const signed = signedRequest({ method: "POST" });
    const tampered = new Request(signed.url, { method: "DELETE", headers: signed.headers, body: null });
    await expect(provider.resolve(tampered)).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects a tampered path", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    const signed = signedRequest({ url: "https://tasks.example.com/api/tasks/aaaa/actions" });
    const tampered = new Request("https://tasks.example.com/api/tasks/bbbb/actions", { method: signed.method, headers: signed.headers, body: await signed.clone().text() });
    await expect(provider.resolve(tampered)).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects a tampered body", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    const signed = signedRequest({ bodyText: JSON.stringify({ action: "ACCEPT" }) });
    const tampered = new Request(signed.url, { method: signed.method, headers: signed.headers, body: JSON.stringify({ action: "CANCEL" }) });
    await expect(provider.resolve(tampered)).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects a request missing the actor headers even with a signature header present", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    const request = signedRequest({ provider: null, omitSignature: true });
    const withOnlySignature = new Request(request.url, {
      method: request.method,
      headers: { [CONTENT_OS_SIGNATURE_HEADER]: "a".repeat(64) },
      body: await request.clone().text(),
    });
    await expect(provider.resolve(withOnlySignature)).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects an unknown (unlinked) actor identity", async () => {
    const provider = new ContentOsRequestActorProvider(new FixtureExternalActorResolver(new Map()), () => ({ enabled: true, secret: SECRET }), () => NOW);
    await expect(provider.resolve(signedRequest({}))).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects an inactive linked actor", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(INACTIVE_ACTOR), () => ({ enabled: true, secret: SECRET }), () => NOW);
    await expect(provider.resolve(signedRequest({}))).rejects.toBeInstanceOf(ApplicationError);
  });

  it("rejects when enabled but no secret is configured, without ever attempting verification", async () => {
    const provider = new ContentOsRequestActorProvider(linkedResolver(ACTIVE_ACTOR), () => ({ enabled: true, secret: undefined }), () => NOW);
    await expect(provider.resolve(signedRequest({}))).rejects.toBeInstanceOf(ApplicationError);
  });
});
