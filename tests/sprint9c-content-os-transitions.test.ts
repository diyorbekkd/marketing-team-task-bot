import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canTransition } from "../src/domain/workflow";

const read = (path: string) => readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const code = (sql: string) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

const migration = read("migrations/20261014130332_content_os_task_transition_compatibility.sql");
const rollback = read("rollbacks/20261014130332_content_os_task_transition_compatibility.down.sql");
const nextPhase = read("migrations/20260909090000_next_product_phase.sql");

describe("Sprint 9C finalized Content OS transitions", () => {
  const sql = code(migration);

  it("replaces the RPC in place without widening its security boundary", () => {
    expect(sql).toContain("create or replace function public.transition_task_with_events(");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("set search_path = ''");
    expect(sql).not.toMatch(/\b(grant|revoke|security definer)\b/i);
    expect(sql).not.toMatch(/\b(create table|alter table|drop table)\b/i);
  });

  it("keeps the complete legacy matrix", () => {
    for (const transition of [
      "(v_old_status = 'ASSIGNED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))",
      "(v_old_status = 'IN_PROGRESS' and p_new_status in ('BLOCKED', 'REVIEW', 'CANCELLED'))",
      "(v_old_status = 'BLOCKED' and p_new_status in ('IN_PROGRESS', 'CANCELLED'))",
      "(v_old_status = 'REVIEW' and p_new_status in ('DONE', 'REVISION', 'CANCELLED'))",
      "(v_old_status = 'REVISION' and p_new_status in ('IN_PROGRESS', 'BLOCKED', 'REVIEW', 'CANCELLED'))",
      "(v_old_status in ('DONE', 'CANCELLED') and p_new_status = 'ASSIGNED')",
    ]) {
      expect(sql).toContain(transition);
    }
  });

  it("uses only the existence probe in the outer schema-absence condition", () => {
    const outerStart = sql.indexOf("if not v_allowed\n    and ((v_old_status");
    const nestedStart = sql.indexOf("if public.content_os_is_task(p_task_id)", outerStart);
    const outerCondition = sql.slice(outerStart, nestedStart);
    expect(outerCondition).toContain("to_regprocedure('public.content_os_find_revision_review(uuid, uuid)') is not null");
    expect(outerCondition.match(/content_os_/g)).toHaveLength(1);
  });

  it("delegates classification, review requirements, authorization, and completion to stable Content OS predicates", () => {
    for (const predicate of [
      "public.content_os_is_task(p_task_id)",
      "public.content_os_requires_review(p_task_id)",
      "public.content_os_task_type_code(p_task_id) = 'BLOG'",
      "public.content_os_find_revision_review(p_task_id, p_actor_id)",
      "public.content_os_revision_allowed(p_task_id, p_actor_id, v_review_task_id)",
      "public.content_os_is_source_blog_for_head_review(p_task_id, v_review_task_id)",
      "public.content_os_completion_allowed(p_task_id)",
    ]) {
      expect(sql).toContain(predicate);
    }
    expect(sql).not.toContain("v_task.creator_id");
    expect(sql).not.toMatch(/title\s+(like|ilike|~)/i);
    expect(sql).toContain("if v_allowed\n    and p_new_status = 'DONE'\n    and to_regprocedure('public.content_os_completion_allowed(uuid)') is not null then");
  });

  it("atomically parks and restores the same Head Review without creating tasks", () => {
    expect(sql).toContain("v_review_new_status := 'BLOCKED'");
    expect(sql).toContain("v_review_new_status := 'ASSIGNED'");
    expect(sql).toContain("Waiting for source Blog revision");
    expect(sql).toContain("from public.task_events e");
    expect(sql).toContain("e.metadata ? 'reviewTaskId'");
    expect(sql).toContain("for update;");
    expect(sql).toContain("'coupledContentOsTransition', true");
    expect(sql).not.toMatch(/insert into public\.tasks/i);
  });

  it("records exact cross-task provenance while retaining revision history and checklist gates", () => {
    expect(sql).toContain("jsonb_build_object('reviewTaskId', v_review_task_id)");
    expect(sql).toContain("jsonb_build_object(\n      'sourceTaskId', p_task_id");
    expect(sql).toContain("insert into public.task_revisions (task_id, requested_by, reason)");
    expect(sql.match(/posting checklist is incomplete/g)).toHaveLength(2);
    expect(sql).toContain("case when v_review_new_status = 'BLOCKED' then 'TASK_BLOCKED' else 'TASK_UNBLOCKED' end");
  });

  it("restores pre-Sprint behavior while retaining the non-retryable rejection code", () => {
    const start = nextPhase.indexOf("create or replace function public.transition_task_with_events(");
    const previous = nextPhase
      .slice(start, nextPhase.indexOf("create function public.toggle_posting_checklist_item"))
      .replaceAll("40001", "PT409")
      .trimEnd();
    expect(rollback).toContain(previous);
  });

  it("normalizes only manually raised business conflicts and keeps true 40001 failures distinct", () => {
    expect(sql).toContain("using errcode = 'PT409'");
    expect(sql).toContain("p.prosrc ~* 'errcode[[:space:]]*=[[:space:]]*''40001'''");
    expect(sql).toContain("pg_catalog.pg_get_functiondef(v_function.oid)");
    expect(sql).not.toContain("exception when serialization_failure");
  });

  it("does not expose these integration-only transitions through ordinary Task Bot actions", () => {
    expect(canTransition("DONE", "REQUEST_REVISION")).toBe(false);
    expect(canTransition("REVISION", "APPROVE")).toBe(false);
    expect(canTransition("IN_PROGRESS", "APPROVE")).toBe(false);
  });
});
