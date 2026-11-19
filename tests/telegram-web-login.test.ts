import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  createWebLoginChallenge,
  readWebLoginState,
  verifyTelegramWebIdToken,
} from "../src/server/auth/telegram-web-login";

describe("Telegram web login", () => {
  it("requires the matching one-time state and keeps the PKCE verifier in the cookie", () => {
    const challenge = createWebLoginChallenge();
    const cookie = JSON.stringify({ state: challenge.state, verifier: challenge.verifier });
    expect(readWebLoginState(cookie, challenge.state)).toBe(challenge.verifier);
    expect(readWebLoginState(cookie, "wrong")).toBeNull();
    expect(readWebLoginState("broken", challenge.state)).toBeNull();
    expect(challenge.challenge).not.toBe(challenge.verifier);
  });

  it("accepts only a Telegram-signed token for the configured bot", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test" }] });
    const signed = new SignJWT({ sub: "123456789" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer("https://oauth.telegram.org")
      .setAudience("test-bot")
      .setIssuedAt()
      .setExpirationTime("5m");
    const token = await signed.sign(privateKey);

    await expect(verifyTelegramWebIdToken(token, "test-bot", keys)).resolves.toBe("123456789");
    await expect(verifyTelegramWebIdToken(token, "other-bot", keys)).rejects.toThrow();
  });
});
