import "server-only";

import { runScheduledJob, type ScheduledJob } from "@/server/scheduled-jobs";

export const CLOUDFLARE_CRON_JOBS = {
  "0 3 * * *": ["daily-morning"],
  "0 14 * * *": ["daily-evening"],
  "0 5 * * 0": ["weekly"],
  "*/5 * * * *": ["recurring", "notifications"],
  "*/10 * * * *": ["reminders"],
} as const satisfies Record<string, readonly ScheduledJob[]>;

export type CloudflareCron = keyof typeof CLOUDFLARE_CRON_JOBS;

export function jobsForCloudflareCron(cron: string): readonly ScheduledJob[] {
  const jobs = CLOUDFLARE_CRON_JOBS[cron as CloudflareCron];
  if (!jobs) throw new Error(`Unrecognized Cloudflare cron trigger: ${cron}`);
  return jobs;
}

export async function runCloudflareScheduledCron(
  cron: string,
  execute: (job: ScheduledJob) => Promise<unknown> = runScheduledJob,
) {
  const completed: ScheduledJob[] = [];
  const failures: { job: ScheduledJob; error: unknown }[] = [];
  for (const job of jobsForCloudflareCron(cron)) {
    try {
      await execute(job);
      completed.push(job);
    } catch (error) {
      failures.push({ job, error });
    }
  }

  if (failures.length === 1) throw failures[0].error;
  if (failures.length > 1) {
    throw new AggregateError(
      failures.map(({ error }) => error),
      `Cloudflare scheduled jobs failed: ${failures.map(({ job }) => job).join(", ")}`,
    );
  }

  return completed;
}
