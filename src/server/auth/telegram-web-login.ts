import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";

export const WEB_LOGIN_COOKIE = "marketing_web_login";
const LoginStateSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{32,64}$/),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
});
const telegramKeys = createRemoteJWKSet(new URL("https://oauth.telegram.org/.well-known/jwks.json"));

export function createWebLoginChallenge() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { state, verifier, challenge };
}

export function readWebLoginState(cookie: string | undefined, receivedState: string | null): string | null {
  if (!cookie || !receivedState) return null;
  try {
    const parsed = LoginStateSchema.safeParse(JSON.parse(cookie));
    if (!parsed.success) return null;
    const expected = Buffer.from(parsed.data.state);
    const received = Buffer.from(receivedState);
    return expected.length === received.length && timingSafeEqual(expected, received)
      ? parsed.data.verifier
      : null;
  } catch {
    return null;
  }
}

export async function verifyTelegramWebIdToken(
  idToken: string,
  clientId: string,
  keys: JWTVerifyGetKey = telegramKeys,
): Promise<string> {
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: "https://oauth.telegram.org",
    audience: clientId,
    algorithms: ["RS256"],
    maxTokenAge: "5 minutes",
    clockTolerance: "30 seconds",
  });
  if (typeof payload.sub !== "string" || !/^\d{1,20}$/.test(payload.sub)) {
    throw new Error("Telegram identity is invalid.");
  }
  return payload.sub;
}
