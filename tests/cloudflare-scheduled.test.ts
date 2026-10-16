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

  it("runs recurring before notifications when recurring succeeds", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);

    await expect(runCloudflareScheduledCron("*/5 * * * *", execute)).resolves.toEqual([
      "recurring",
      "notifications",
    ]);
    expect(execute.mock.calls).toEqual([["recurring"], ["notifications"]]);
  });

  it.each([
    ["0 3 * * *", "daily-morning"],
    ["0 14 * * *", "daily-evening"],
    ["0 5 * * 0", "weekly"],
    ["*/10 * * * *", "reminders"],
  ] as const)("keeps the existing %s mapping", async (cron, expectedJob) => {
    const execute = vi.fn().mockResolvedValue(undefined);

    await expect(runCloudflareScheduledCron(cron, execute)).resolves.toEqual([expectedJob]);
    expect(execute).toHaveBeenCalledExactlyOnceWith(expectedJob);
  });

  it("still runs notifications after recurring fails and preserves the failure", async () => {
    const recurringError = new Error("recurring failed");
    const execute = vi.fn(async (job: string) => {
      if (job === "recurring") throw recurringError;
    });

    await expect(runCloudflareScheduledCron("*/5 * * * *", execute)).rejects.toBe(recurringError);
    expect(execute.mock.calls).toEqual([["recurring"], ["notifications"]]);
  });

  it("keeps a notifications failure observable", async () => {
    const notificationsError = new Error("notifications failed");
    const execute = vi.fn(async (job: string) => {
      if (job === "notifications") throw notificationsError;
    });

    await expect(runCloudflareScheduledCron("*/5 * * * *", execute)).rejects.toBe(notificationsError);
    expect(execute.mock.calls).toEqual([["recurring"], ["notifications"]]);
  });

  it("reports every failure after attempting every job for a shared trigger", async () => {
    const recurringError = new Error("recurring failed");
    const notificationsError = new Error("notifications failed");
    const execute = vi
      .fn()
      .mockRejectedValueOnce(recurringError)
      .mockRejectedValueOnce(notificationsError);

    const result = runCloudflareScheduledCron("*/5 * * * *", execute);

    await expect(result).rejects.toMatchObject({
      message: "Cloudflare scheduled jobs failed: recurring, notifications",
      errors: [recurringError, notificationsError],
    });
    expect(execute.mock.calls).toEqual([["recurring"], ["notifications"]]);
  });

  it("rejects any unconfigured trigger", () => {
    expect(() => jobsForCloudflareCron("* * * * *")).toThrow("Unrecognized Cloudflare cron trigger");
  });
});
