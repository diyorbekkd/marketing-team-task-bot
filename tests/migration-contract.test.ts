import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260906151514_fast_track_mvp_core.sql", import.meta.url),
  "utf8",
);
const secureBootstrapMigration = readFileSync(
  new URL("../supabase/migrations/20260906162000_secure_head_bootstrap.sql", import.meta.url),
  "utf8",
);

describe("fast-track database workflow contract", () => {
  it("locks workflow rows and revalidates lifecycle transitions in the transaction", () => {
    expect(migration).toContain("where id = p_task_id\n  for update;");
    expect(migration).toContain("task status changed concurrently");
    expect(migration).toContain("v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED'");
  });

  it("keeps task state and audit events inside each transactional RPC", () => {
    expect(migration).toContain("create function public.create_task_with_event");
    expect(migration).toContain("create function public.transition_task_with_events");
    expect(migration).toContain("create function public.resolve_deadline_change_request_with_events");
    expect(migration).toContain("'TASK_CREATED'");
    expect(migration).toContain("'STATUS_CHANGED'");
    expect(migration).toContain("'DEADLINE_CHANGED'");
  });

  it("exposes workflow functions only to the trusted service role", () => {
    const functionCount = (migration.match(/create function public\./g) ?? []).length;
    const invokerCount = (migration.match(/security invoker/g) ?? []).length;
    const serviceGrantCount = (migration.match(/grant execute on function public\./g) ?? []).length;
    expect(functionCount).toBe(5);
    expect(invokerCount).toBe(functionCount);
    expect(serviceGrantCount).toBe(functionCount);
    expect(migration).toContain("from public, anon, authenticated");
  });
});

describe("secure Telegram Head bootstrap contract", () => {
  it("removes first-user privilege assignment and compares against the configured Head identity", () => {
    expect(secureBootstrapMigration).toContain("drop function public.register_telegram_user(bigint, text, text)");
    expect(secureBootstrapMigration).toContain("p_expected_head_telegram_user_id bigint");
    expect(secureBootstrapMigration).toContain("p_telegram_user_id = p_expected_head_telegram_user_id");
    expect(secureBootstrapMigration).toContain("else 'SMM_MANAGER' end");
    expect(secureBootstrapMigration).toContain("v_is_expected_head\n  )");
  });

  it("exposes the replacement onboarding function only to the trusted service role", () => {
    expect(secureBootstrapMigration).toContain(
      "revoke all on function public.register_telegram_user(bigint, text, text, bigint)\n  from public, anon, authenticated",
    );
    expect(secureBootstrapMigration).toContain(
      "grant execute on function public.register_telegram_user(bigint, text, text, bigint)\n  to service_role",
    );
  });
});
