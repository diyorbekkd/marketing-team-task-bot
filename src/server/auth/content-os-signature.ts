import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing/verification primitives for server-to-server requests from
 * Content OS. Pure crypto only -- no Request/Next.js/env dependency here,
 * so this is directly unit-testable and independently reviewable from the
 * HTTP wiring in content-os-request-actor-provider.ts.
 *
 * Canonical signing input covers exactly what the audit's threat model
 * requires: timestamp (replay/expiry), method + path (endpoint identity),
 * a body hash (tamper detection without re-hashing large bodies at verify
 * time twice), and the claimed actor identity as a (provider, subject)
 * pair -- never a raw public.users.id, since Content OS's own identity
 * model (SIWC) is not that id; see external-actor-resolver.ts.
 */
export const CONTENT_OS_TIMESTAMP_HEADER = "x-content-os-timestamp";
export const CONTENT_OS_ACTOR_PROVIDER_HEADER = "x-content-os-actor-provider";
export const CONTENT_OS_ACTOR_SUBJECT_HEADER = "x-content-os-actor-subject";
export const CONTENT_OS_SIGNATURE_HEADER = "x-content-os-signature";

/** Deliberately short: a signed request is meant to be used immediately by
 * a server, never queued or retried across a long delay. */
export const CONTENT_OS_SIGNATURE_MAX_SKEW_SECONDS = 60;

export interface ContentOsSignedRequestInput {
  readonly method: string;
  readonly path: string;
  readonly bodyText: string;
  readonly provider: string;
  readonly externalSubject: string;
  /** Unix seconds. */
  readonly timestamp: number;
}

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("content-os-service-auth-v1").digest();
}

function bodyHashHex(bodyText: string): string {
  return createHash("sha256").update(bodyText).digest("hex");
}

function canonicalString(input: ContentOsSignedRequestInput): string {
  return [
    String(input.timestamp),
    input.method.toUpperCase(),
    input.path,
    bodyHashHex(input.bodyText),
    input.provider,
    input.externalSubject,
  ].join("\n");
}

export function signContentOsRequest(input: ContentOsSignedRequestInput, secret: string): string {
  return createHmac("sha256", signingKey(secret)).update(canonicalString(input)).digest("hex");
}

export class ContentOsSignatureError extends Error {
  readonly code: "MALFORMED_SIGNATURE" | "EXPIRED" | "INVALID_SIGNATURE";
  constructor(code: ContentOsSignatureError["code"], message: string) {
    super(message);
    this.name = "ContentOsSignatureError";
    this.code = code;
  }
}

/** Throws ContentOsSignatureError; never returns a boolean, so a caller
 * cannot accidentally ignore a false result. */
export function verifyContentOsSignature(
  input: ContentOsSignedRequestInput,
  receivedSignatureHex: string,
  secret: string,
  now: Date = new Date(),
): void {
  if (!/^[0-9a-f]{64}$/i.test(receivedSignatureHex)) {
    throw new ContentOsSignatureError("MALFORMED_SIGNATURE", "Signature is not a 64-character hex string.");
  }
  if (!Number.isSafeInteger(input.timestamp)) {
    throw new ContentOsSignatureError("MALFORMED_SIGNATURE", "Timestamp is not a safe integer.");
  }
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (Math.abs(nowSeconds - input.timestamp) > CONTENT_OS_SIGNATURE_MAX_SKEW_SECONDS) {
    throw new ContentOsSignatureError("EXPIRED", "Request timestamp is outside the allowed window.");
  }

  const expected = Buffer.from(signContentOsRequest(input, secret), "hex");
  const received = Buffer.from(receivedSignatureHex, "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new ContentOsSignatureError("INVALID_SIGNATURE", "Signature verification failed.");
  }
}
