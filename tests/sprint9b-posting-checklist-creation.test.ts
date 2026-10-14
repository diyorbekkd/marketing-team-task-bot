import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const code = (sql: string) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

const repair = code(read("migrations/20261014123341_repair_posting_checklist_creation.sql"));
const rollback = code(read("rollbacks/20261014123341_repair_posting_checklist_creation.down.sql"));
const hardening = code(read("migrations/20261014120100_harden_service_role_table_privileges.sql"));

describe("Sprint 9B #posting checklist creation repair", () => {
  it("replaces the helper in place without changing its security boundary", () => {
    expect(repair).toContain("create or replace function private.attach_posting_checklist(");
    expect(repair).toContain("p_created_at timestamptz default statement_timestamp()");
    expect(repair).toContain("set search_path = ''");
    expect(repair).not.toMatch(/security definer/i);
    expect(repair).not.toMatch(/\b(grant|revoke)\b/i);
  });

  it("resolves conflicts with INSERT plus SELECT and never updates task_checklists", () => {
    expect(repair).toContain("on conflict (task_id) do nothing");
    expect(repair).toContain("from public.task_checklists\n    where task_id = p_task_id");
    expect(repair).not.toMatch(/on conflict \(task_id\) do update/i);
    expect(repair).not.toMatch(/update\s+public\.task_checklists/i);
  });

  it("keeps checklist creation idempotent and preserves all four invariant items", () => {
    expect(repair).toContain("if v_checklist_id is null then");
    expect(repair).toContain("on conflict (checklist_id, position) do nothing");
    for (const item of ["Telegram", "Instagram", "YouTube", "X / Twitter"]) {
      expect(repair).toContain(`'${item}'`);
    }
  });

  it("keeps task_checklists at SELECT, INSERT in the hardened matrix", () => {
    expect(hardening).toMatch(/grant select, insert on table\s+[\s\S]*public\.task_checklists[\s\S]*to service_role;/);
    expect(hardening).not.toMatch(/grant select, insert, update[^;]*public\.task_checklists/i);
  });

  it("provides an exact behavioral rollback to the old update-requiring helper", () => {
    expect(rollback).toContain("on conflict (task_id) do update set task_id = excluded.task_id");
    expect(rollback).not.toMatch(/\b(grant|revoke)\b/i);
  });
});
