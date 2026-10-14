import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8");
/** SQL without `--` comment lines, so assertions only see executable text. */
const code = (sql: string) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

const hardening = read("migrations/20261014120100_harden_service_role_table_privileges.sql");
const hardeningRollback = read("rollbacks/20261014120100_harden_service_role_table_privileges.down.sql");

const OPERATIONAL_TABLES = [
  "users", "tasks", "task_events", "deadline_change_requests", "reassign_requests", "task_revisions",
  "recurring_definitions", "task_checklists", "task_checklist_items", "report_deliveries", "user_events",
  "task_reminder_deliveries",
];

describe("A4 service_role least-privilege hardening", () => {
  const sql = code(hardening);

  it("revokes ALL from service_role on exactly the 12 operational tables", () => {
    const revoke = sql.slice(sql.indexOf("revoke all on table"), sql.indexOf("from service_role;") + "from service_role;".length);
    for (const table of OPERATIONAL_TABLES) expect(revoke).toContain(`public.${table}`);
    expect([...revoke.matchAll(/public\.\w+/g)]).toHaveLength(12);
  });

  it("grants back exactly the privileges the existing migrations intend", () => {
    const grants = [...sql.matchAll(/grant ([a-z, ]+) on table\s+([\s\S]*?)\s+to service_role;/g)].map((match) => ({
      privileges: match[1].trim(),
      tables: [...match[2].matchAll(/public\.(\w+)/g)].map((table) => table[1]).sort(),
    }));
    expect(grants).toEqual([
      { privileges: "select, insert, update, delete", tables: ["deadline_change_requests", "reassign_requests", "recurring_definitions", "tasks", "users"] },
      { privileges: "select, insert", tables: ["task_checklists", "task_events", "task_revisions", "user_events"] },
      { privileges: "select, insert, update", tables: ["report_deliveries", "task_checklist_items", "task_reminder_deliveries"] },
    ]);
    expect(sql).not.toMatch(/\b(truncate|references|trigger|maintain)\b/i);
  });

  it("leaves anon / authenticated / public grants and default privileges untouched", () => {
    expect(sql).not.toMatch(/\b(anon|authenticated)\b/);
    expect(sql).not.toMatch(/alter default privileges/i);
  });

  it("documents a privilege-only rollback to the observed live state", () => {
    expect(code(hardeningRollback)).toContain("grant truncate, references, trigger, maintain on table");
    expect(code(hardeningRollback)).not.toMatch(/\b(delete from|update public|drop)\b/i);
  });
});
