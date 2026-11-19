import { describe, expect, it } from "vitest";
import { SaveTaskTemplateSchema, templateDueAt } from "@/domain/task-template";

describe("relative checkpoint task templates", () => {
  it("uses Tashkent calendar dates across month and year boundaries", () => {
    expect(templateDueAt("2026-11-10", -3, "18:00")).toBe("2026-11-07T18:00:00+05:00");
    expect(templateDueAt("2026-11-10", 1)).toBe("2026-11-11T18:00:00+05:00");
    expect(templateDueAt("2026-01-01", -3, "09:15")).toBe("2025-12-29T09:15:00+05:00");
  });

  it("defaults each checkpoint time to 18:00 and rejects invalid template bounds", () => {
    const input = { sourceTemplateId: null, name: "Webinar", deadlineOffsetDays: 1,
      checkpoints: [{ title: "E’lon qilish", offsetDays: -2 }] };
    expect(SaveTaskTemplateSchema.parse(input)).toMatchObject({ deadlineLocalTime: "18:00",
      checkpoints: [{ localTime: "18:00" }] });
    expect(() => SaveTaskTemplateSchema.parse({ ...input, checkpoints: [{ title: "", offsetDays: -2 }] })).toThrow();
    expect(() => SaveTaskTemplateSchema.parse({ ...input, deadlineOffsetDays: 366 })).toThrow();
    expect(() => templateDueAt("2026-02-30", 0)).toThrow();
  });
});
