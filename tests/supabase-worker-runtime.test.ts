import { afterEach, describe, expect, it, vi } from "vitest";

describe("Supabase Worker runtime initialization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("creates the fetch-based server client without a database connection", async () => {
    vi.stubEnv("SUPABASE_URL", "https://yuznbaaoonyqonhiywkt.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "public-placeholder");
    vi.stubEnv("SUPABASE_SECRET_KEY", "server-placeholder");

    const { getSupabaseAdminClient } = await import("../src/server/db/supabase");
    const client = getSupabaseAdminClient();

    expect(client).toBe(getSupabaseAdminClient());
    expect(client.from("tasks")).toBeDefined();
  });
});
