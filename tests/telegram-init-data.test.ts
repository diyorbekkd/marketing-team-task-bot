import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelegramInitData } from "../src/server/auth/telegram-init-data";

const botToken = ["123456789", "test_token_material_long_enough_for_validation"].join(":");
const now = new Date("2026-09-06T12:00:00.000Z");

function signedInitData(overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(now.getTime() / 1000)),
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: 123456789, first_name: "Ada", username: "ada" }),
    ...overrides,
  });
  const check = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

describe("Telegram Mini App initData verification", () => {
  it("accepts a fresh Telegram-signed identity", () => {
    expect(verifyTelegramInitData(signedInitData(), botToken, now)).toMatchObject({
      telegramUserId: "123456789",
      username: "ada",
      displayName: "Ada",
    });
  });

  it("rejects forged identity data", () => {
    const forged = signedInitData().replace("Ada", "Mallory");
    expect(() => verifyTelegramInitData(forged, botToken, now)).toThrow(/signature is invalid/);
  });

  it("rejects correctly signed but expired data", () => {
    const oldAuthDate = String(Math.floor(now.getTime() / 1000) - 3601);
    expect(() => verifyTelegramInitData(signedInitData({ auth_date: oldAuthDate }), botToken, now)).toThrow(/expired/);
  });
});
