import { z } from "zod";
import { RecurrenceFrequencySchema } from "./models";

export const RecurrenceInputSchema = z.object({
  frequency: RecurrenceFrequencySchema,
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.frequency === "WEEKLY" && value.weekday == null) {
    context.addIssue({ code: "custom", path: ["weekday"], message: "Weekday is required for weekly recurrence." });
  }
  if (value.frequency === "MONTHLY" && value.dayOfMonth == null) {
    context.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Day of month is required for monthly recurrence." });
  }
});

export const RecurrenceUpdateSchema = z.object({
  action: z.enum(["PAUSE", "RESUME", "STOP"]).optional(),
  frequency: RecurrenceFrequencySchema.optional(),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one recurrence change is required.");

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

function localParts(instant: Date) {
  const shifted = new Date(instant.getTime() + TASHKENT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function localInstant(year: number, month: number, day: number, localTime: string): Date {
  const [hour, minute] = localTime.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 5, minute));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function addLocalDays(parts: { year: number; month: number; day: number }, count: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * Returns the first scheduled instant strictly after `after`. Asia/Tashkent is
 * permanently UTC+05:00. Monthly days that do not exist use that month's last
 * calendar day (for example, day 31 becomes February 28/29).
 */
export function nextOccurrence(input: {
  frequency: "WEEKDAYS" | "WEEKLY" | "MONTHLY";
  weekday?: number | null;
  dayOfMonth?: number | null;
  localTime: string;
  endsOn?: string | null;
}, after: Date): string | null {
  const start = localParts(after);
  let candidate: Date | null = null;

  if (input.frequency === "MONTHLY") {
    const requestedDay = input.dayOfMonth!;
    for (let offset = 0; offset < 240; offset += 1) {
      const monthIndex = start.month - 1 + offset;
      const year = start.year + Math.floor(monthIndex / 12);
      const month = (monthIndex % 12) + 1;
      const day = Math.min(requestedDay, daysInMonth(year, month));
      const attempt = localInstant(year, month, day, input.localTime);
      if (attempt.getTime() > after.getTime()) { candidate = attempt; break; }
    }
  } else {
    for (let offset = 0; offset < 370; offset += 1) {
      const parts = addLocalDays(start, offset);
      const weekday = isoWeekday(parts.year, parts.month, parts.day);
      const matches = input.frequency === "WEEKDAYS"
        ? weekday >= 1 && weekday <= 5
        : weekday === input.weekday;
      if (!matches) continue;
      const attempt = localInstant(parts.year, parts.month, parts.day, input.localTime);
      if (attempt.getTime() > after.getTime()) { candidate = attempt; break; }
    }
  }

  if (!candidate) return null;
  if (input.endsOn) {
    const candidateDate = localParts(candidate);
    const key = `${candidateDate.year}-${String(candidateDate.month).padStart(2, "0")}-${String(candidateDate.day).padStart(2, "0")}`;
    if (key > input.endsOn) return null;
  }
  return candidate.toISOString();
}

export function containsPostingTag(title: string, description?: string | null): boolean {
  return /(^|[^A-Za-z0-9_])#posting(?=$|[^A-Za-z0-9_])/i.test(`${title}\n${description ?? ""}`);
}
