import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const SESSION_COOKIE_NAME = "marketing_session";
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const SessionPayloadSchema = z.object({
  v: z.literal(1),
  userId: z.string().uuid(),
  telegramUserId: z.string().regex(/^\d+$/),
  expiresAt: z.number().int().positive(),
});

export type SessionPayload = z.infer<typeof SessionPayloadSchema>;

function signingKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("marketing-team-session-v1").digest();
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(payload).digest();
}

export function createSessionToken(
  input: Readonly<{ userId: string; telegramUserId: string }>,
  secret: string,
  now: Date = new Date(),
): string {
  const payload: SessionPayload = {
    v: 1,
    userId: input.userId,
    telegramUserId: input.telegramUserId,
    expiresAt: Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded, secret).toString("base64url")}`;
}

export function verifySessionToken(token: string, secret: string, now: Date = new Date()): SessionPayload | null {
  const [encoded, receivedSignature, extra] = token.split(".");
  if (!encoded || !receivedSignature || extra) return null;

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(receivedSignature, "base64url");
  } catch {
    return null;
  }
  const expected = signature(encoded, secret);
  if (signatureBytes.length !== expected.length || !timingSafeEqual(signatureBytes, expected)) return null;

  try {
    const payload = SessionPayloadSchema.parse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (payload.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
