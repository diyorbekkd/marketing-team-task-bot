import { describe, expect, it, vi } from "vitest";

const { getSupabaseAdminClient } = vi.hoisted(() => ({ getSupabaseAdminClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("../src/server/db/supabase", () => ({ getSupabaseAdminClient }));

import { SupabaseMarketingRepository } from "../src/server/repositories/supabase-marketing-repository";

describe("task event repository", () => {
  it("loads template events that the database allows in task detail", async () => {
    const taskId = "10000000-0000-4000-8000-000000000001";
    const rows = ["TASK_TEMPLATE_APPLIED", "TASK_TEMPLATE_EVENT_CHANGED", "CHECKPOINT_DUE_CHANGED"]
      .map((event_type, index) => ({
        id: `20000000-0000-4000-8000-00000000000${index + 1}`,
        task_id: taskId, actor_id: null, actor_kind: "SYSTEM", event_type,
        old_value: null, new_value: {}, metadata: {}, created_at: "2026-11-23T12:00:00Z",
      }));
    const query = {
      eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: rows, error: null })),
    };
    getSupabaseAdminClient.mockReturnValue({ from: () => ({ select: () => query }) });
    const events = await new SupabaseMarketingRepository().listTaskEvents(taskId);
    expect(events.map((event) => event.eventType)).toEqual(rows.map((row) => row.event_type));
  });
});
