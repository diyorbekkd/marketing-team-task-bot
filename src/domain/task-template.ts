import { z } from "zod";

export const TemplateCheckpointSchema = z.object({
  title: z.string().trim().min(1).max(200),
  offsetDays: z.number().int().min(-365).max(365),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("18:00"),
}).strict();

export const SaveTaskTemplateSchema = z.object({
  sourceTemplateId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  deadlineOffsetDays: z.number().int().min(-365).max(365),
  deadlineLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("18:00"),
  checkpoints: z.array(TemplateCheckpointSchema).min(1).max(50),
}).strict();

export type TaskTemplate = z.infer<typeof SaveTaskTemplateSchema> & { id: string };

/** Calendar-day arithmetic on a Tashkent date, including month/year rollover. */
export function templateDueAt(eventOn: string, offsetDays: number, localTime = "18:00"): string {
  const day = z.iso.date().parse(eventOn);
  const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).parse(localTime);
  if (!Number.isInteger(offsetDays) || Math.abs(offsetDays) > 365) throw new Error("Invalid offset");
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== day) throw new Error("Invalid date");
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return `${date.toISOString().slice(0, 10)}T${time}:00+05:00`;
}
