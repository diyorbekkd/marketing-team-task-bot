import { describe, expect, it } from "vitest";
import { containsPostingTag, nextOccurrence } from "../src/domain/recurrence";

describe("deterministic posting detection", () => {
  it("finds the exact tag anywhere without matching longer tags", () => {
    expect(containsPostingTag("Instagram post", "Publish everywhere #posting today")).toBe(true);
    expect(containsPostingTag("#POSTING launch", null)).toBe(true);
    expect(containsPostingTag("Do not match #postings", null)).toBe(false);
  });
});

describe("Asia/Tashkent recurrence calculation", () => {
  it("schedules weekdays at the selected local time and skips weekends", () => {
    expect(nextOccurrence({ frequency: "WEEKDAYS", localTime: "09:00" }, new Date("2026-09-11T05:00:00Z")))
      .toBe("2026-09-14T04:00:00.000Z");
  });

  it("schedules the selected ISO weekday", () => {
    expect(nextOccurrence({ frequency: "WEEKLY", weekday: 1, localTime: "10:00" }, new Date("2026-09-09T00:00:00Z")))
      .toBe("2026-09-14T05:00:00.000Z");
  });

  it("uses the last day of shorter months for monthly day 31", () => {
    expect(nextOccurrence({ frequency: "MONTHLY", dayOfMonth: 31, localTime: "09:00" }, new Date("2027-02-01T00:00:00Z")))
      .toBe("2027-02-28T04:00:00.000Z");
  });

  it("honors an inclusive local end date", () => {
    expect(nextOccurrence({ frequency: "WEEKLY", weekday: 1, localTime: "10:00", endsOn: "2026-09-13" }, new Date("2026-09-09T00:00:00Z")))
      .toBeNull();
  });
});
