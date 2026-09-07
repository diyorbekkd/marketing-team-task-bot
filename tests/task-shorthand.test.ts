import { describe, expect, it } from "vitest";
import { parseTaskShorthand, parseTashkentDeadline } from "../src/telegram/task-shorthand";

describe("Telegram task shorthand", () => {
  it("parses T/A/DL with optional priority and description", () => {
    expect(parseTaskShorthand("T: Publish launch reel\nA: @editor\nDL: 08.09.2026 18:30\nP: high\nD: Use final cut")).toEqual({
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
    ].join("\n"))).toMatchObject({
      title: "Create campaign creatives",
      assigneeUsername: "editor",
    });
  });

  it("accepts normal prefix whitespace and case-insensitive fields", () => {
    expect(parseTaskShorthand(" t : Publish story\n a : @editor\n dl : 08.09.2026 18:30 ")).toMatchObject({
      title: "Publish story",
      assigneeUsername: "editor",
    });
  });

  it("ignores an inline bot mention immediately before the title field", () => {
    expect(parseTaskShorthand("@marketing_team_task_bot T: Publish reel\nA: @editor\nDL: 08.09.2026 18:30")).toMatchObject({
      title: "Publish reel",
      assigneeUsername: "editor",
    });
  });

  it("rejects impossible local dates", () => {
    expect(() => parseTashkentDeadline("31.02.2026 12:00")).toThrow(/invalid date or time/);
  });
});
