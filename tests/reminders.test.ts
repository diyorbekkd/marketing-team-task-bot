import { describe, expect, it } from "vitest";
import { dueReminderTypes, reminderDirectRecipientIds, reminderIncludesHeads, reminderThreshold } from "../src/domain/reminders";

const deadline = "2026-09-10T13:00:00.000Z"; // 18:00 Asia/Tashkent
const task = { assigneeId: "assignee-1", creatorId: "creator-1" };

describe("deadline reminder thresholds", () => {
  it("computes each threshold relative to the deadline", () => {
    expect(reminderThreshold("H24_BEFORE", deadline)).toBe(new Date("2026-09-09T13:00:00.000Z").getTime());
    expect(reminderThreshold("H3_BEFORE", deadline)).toBe(new Date("2026-09-10T10:00:00.000Z").getTime());
    expect(reminderThreshold("AT_DEADLINE", deadline)).toBe(new Date(deadline).getTime());
    expect(reminderThreshold("H1_OVERDUE", deadline)).toBe(new Date("2026-09-10T14:00:00.000Z").getTime());
    expect(reminderThreshold("H24_OVERDUE", deadline)).toBe(new Date("2026-09-11T13:00:00.000Z").getTime());
  });

  it("fires the 24h-before reminder once its threshold passes", () => {
    expect(dueReminderTypes(deadline, new Date("2026-09-09T13:05:00.000Z"))).toEqual(["H24_BEFORE"]);
  });

  it("fires the 3h-before reminder once its threshold passes", () => {
    expect(dueReminderTypes(deadline, new Date("2026-09-10T10:05:00.000Z"))).toContain("H3_BEFORE");
  });

  it("fires the at-deadline reminder once the deadline itself passes", () => {
    expect(dueReminderTypes(deadline, new Date("2026-09-10T13:05:00.000Z"))).toContain("AT_DEADLINE");
  });

  it("fires the 1h-overdue reminder", () => {
    expect(dueReminderTypes(deadline, new Date("2026-09-10T14:05:00.000Z"))).toContain("H1_OVERDUE");
  });

  it("fires the 24h-overdue escalation", () => {
    expect(dueReminderTypes(deadline, new Date("2026-09-11T13:05:00.000Z"))).toContain("H24_OVERDUE");
  });

  it("does not retroactively fire a threshold that passed long ago (catch-up window)", () => {
    const longOverdue = new Date("2026-09-20T00:00:00.000Z");
    expect(dueReminderTypes(deadline, longOverdue)).toEqual([]);
  });

  it("sends before/at-deadline reminders only to the assignee", () => {
    expect(reminderDirectRecipientIds("H24_BEFORE", task)).toEqual(["assignee-1"]);
    expect(reminderDirectRecipientIds("H3_BEFORE", task)).toEqual(["assignee-1"]);
    expect(reminderDirectRecipientIds("AT_DEADLINE", task)).toEqual(["assignee-1"]);
    expect(reminderIncludesHeads("H24_BEFORE")).toBe(false);
  });

  it("escalates overdue reminders to the assignee, creator, and Head", () => {
    expect(reminderDirectRecipientIds("H1_OVERDUE", task)).toEqual(["assignee-1", "creator-1"]);
    expect(reminderDirectRecipientIds("H24_OVERDUE", task)).toEqual(["assignee-1", "creator-1"]);
    expect(reminderIncludesHeads("H1_OVERDUE")).toBe(true);
    expect(reminderIncludesHeads("H24_OVERDUE")).toBe(true);
  });
});
