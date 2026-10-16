import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_CRON_JOBS,
  jobsForCloudflareCron,
  runCloudflareScheduledCron,
} from "../src/server/cloudflare-scheduled";

describe("Cloudflare scheduled job dispatch", () => {
  it("maps every Vercel job to five Cloudflare UTC triggers", () => {
    expect(CLOUDFLARE_CRON_JOBS).toEqual({
      "0 3 * * *": ["daily-morning"],
      "0 14 * * *": ["daily-evening"],
      "0 5 * * 0": ["weekly"],
      "*/5 * * * *": ["recurring", "notifications"],
      "*/10 * * * *": ["reminders"],
    });
    expect(new Set(Object.values(CLOUDFLARE_CRON_JOBS).flat()).size).toBe(6);
  });

  it.each([
    ["0 3 * * *", ["daily-morning"]],
    ["0 14 * * *", ["daily-evening"]],
    ["0 5 * * 0", ["weekly"]],
    ["*/5 * * * *", ["recurring", "notifications"]],
    ["*/10 * * * *", ["reminders"]],
  ] as const)("runs every job for %s in deterministic order", async (cron, expectedJobs) => {
    const execute = vi.fn().mockResolvedValue(undefined);

    await expect(runCloudflareScheduledCron(cron, execute)).resolves.toEqual(expectedJobs);
    expect(execute.mock.calls).toEqual(expectedJobs.map((job) => [job]));
  });

  it("rejects any unconfigured trigger", () => {
    expect(() => jobsForCloudflareCron("* * * * *")).toThrow("Unrecognized Cloudflare cron trigger");
  });
});
