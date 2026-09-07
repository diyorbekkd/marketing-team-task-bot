import { z } from "zod";

const ParsedTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  assigneeUsername: z.string().regex(/^[A-Za-z0-9_]{3,32}$/),
  deadline: z.string().datetime({ offset: true }),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
  description: z.string().trim().max(5000).optional(),
});

export type ParsedTaskShorthand = z.infer<typeof ParsedTaskSchema>;

export class TaskShorthandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskShorthandError";
  }
}

export function looksLikeTaskShorthand(text: string): boolean {
  return /(?:^|\n)\s*(?:@[A-Za-z0-9_]{3,32}\s+)?(?:T|A|DL|P|D)\s*:/i.test(text);
}

export function parseTashkentDeadline(value: string, now = new Date()): string {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})$/);
  if (!match) throw new TaskShorthandError("DL must use DD.MM HH:mm or DD.MM.YYYY HH:mm.");

  const [, dayText, monthText, explicitYear, hourText, minuteText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  let year = explicitYear ? Number(explicitYear) : tashkentNow.getUTCFullYear();

  const build = (candidateYear: number) => new Date(Date.UTC(candidateYear, month - 1, day, hour - 5, minute));
  let deadline = build(year);
  const localCheck = new Date(deadline.getTime() + 5 * 60 * 60 * 1000);
  if (
    month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 ||
    localCheck.getUTCFullYear() !== year || localCheck.getUTCMonth() !== month - 1 ||
    localCheck.getUTCDate() !== day || localCheck.getUTCHours() !== hour || localCheck.getUTCMinutes() !== minute
  ) {
    throw new TaskShorthandError("DL contains an invalid date or time.");
  }

  if (!explicitYear && deadline.getTime() < now.getTime()) {
    year += 1;
    deadline = build(year);
  }
  return deadline.toISOString();
}

export function parseTaskShorthand(text: string, now = new Date()): ParsedTaskShorthand {
  const fields = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine
      .trim()
      .replace(/^@[A-Za-z0-9_]{3,32}\s+(?=(?:T|A|DL|P|D)\s*:)/i, "");
    if (!line || /^@[A-Za-z0-9_]+$/.test(line)) continue;
    const match = line.match(/^(T|A|DL|P|D)\s*:\s*(.*)$/i);
    if (!match) continue;
    const key = match[1].toUpperCase();
    if (fields.has(key)) throw new TaskShorthandError(`${key} may only appear once.`);
    fields.set(key, match[2].trim());
  }

  for (const required of ["T", "A", "DL"]) {
    if (!fields.get(required)) throw new TaskShorthandError(`${required} is required.`);
  }

  const assignee = fields.get("A")!.replace(/^@/, "");
  const result = ParsedTaskSchema.safeParse({
    title: fields.get("T"),
    assigneeUsername: assignee,
    deadline: parseTashkentDeadline(fields.get("DL")!, now),
    priority: fields.get("P")?.toLowerCase() || undefined,
    description: fields.get("D") || undefined,
  });
  if (!result.success) {
    throw new TaskShorthandError(result.error.issues[0]?.message ?? "Task format is invalid.");
  }
  return result.data;
}
