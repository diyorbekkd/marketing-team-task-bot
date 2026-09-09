import type { Task } from "./models";

export const REMINDER_TYPES = [
  "H24_BEFORE",
  "H3_BEFORE",
  "AT_DEADLINE",
  "H1_OVERDUE",
  "H24_OVERDUE",
] as const;

export type ReminderType = (typeof REMINDER_TYPES)[number];

const HOUR_MS = 60 * 60 * 1000;

const OFFSET_MS: Readonly<Record<ReminderType, number>> = {
  H24_BEFORE: -24 * HOUR_MS,
  H3_BEFORE: -3 * HOUR_MS,
  AT_DEADLINE: 0,
  H1_OVERDUE: 1 * HOUR_MS,
  H24_OVERDUE: 24 * HOUR_MS,
};

/**
 * How long after a threshold passes it is still worth sending. Scheduler runs
 * every few minutes, so this comfortably absorbs normal drift/downtime. It
 * also intentionally caps how far back a reminder can fire: a task whose
 * threshold passed long before this feature existed (or before a cron outage)
 * should not trigger a retroactive burst of every reminder at once — a missed
 * reminder is treated as missed, not queued forever. Recipients still see the
 * task's true state via Home/Tasks/Reports regardless of a missed reminder.
 */
const CATCH_UP_WINDOW_MS = 6 * HOUR_MS;

/** Only the assignee is notified before/at the deadline; overdue reminders
 * escalate to the creator and Head as well. */
export function reminderIncludesHeads(type: ReminderType): boolean {
  return type === "H1_OVERDUE" || type === "H24_OVERDUE";
}

export function reminderDirectRecipientIds(type: ReminderType, task: Pick<Task, "assigneeId" | "creatorId">): readonly string[] {
  return reminderIncludesHeads(type) ? [task.assigneeId, task.creatorId] : [task.assigneeId];
}

export function reminderThreshold(type: ReminderType, deadline: string): number {
  return new Date(deadline).getTime() + OFFSET_MS[type];
}

/** Reminder types whose threshold has passed (within the catch-up window) for
 * this task at `now`, in send order. */
export function dueReminderTypes(deadline: string, now: Date): ReminderType[] {
  const nowMs = now.getTime();
  return REMINDER_TYPES.filter((type) => {
    const threshold = reminderThreshold(type, deadline);
    return threshold <= nowMs && nowMs - threshold < CATCH_UP_WINDOW_MS;
  });
}
