import { describe, expect, it } from "vitest";

describe("canonical shared migration manifest", () => {
  it("has the exact ordered versions and pinned Content OS source hashes", async () => {
    const modulePath = "../scripts/check-migration-manifest.mjs";
    const { checkMigrationManifest } = await import(modulePath);
    const result = checkMigrationManifest();

    expect(result.files).toHaveLength(20);
    expect(Object.keys(result.importedHashes)).toHaveLength(7);
  });
});
