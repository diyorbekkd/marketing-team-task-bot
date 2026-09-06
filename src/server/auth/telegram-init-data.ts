import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { VerifiedTelegramIdentity } from "./telegram-identity";

const TelegramWebAppUserSchema = z.object({
  id: z.number().int().safe().positive(),
  is_bot: z.boolean().optional(),
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

export class TelegramInitDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramInitDataError";
  }
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  now: Date = new Date(),
  maxAgeSeconds = 60 * 60,
): VerifiedTelegramIdentity {
  if (!initData || initData.length > 8192) {
    throw new TelegramInitDataError("Telegram init data is missing or too large.");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const authDateText = params.get("auth_date");
  const userText = params.get("user");
  const hasSingleCriticalValue = ["hash", "auth_date", "user"].every((key) => params.getAll(key).length === 1);
  if (!hasSingleCriticalValue || !receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash) || !authDateText || !userText) {
    throw new TelegramInitDataError("Telegram init data is incomplete.");
  }

  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest();
  const receivedHashBytes = Buffer.from(receivedHash, "hex");
  if (receivedHashBytes.length !== calculatedHash.length || !timingSafeEqual(receivedHashBytes, calculatedHash)) {
    throw new TelegramInitDataError("Telegram init data signature is invalid.");
  }

  const authDate = Number(authDateText);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(authDate) || authDate > nowSeconds + 30 || nowSeconds - authDate > maxAgeSeconds) {
    throw new TelegramInitDataError("Telegram init data has expired.");
  }

  let rawUser: unknown;
  try {
    rawUser = JSON.parse(userText);
  } catch {
    throw new TelegramInitDataError("Telegram user data is invalid JSON.");
  }
  const user = TelegramWebAppUserSchema.parse(rawUser);
  if (user.is_bot) {
    throw new TelegramInitDataError("Bot identities cannot open the Mini App.");
  }

  return {
    telegramUserId: String(user.id),
    username: user.username,
    displayName: [user.first_name, user.last_name].filter(Boolean).join(" "),
    verifiedAt: now,
  };
}
