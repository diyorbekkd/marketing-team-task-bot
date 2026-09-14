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

const TelegramUsernameLine = /^@([A-Za-z0-9_]{3,32})$/;

function meaningfulLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function requireFutureDeadline(deadline: string, now: Date): string {
  if (new Date(deadline).getTime() <= now.getTime()) {
    throw new TaskShorthandError("Deadline must be in the future.");
  }
  return deadline;
}

export function looksLikeTaskShorthand(text: string): boolean {
  return /(?:^|\n)\s*(?:@[A-Za-z0-9_]{3,32}\s+)?T\s*:/i.test(text);
}

export function looksLikePositionalTask(text: string): boolean {
  const lines = meaningfulLines(text);
  if (lines.length < 3) return false;

  const hasAssigneeHint = /^@\S+$/.test(lines[1]);
  // Anchored to the whole line so ordinary sentences that merely mention a clock
  // time (e.g. "soat 18:00 da") don't trigger the classifier; separators are kept
  // permissive (./-) so common near-miss formats still surface a helpful parse
  // error instead of being silently ignored as conversation.
  const hasDeadlineHint = /^\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\s+\d{1,2}:\d{2}$/.test(lines[2]);
  return hasAssigneeHint && hasDeadlineHint;
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
    deadline: requireFutureDeadline(parseTashkentDeadline(fields.get("DL")!, now), now),
    priority: fields.get("P")?.toLowerCase() || undefined,
    description: fields.get("D") || undefined,
  });
  if (!result.success) {
    throw new TaskShorthandError(result.error.issues[0]?.message ?? "Task format is invalid.");
  }
  return result.data;
}

export function parsePositionalTask(text: string, now = new Date()): ParsedTaskShorthand {
  const lines = meaningfulLines(text);
  if (lines.length < 3) {
    throw new TaskShorthandError("Task requires title, @assignee, and deadline lines.");
  }

  const assigneeMatch = lines[1].match(TelegramUsernameLine);
  if (!assigneeMatch) {
    throw new TaskShorthandError("Line 2 must be exactly @username.");
  }

  let deadline: string;
  try {
    deadline = requireFutureDeadline(parseTashkentDeadline(lines[2], now), now);
  } catch (error) {
    if (error instanceof TaskShorthandError && error.message.startsWith("DL ")) {
      throw new TaskShorthandError(error.message.replace(/^DL/, "Line 3"));
    }
    throw error;
  }

  const possiblePriority = lines[3]?.toLowerCase();
  const hasPriority = possiblePriority === "high" || possiblePriority === "normal" || possiblePriority === "low";
  const descriptionLines = lines.slice(hasPriority ? 4 : 3);
  const result = ParsedTaskSchema.safeParse({
    title: lines[0],
    assigneeUsername: assigneeMatch[1],
    deadline,
    priority: hasPriority ? possiblePriority : undefined,
    description: descriptionLines.length > 0 ? descriptionLines.join("\n") : undefined,
  });
  if (!result.success) {
    throw new TaskShorthandError(result.error.issues[0]?.message ?? "Task format is invalid.");
  }
  return result.data;
}

export function parseGroupTaskMessage(text: string, now = new Date()): ParsedTaskShorthand | null {
  if (looksLikeTaskShorthand(text)) return parseTaskShorthand(text, now);
  if (looksLikePositionalTask(text)) return parsePositionalTask(text, now);
  return null;
}

/**
 * Bulk task creation reuses this exact single-task parser for every block —
 * there is no separate bulk grammar. A message is bulk only if it contains a
 * line that is exactly "---"; a message with no such line is always parsed
 * as a single task, unchanged from before bulk existed.
 */
export const BULK_SEPARATOR = "---";
export const MAX_BULK_TASKS = 20;

export function containsBulkSeparator(text: string): boolean {
  return text.split(/\r?\n/).some((line) => line.trim() === BULK_SEPARATOR);
}

/** Splits on a line that is exactly "---", trims blank lines from each
 * block's edges, and drops blocks left empty by the split (for example a
 * lone "---" with nothing but whitespace on either side) so they can never
 * be mistaken for an attempted task. */
export function splitBulkBlocks(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[][] = [[]];
  for (const line of lines) {
    if (line.trim() === BULK_SEPARATOR) {
      blocks.push([]);
      continue;
    }
    blocks[blocks.length - 1].push(line);
  }
  return blocks.map((block) => block.join("\n").trim()).filter((block) => block.length > 0);
}

export interface TaskMessageBlockResult {
  /** 1-based position among the blocks actually parsed, for user-facing messages. */
  readonly index: number;
  readonly raw: string;
  readonly parsed: ParsedTaskShorthand | null;
  readonly error: TaskShorthandError | null;
}

export interface TaskMessageParseResult {
  readonly isBulk: boolean;
  readonly results: readonly TaskMessageBlockResult[];
  /** True when the message had more task-shaped blocks than MAX_BULK_TASKS and the excess was not parsed at all. */
  readonly truncated: boolean;
}

/**
 * Single entry point for both the group and the private bot: splits into
 * blocks (one, unless "---" is present), and runs the exact same
 * `parseGroupTaskMessage` shape-detection + parsing on each block. A block
 * with no task shape at all yields `parsed: null, error: null` (ordinary
 * text, never reported); a block that looks like an attempted task but fails
 * validation yields an `error`. Non-`TaskShorthandError` failures propagate.
 */
export function parseTaskMessage(text: string, now = new Date()): TaskMessageParseResult {
  const isBulk = containsBulkSeparator(text);
  const blocks = isBulk ? splitBulkBlocks(text) : [text.trim()];
  const truncated = isBulk && blocks.length > MAX_BULK_TASKS;
  const limited = blocks.slice(0, MAX_BULK_TASKS);

  const results = limited.map((raw, i): TaskMessageBlockResult => {
    try {
      return { index: i + 1, raw, parsed: parseGroupTaskMessage(raw, now), error: null };
    } catch (error) {
      if (error instanceof TaskShorthandError) {
        return { index: i + 1, raw, parsed: null, error };
      }
      throw error;
    }
  });

  return { isBulk, results, truncated };
}
