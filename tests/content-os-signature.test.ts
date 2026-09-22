import { describe, expect, it } from "vitest";
import {
  CONTENT_OS_SIGNATURE_MAX_SKEW_SECONDS,
  ContentOsSignatureError,
  signContentOsRequest,
  verifyContentOsSignature,
} from "../src/server/auth/content-os-signature";
import type { ContentOsSignedRequestInput } from "../src/server/auth/content-os-signature";

const SECRET = "test-content-os-service-secret-value";
const NOW = new Date("2026-09-22T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function baseInput(overrides: Partial<ContentOsSignedRequestInput> = {}): ContentOsSignedRequestInput {
  return {
    method: "POST",
    path: "/api/tasks",
    bodyText: JSON.stringify({ title: "Draft a carousel" }),
    provider: "content-os",
    externalSubject: "siwc-user-abc123",
    timestamp: NOW_SECONDS,
    ...overrides,
  };
}

describe("Content OS request signing", () => {
  it("a correctly signed request verifies", () => {
    const input = baseInput();
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature(input, signature, SECRET, NOW)).not.toThrow();
  });

  it("rejects the wrong secret", () => {
    const input = baseInput();
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature(input, signature, "a-different-secret", NOW)).toThrow(ContentOsSignatureError);
  });

  it("rejects an expired (too-old) timestamp", () => {
    const input = baseInput({ timestamp: NOW_SECONDS - CONTENT_OS_SIGNATURE_MAX_SKEW_SECONDS - 1 });
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature(input, signature, SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("rejects a too-far-future timestamp (clock skew abuse, not just replay)", () => {
    const input = baseInput({ timestamp: NOW_SECONDS + CONTENT_OS_SIGNATURE_MAX_SKEW_SECONDS + 1 });
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature(input, signature, SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("a timestamp exactly at the skew boundary still verifies", () => {
    const input = baseInput({ timestamp: NOW_SECONDS - CONTENT_OS_SIGNATURE_MAX_SKEW_SECONDS });
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature(input, signature, SECRET, NOW)).not.toThrow();
  });

  it("rejects a modified method after signing", () => {
    const input = baseInput({ method: "POST" });
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature({ ...input, method: "DELETE" }, signature, SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("rejects a modified path after signing", () => {
    const input = baseInput({ path: "/api/tasks" });
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature({ ...input, path: "/api/tasks/00000000-0000-0000-0000-000000000000/actions" }, signature, SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("rejects a modified (tampered) body after signing", () => {
    const input = baseInput({ bodyText: JSON.stringify({ title: "Original title" }) });
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature({ ...input, bodyText: JSON.stringify({ title: "Tampered title" }) }, signature, SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("rejects a substituted actor identity after signing (provider/externalSubject swap)", () => {
    const input = baseInput({ provider: "content-os", externalSubject: "siwc-user-abc123" });
    const signature = signContentOsRequest(input, SECRET);
    expect(() => verifyContentOsSignature({ ...input, externalSubject: "siwc-user-someone-else" }, signature, SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("rejects a malformed signature string instead of attempting comparison", () => {
    const input = baseInput();
    expect(() => verifyContentOsSignature(input, "not-hex-and-wrong-length", SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("rejects a well-formed but wrong-value signature (timing-safe path)", () => {
    const input = baseInput();
    const wrongButValidHex = "0".repeat(64);
    expect(() => verifyContentOsSignature(input, wrongButValidHex, SECRET, NOW)).toThrow(ContentOsSignatureError);
  });

  it("two different bodies never produce the same signature for otherwise-identical requests", () => {
    const a = signContentOsRequest(baseInput({ bodyText: "{}" }), SECRET);
    const b = signContentOsRequest(baseInput({ bodyText: '{"x":1}' }), SECRET);
    expect(a).not.toBe(b);
  });
});
