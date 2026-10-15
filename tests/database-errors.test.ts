import { describe, expect, it } from "vitest";
import { mapDataError } from "../src/server/repositories/database-errors";

describe("database error classification", () => {
  it("classifies Task Bot PT409 refusals as deterministic application conflicts", () => {
    expect(mapDataError({ code: "PT409", message: "task status changed concurrently" }, "fallback")).toMatchObject({
      code: "CONFLICT",
      message: "task status changed concurrently",
    });
  });

  it("does not conflate a real serialization failure with a business refusal", () => {
    expect(mapDataError({ code: "40001", message: "could not serialize access" }, "Database unavailable.")).toMatchObject({
      code: "INTEGRATION_UNAVAILABLE",
      message: "Database unavailable.",
    });
  });
});
