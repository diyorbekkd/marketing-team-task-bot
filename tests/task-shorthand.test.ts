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

  it("rejects impossible local dates", () => {
    expect(() => parseTashkentDeadline("31.02.2026 12:00")).toThrow(/invalid date or time/);
  });
});
