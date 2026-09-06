import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isValidWebhookSecret(received: string | null, expected: string): boolean {
  if (!received || !expected) {
    return false;
  }

  return timingSafeEqual(digest(received), digest(expected));
}
