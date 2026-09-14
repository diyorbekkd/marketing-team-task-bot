import { describe, expect, it } from "vitest";
import {
  MAX_BULK_TASKS,
  containsBulkSeparator,
  parseGroupTaskMessage,
  parsePositionalTask,
  parseTaskMessage,
  parseTaskShorthand,
  parseTashkentDeadline,
  splitBulkBlocks,
} from "../src/telegram/task-shorthand";

const now = new Date("2026-09-07T08:00:00.000Z");

describe("Telegram task shorthand", () => {
  it("parses T/A/DL with optional priority and description", () => {
    expect(parseTaskShorthand("T: Publish launch reel\nA: @editor\nDL: 08.09.2026 18:30\nP: high\nD: Use final cut", now)).toEqual({
      title: "Publish launch reel",
      assigneeUsername: "editor",
      deadline: "2026-09-08T13:30:00.000Z",
      priority: "high",
      description: "Use final cut",
    });
  });

  it("interprets deadlines in Asia/Tashkent", () => {
    expect(parseTashkentDeadline("08.09.2026 00:15")).toBe("2026-09-07T19:15:00.000Z");
  });

  it("accepts the documented standalone bot mention and blank lines", () => {
    expect(parseTaskShorthand([
      "@marketing_team_task_bot",
      "",
      "T: Create campaign creatives",
      "",
      "A: @editor",
      "DL: 08.09.2026 18:30",
    ].join("\n"), now)).toMatchObject({
      title: "Create campaign creatives",
      assigneeUsername: "editor",
    });
  });

  it("accepts normal prefix whitespace and case-insensitive fields", () => {
    expect(parseTaskShorthand(" t : Publish story\n a : @editor\n dl : 08.09.2026 18:30 ", now)).toMatchObject({
      title: "Publish story",
      assigneeUsername: "editor",
    });
  });

  it("ignores an inline bot mention immediately before the title field", () => {
    expect(parseTaskShorthand("@marketing_team_task_bot T: Publish reel\nA: @editor\nDL: 08.09.2026 18:30", now)).toMatchObject({
      title: "Publish reel",
      assigneeUsername: "editor",
    });
  });

  it("rejects impossible local dates", () => {
    expect(() => parseTashkentDeadline("31.02.2026 12:00")).toThrow(/invalid date or time/);
  });

  it("parses the primary positional format", () => {
    expect(parsePositionalTask("Yangi creative\n@misbahmarketing\n08.09.2026 18:00", now)).toEqual({
      title: "Yangi creative",
      assigneeUsername: "misbahmarketing",
      deadline: "2026-09-08T13:00:00.000Z",
      priority: "normal",
    });
  });

  it("ignores blank lines in the positional structure", () => {
    expect(parsePositionalTask([
      "Yangi creative",
      "",
      "@misbahmarketing",
      "  ",
      "08.09.2026 18:00",
    ].join("\n"), now)).toMatchObject({
      title: "Yangi creative",
      assigneeUsername: "misbahmarketing",
    });
  });

  it("parses positional priority", () => {
    expect(parsePositionalTask([
      "Yangi creative",
      "@misbahmarketing",
      "08.09.2026 18:00",
      "high",
      "Import reklama uchun",
      "5 ta creative",
    ].join("\n"), now)).toMatchObject({
      priority: "high",
      description: "Import reklama uchun\n5 ta creative",
    });
  });

  it("treats line four and later lines as description when priority is absent", () => {
    expect(parsePositionalTask([
      "Yangi creative",
      "@misbahmarketing",
      "08.09.2026 18:00",
      "Import reklama uchun",
      "5 ta creative",
    ].join("\n"), now)).toMatchObject({
      priority: "normal",
      description: "Import reklama uchun\n5 ta creative",
    });
  });

  it("rejects malformed and past positional deadlines", () => {
    expect(() => parseGroupTaskMessage(
      "Yangi creative\n@misbahmarketing\n08-09-2026 18:00",
      now,
    )).toThrow(/Line 3/);
    expect(() => parseGroupTaskMessage(
      "Yangi creative\n@misbahmarketing\n01.01.2026 10:00",
      now,
    )).toThrow(/future/);
  });

  it("silently ignores unrelated three-line conversation", () => {
    expect(parseGroupTaskMessage("Bugun yig‘ilish bor\nHamma qatnashsin\nSoat oltida", now)).toBeNull();
    expect(parseGroupTaskMessage("Bugun yig‘ilish bor\n@misbahmarketing\nQatnasha olasizmi?", now)).toBeNull();
    expect(parseGroupTaskMessage("Yig‘ilish\nHamma qatnashsin\n09.09.2026 14:00", now)).toBeNull();
    expect(parseGroupTaskMessage("Muhokama\nD: yangi variant\nKeyin ko‘ramiz", now)).toBeNull();
    // A bare clock-time mention (with surrounding words, or with no date at all)
    // must not activate the classifier even when line 2 is @assignee-shaped.
    expect(parseGroupTaskMessage("Yig‘ilish\n@misbahmarketing\nsoat 18:00 da", now)).toBeNull();
    expect(parseGroupTaskMessage("Yig‘ilish\n@misbahmarketing\n18:00", now)).toBeNull();
  });

  it("chooses labeled parsing before positional parsing", () => {
    expect(parseGroupTaskMessage(
      "T: Publish reel\nA: @editor\nDL: 08.09.2026 18:30",
      now,
    )).toMatchObject({ title: "Publish reel", assigneeUsername: "editor" });
  });

  describe("bulk message parsing", () => {
    it("detects the exact '---' separator line but not the word inside other text", () => {
      expect(containsBulkSeparator("Title\n---\nMore")).toBe(true);
      expect(containsBulkSeparator("  ---  \nignored trailing/leading spaces on the line itself")).toBe(true);
      expect(containsBulkSeparator("a---b")).toBe(false);
      expect(containsBulkSeparator("Just a normal task\n@editor\n08.09.2026 18:00")).toBe(false);
    });

    it("splits on the separator, trims blank lines per block, and drops empty blocks", () => {
      const text = "\n\nFirst\n@editor\n08.09.2026 18:00\n\n---\n\n\nSecond\n@lead\n09.09.2026 07:00\n\n---\n\n   \n";
      expect(splitBulkBlocks(text)).toEqual([
        "First\n@editor\n08.09.2026 18:00",
        "Second\n@lead\n09.09.2026 07:00",
      ]);
    });

    it("a message with no separator parses exactly as the existing single-task format, unchanged", () => {
      const result = parseTaskMessage("T: Publish reel\nA: @editor\nDL: 08.09.2026 18:30", now);
      expect(result.isBulk).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].parsed).toMatchObject({ title: "Publish reel", assigneeUsername: "editor" });
      expect(result.truncated).toBe(false);
    });

    it("a lone separator with blank content on both sides never produces a task attempt", () => {
      expect(parseTaskMessage("---", now).results).toEqual([]);
      expect(parseTaskMessage("\n---\n\n", now).results).toEqual([]);
    });

    it("parses every block with the exact single-task parser, isolating one bad block's error from the rest", () => {
      const text = [
        "First task", "@editor", "08.09.2026 18:00",
        "---",
        "Bad block", "@editor", "08-09-2026 18:00",
        "---",
        "Third task", "@lead", "09.09.2026 07:00",
      ].join("\n");
      const result = parseTaskMessage(text, now);

      expect(result.isBulk).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toMatchObject({ index: 1, error: null });
      expect(result.results[0].parsed).toMatchObject({ title: "First task" });
      expect(result.results[1]).toMatchObject({ index: 2, parsed: null });
      expect(result.results[1].error?.message).toBeTruthy();
      expect(result.results[2]).toMatchObject({ index: 3, error: null });
      expect(result.results[2].parsed).toMatchObject({ title: "Third task" });
    });

    it("caps a batch at MAX_BULK_TASKS and reports truncation instead of silently dropping the excess", () => {
      const blocks = Array.from({ length: MAX_BULK_TASKS + 1 }, (_, i) => `Task ${i + 1}\n@editor\n0${(i % 9) + 1}.09.2026 18:00`);
      const result = parseTaskMessage(blocks.join("\n---\n"), now);

      expect(result.isBulk).toBe(true);
      expect(result.truncated).toBe(true);
      expect(result.results).toHaveLength(MAX_BULK_TASKS);
    });

    it("does not truncate or report truncation when the batch is exactly at the limit", () => {
      const blocks = Array.from({ length: MAX_BULK_TASKS }, (_, i) => `Task ${i + 1}\n@editor\n0${(i % 9) + 1}.09.2026 18:00`);
      const result = parseTaskMessage(blocks.join("\n---\n"), now);

      expect(result.truncated).toBe(false);
      expect(result.results).toHaveLength(MAX_BULK_TASKS);
    });
  });
});
