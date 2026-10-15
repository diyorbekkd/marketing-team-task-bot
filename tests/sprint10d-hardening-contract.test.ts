import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261015151900_sprint_10d_workflow_auth_notification_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL("../src/application/marketing-service.ts", import.meta.url),
  "utf8",
);
const telegram = readFileSync(
  new URL("../src/telegram/handler.ts", import.meta.url),
  "utf8",
);

describe("Sprint 10D workflow, auth, notification, and archive contract", () => {
  it("limits generic creator management to tasks without Content OS provenance", () => {
    expect(migration).toContain("create function private.task_uses_manual_creator_rights");
    expect(migration).toContain("select not exists (\n    select 1 from public.content_task_runtime");
    for (const rpc of [
      "update_task_content_with_events",
      "reassign_task_with_event",
      "change_task_deadline_with_event",
      "create_deadline_change_request_with_event",
      "create_reassign_request_with_event",
      "transition_task_with_events",
    ]) {
      expect(migration).toContain(`function public.${rpc}`);
    }
    expect(migration).toContain("only the Head Review assignee or Head may decide the review");
    expect(migration).toContain("only Head or the creator of a manual task may cancel");
  });

  it("makes Content OS Blog completion an atomic exactly-one Head Review operation", () => {
    expect(migration).toContain("create function public.content_os_complete_blog_with_head_review(");
    expect(migration).toContain("Content OS Blog completion requires the dedicated Head Review RPC");
    expect(migration).toContain("create trigger content_task_runtime_single_head_review");
    expect(migration).toContain("perform 1 from public.tasks where id = new.source_task_id for update");
    expect(migration).toContain("'head-review:' || p_blog_task_id::text");
    expect(migration).toContain("public.content_os_is_source_blog_for_head_review");
  });

  it("uses a six-digit display-only login code with bounded creation and cleanup", () => {
    expect(migration).toContain("check (display_code ~ '^[0-9]{6}$')");
    expect(migration).toContain("p_rate_key_hash text");
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toContain(") >= 5 then");
    expect(migration).toContain(") >= 3 then");
    expect(migration).toContain("content_os_auth_cleanup_challenges");
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("interval '7 days'");
    expect(telegram).toContain("Brauzerdagi kod bilan bir xil bo‘lsa tasdiqlang: ${displayCode}");
  });

  it("records durable notification intent and leases bounded retries", () => {
    expect(migration).toContain("'LEGACY_DELIVERY_STATE_NOT_RETRYABLE'");
    expect(migration).toContain("status = case when status = 'SENT' then 'SENT' else 'FAILED' end");
    expect(migration).toContain("task_events_enqueue_notification_outbox");
    expect(migration).toContain("create function public.claim_task_notification_outbox");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("attempts = d.attempts + 1");
    expect(migration).toContain("elsif v_delivery.attempts >= 5 then");
    expect(migration).toContain("when 1 then interval '1 minute'");
    expect(migration).toContain("when 2 then interval '5 minutes'");
    expect(migration).toContain("when 3 then interval '15 minutes'");
    expect(service).toContain("async deliverTaskNotificationOutbox");
    expect(service).toContain("Telegram has no idempotency key");
  });

  it("cancels pending requests during archive and guards active Blog/review pairs", () => {
    expect(migration).toContain("active Blog review cycle must finish before archiving the Blog");
    expect(migration).toContain("active Head Review cycle must finish before archiving the review");
    expect(migration).toContain("resolution_note = 'Task archived'");
    expect(migration).toContain("'DEADLINE_CHANGE_CANCELLED'");
    expect(migration).toContain("'REASSIGN_CANCELLED'");
    expect(migration).toContain("archived Blog cannot be completed");
  });
});
