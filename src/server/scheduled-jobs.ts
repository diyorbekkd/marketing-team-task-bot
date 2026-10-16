import "server-only";

import { z } from "zod";
import { getMarketingService, getReminderService, getReportingService } from "@/server/application";

export const ScheduledJobSchema = z.enum([
  "daily-morning",
  "daily-evening",
  "weekly",
  "recurring",
  "reminders",
  "notifications",
]);

export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

export async function runScheduledJob(job: ScheduledJob) {
  return job === "notifications"
    ? getMarketingService().deliverTaskNotificationOutbox()
    : job === "recurring"
      ? getMarketingService().generateDueRecurringTasks()
      : job === "reminders"
        ? getReminderService().deliver()
        : getReportingService().deliver(
            job === "daily-morning" ? "DAILY_MORNING" : job === "daily-evening" ? "DAILY_EVENING" : "WEEKLY",
          );
}
