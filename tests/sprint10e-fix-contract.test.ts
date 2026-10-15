import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261015164349_sprint_10e_final_blocker_closure.sql",
    import.meta.url,
  ),
  "utf8",
);
const repository = readFileSync(
  new URL("../src/server/repositories/supabase-marketing-repository.ts", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/application/marketing-service.ts", import.meta.url),
  "utf8",
);

describe("Sprint 10E blocker-closure contract", () => {
  it("keeps inline assignment delivery constraint-valid and outside the event outbox", () => {
    expect(repository).toContain('sent_at: input.status === "SENT" ? completedAt : null');
    expect(migration).toContain("where d.task_event_id is not null");
    expect(migration).toContain("and d.event_type is not null");
    expect(migration).toContain("LEGACY_INLINE_DELIVERY_OUTCOME_UNKNOWN");
  });

  it("enforces independent reviewer assignment on creation and later reassignment", () => {
    expect(migration).toContain("a Blog author cannot review their own Blog");
    expect(migration).toContain("content_os_guard_single_head_review");
    expect(migration).toContain("tasks_enforce_content_os_review_assignment_independence");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("allows non-author Head revision supervision but assigned-reviewer-only approval", () => {
    expect(migration).toContain("only the independent reviewer or non-author Head may request revision");
    expect(migration).toContain("only the active assigned reviewer may approve a Head Review");
    expect(migration).toContain("content_os_request_head_review_revision");
    expect(service).toContain("canApproveTask(actorContext, reviewAccess)");
    expect(service).toContain("canRequestRevision(actorContext, reviewAccess)");
    expect(service).toContain("requestContentOsHeadReviewRevision");
    expect(service).not.toContain("headReviewHeadAction");
  });
});
