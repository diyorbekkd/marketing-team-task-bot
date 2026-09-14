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
const usernameIntegrityMigration = readFileSync(
  new URL("../supabase/migrations/20260906163500_telegram_username_integrity.sql", import.meta.url),
  "utf8",
);
const nextPhaseMigration = readFileSync(
  new URL("../supabase/migrations/20260909090000_next_product_phase.sql", import.meta.url),
  "utf8",
);
const remindersMembershipMigration = readFileSync(
  new URL("../supabase/migrations/20260909200000_reminders_and_membership.sql", import.meta.url),
  "utf8",
);
const autostartMigration = readFileSync(
  new URL("../supabase/migrations/20260914090000_autostart_tasks.sql", import.meta.url),
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

describe("Telegram username integrity contract", () => {
  it("keeps active assignee lookup unambiguous when Telegram reassigns a username", () => {
    expect(usernameIntegrityMigration).toContain("create unique index users_telegram_username_unique_idx");
    expect(usernameIntegrityMigration).toContain("before insert or update of telegram_username");
    expect(usernameIntegrityMigration).toContain("set telegram_username = null");
    expect(usernameIntegrityMigration).toContain("old.telegram_username is distinct from new.telegram_username");
  });
});

describe("next product phase database contract", () => {
  it("locks down every new table and keeps report and occurrence delivery idempotent", () => {
    for (const table of ["recurring_definitions", "task_checklists", "task_checklist_items", "report_deliveries"]) {
      expect(nextPhaseMigration).toContain(`alter table public.${table} enable row level security`);
      expect(nextPhaseMigration).toContain(`revoke all on table public.${table} from public, anon, authenticated`);
    }
    expect(nextPhaseMigration).toContain("unique (report_type, interval_key, recipient_user_id)");
    expect(nextPhaseMigration).toContain("tasks_recurring_occurrence_unique_idx");
  });

  it("enforces posting completion and atomic recurring generation in PostgreSQL", () => {
    expect(nextPhaseMigration).toContain("posting checklist is incomplete");
    expect(nextPhaseMigration).toContain("create function public.toggle_posting_checklist_item");
    expect(nextPhaseMigration).toContain("create function public.generate_recurring_task");
    expect(nextPhaseMigration).toContain("for update;");
  });
});

describe("deadline reminders and team-membership database contract", () => {
  it("keeps membership state changes and their audit events atomic, and protects Head from self/other removal", () => {
    for (const fn of [
      "activate_user_with_event", "update_user_role_with_event", "deactivate_user_with_event",
      "reactivate_user_with_event", "reassign_task_with_event",
    ]) {
      expect(remindersMembershipMigration).toContain(`create function public.${fn}(`);
      expect(remindersMembershipMigration).toContain(`grant execute on function public.${fn}`);
    }
    expect(remindersMembershipMigration).toContain("cannot deactivate yourself");
    expect(remindersMembershipMigration).toContain("head cannot be deactivated through this flow");
    expect(remindersMembershipMigration).toContain("head role transfer is outside this flow");
  });

  it("distinguishes a never-activated pending user from a deactivated former member", () => {
    expect(remindersMembershipMigration).toContain("users_deactivated_at_matches_state");
    expect(remindersMembershipMigration).toContain("user was never an active member; use activation instead");
  });

  it("locks down the reminder ledger and keys idempotency by task, deadline, and reminder type", () => {
    expect(remindersMembershipMigration).toContain("alter table public.task_reminder_deliveries enable row level security");
    expect(remindersMembershipMigration).toContain("revoke all on table public.task_reminder_deliveries from public, anon, authenticated");
    expect(remindersMembershipMigration).toContain("unique (task_id, deadline, reminder_type)");
  });

  it("locks down the new user_events audit table", () => {
    expect(remindersMembershipMigration).toContain("alter table public.user_events enable row level security");
    expect(remindersMembershipMigration).toContain("revoke all on table public.user_events from public, anon, authenticated");
  });
});

describe("auto-start task creation database contract", () => {
  it("inserts new tasks directly as IN_PROGRESS through the one shared creation function", () => {
    expect(autostartMigration).toContain("create or replace function public.create_task_with_event_v2(");
    expect(autostartMigration).toContain("'IN_PROGRESS', p_creator_id, p_assignee_id,");
    expect(autostartMigration).not.toMatch(/values \([^)]*'ASSIGNED'/);
  });

  it("keeps idempotency on conflict, so a duplicated webhook delivery (including a bulk block) is a no-op", () => {
    expect(autostartMigration).toContain("on conflict do nothing");
    expect(autostartMigration).toContain("where source_telegram_update_id = p_source_telegram_update_id");
  });

  it("still attaches a posting checklist for a tagged task created through the auto-start path", () => {
    expect(autostartMigration).toContain("#posting");
    expect(autostartMigration).toContain("private.attach_posting_checklist(v_task.id)");
  });
});
