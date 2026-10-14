import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TeamRoleSchema } from "../src/domain/models";
import { NON_HEAD_ROLES, TEAM_ROLES } from "../src/domain/permissions";

const read = (path: string) => readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8");
/** SQL without `--` comment lines, so assertions only see executable text. */
const code = (sql: string) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

const seoMigration = read("migrations/20261014120000_seo_specialist_role.sql");
const seoRollback = read("rollbacks/20261014120000_seo_specialist_role.down.sql");

describe("A1 SEO_SPECIALIST role", () => {
  it("widens users_role_check only, keeping every existing role", () => {
    const sql = code(seoMigration);
    expect(sql).toContain("alter table public.users drop constraint users_role_check;");
    expect(sql).toContain("alter table public.users add constraint users_role_check check (");
    const listed = [...sql.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
    expect(new Set(listed)).toEqual(new Set(TEAM_ROLES));
    expect(sql).not.toMatch(/\b(update|delete|insert|truncate)\b/i);
  });

  it("keeps the app role lists in lockstep with the database CHECK", () => {
    expect(TEAM_ROLES).toEqual(["OPERATOR_VIDEO_EDITOR", "CONTENT_MARKETER", "DIGITAL_MARKETER", "SMM_MANAGER", "SEO_SPECIALIST", "HEAD_OF_MARKETING"]);
    expect(NON_HEAD_ROLES).toContain("SEO_SPECIALIST");
    expect(NON_HEAD_ROLES).toContain("SMM_MANAGER");
    expect(NON_HEAD_ROLES).not.toContain("HEAD_OF_MARKETING");
  });

  it("accepts every legacy role and SEO_SPECIALIST, rejects anything else", () => {
    for (const role of ["OPERATOR_VIDEO_EDITOR", "CONTENT_MARKETER", "DIGITAL_MARKETER", "SMM_MANAGER", "HEAD_OF_MARKETING", "SEO_SPECIALIST"]) {
      expect(TeamRoleSchema.safeParse(role).success).toBe(true);
    }
    for (const role of ["SEO", "seo_specialist", "ADMIN", ""]) {
      expect(TeamRoleSchema.safeParse(role).success).toBe(false);
    }
  });

  it("rolls back only when no user holds the new role (never rewrites data)", () => {
    expect(seoRollback).toContain("if exists (select 1 from public.users where role = 'SEO_SPECIALIST')");
    expect(seoRollback).toContain("raise exception");
    expect(code(seoRollback)).not.toContain("'SEO_SPECIALIST',");
  });
});
