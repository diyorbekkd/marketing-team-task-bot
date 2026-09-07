import { describe, expect, it } from "vitest";
import {
  parseGroupTaskMessage,
  parsePositionalTask,
  parseTaskShorthand,
  parseTashkentDeadline,
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
});
