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
const productionIndexesMigration = readFileSync(
  new URL("../supabase/migrations/20261114160026_production_readiness_query_indexes.sql", import.meta.url),
  "utf8",
);
const collaborationMigration = readFileSync(
  new URL("../supabase/migrations/20261114160319_task_editing_collaboration.sql", import.meta.url),
  "utf8",
);
const notificationOutboxMigration = readFileSync(
  new URL("../supabase/migrations/20261114162328_reliable_notification_outbox.sql", import.meta.url),
  "utf8",
);
const workflowTemplatesMigration = readFileSync(
  new URL("../supabase/migrations/20261114163442_workflow_templates.sql", import.meta.url),
  "utf8",
);
const roleHardeningMigration = readFileSync(
  new URL("../supabase/migrations/20261114164700_role_authorization_hardening.sql", import.meta.url),
  "utf8",
);
const workflowEditorMigration = readFileSync(
  new URL("../supabase/migrations/20261115094125_versioned_workflow_template_editor.sql", import.meta.url),
  "utf8",
);
const botLinkLoginMigration = readFileSync(
  new URL("../supabase/migrations/20261115100316_bot_deeplink_web_login.sql", import.meta.url),
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

describe("production-readiness database contracts", () => {
  it("adds the indexes used by task pagination, visibility, deadlines, and request history", () => {
    for (const index of [
      "tasks_deadline_id_idx", "tasks_created_at_id_idx", "tasks_assignee_deadline_id_idx",
      "tasks_creator_deadline_id_idx", "tasks_priority_deadline_id_idx", "deadline_change_requests_task_created_at_idx",
    ]) expect(productionIndexesMigration).toContain(index);
  });

  it("keeps task editing, comments, and their audit events transactional and service-role-only", () => {
    expect(collaborationMigration).toContain("create function public.update_task_with_events");
    expect(collaborationMigration).toContain("create function public.add_task_comment_with_event");
    expect(collaborationMigration).toContain("alter table public.task_comments enable row level security");
    expect(collaborationMigration).toContain("revoke all on table public.task_comments from public, anon, authenticated");
    expect(collaborationMigration).toContain("grant execute on function public.update_task_with_events");
  });

  it("bounds retries, uses skip-locked claims, and reconciles successful report retries", () => {
    expect(notificationOutboxMigration).toContain("attempt_count between 0 and 5");
    expect(notificationOutboxMigration).toContain("for update skip locked");
    expect(notificationOutboxMigration).toContain("report.report_type = split_part(delivery.dedupe_key, ':', 2)");
    expect(notificationOutboxMigration).toContain("alter table public.notification_outbox enable row level security");
    expect(notificationOutboxMigration).toContain("revoke all on table public.notification_outbox from public, anon, authenticated");
  });

  it("creates sequential reusable workflows with atomic task/event creation and recovery", () => {
    expect(workflowTemplatesMigration).toContain("create function public.start_workflow_run");
    expect(workflowTemplatesMigration).toContain("create function public.advance_workflow_run");
    expect(workflowTemplatesMigration).toContain("create function public.recover_workflow_runs");
    expect(workflowTemplatesMigration).toContain("on conflict (workflow_run_id, workflow_step_id)");
    expect(workflowTemplatesMigration).toContain("POSTING_CHECKLIST_CREATED");
    for (const table of ["workflow_templates", "workflow_template_steps", "workflow_runs"]) {
      expect(workflowTemplatesMigration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(workflowTemplatesMigration).toContain(
      "revoke all on table public.workflow_templates, public.workflow_template_steps, public.workflow_runs from public, anon, authenticated",
    );
  });

  it("rechecks Head authorization inside the role-change transaction", () => {
    expect(roleHardeningMigration).toContain("role = 'HEAD_OF_MARKETING' and is_active");
    expect(roleHardeningMigration).toContain("only active Head may change team roles");
    expect(roleHardeningMigration).toContain("head role transfer is outside this flow");
    expect(roleHardeningMigration).toContain("revoke all on function public.update_user_role_with_event");
  });

  it("versions edited workflow templates without changing historical steps", () => {
    expect(workflowEditorMigration).toContain("create function public.save_workflow_template_version");
    expect(workflowEditorMigration).toContain("role = 'HEAD_OF_MARKETING' and is_active");
    expect(workflowEditorMigration).toContain("update public.workflow_templates set is_active = false");
    expect(workflowEditorMigration).not.toContain("update public.workflow_template_steps");
    expect(workflowEditorMigration).toContain("revoke all on function public.save_workflow_template_version");
  });

  it("stores only one-time login token hashes behind service-role access", () => {
    expect(botLinkLoginMigration).toContain("browser_hash text not null unique");
    expect(botLinkLoginMigration).toContain("code_hash text not null unique");
    expect(botLinkLoginMigration).toContain("alter table public.web_login_challenges enable row level security");
    expect(botLinkLoginMigration).toContain("revoke all on table public.web_login_challenges from public, anon, authenticated");
  });
});
