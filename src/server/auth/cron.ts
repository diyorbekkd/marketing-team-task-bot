import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getCronConfig } from "@/server/config";

export function isAuthorizedCronRequest(request: Request): boolean {
  const expected = Buffer.from(`Bearer ${getCronConfig().secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
