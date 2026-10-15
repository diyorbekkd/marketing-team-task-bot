import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20261015121850_content_os_telegram_web_auth.sql", import.meta.url),
  "utf8",
);
const challengeTable = migration.match(/create table private\.content_os_login_challenges \([\s\S]*?\n\);/)?.[0] ?? "";
const sessionTable = migration.match(/create table private\.content_os_web_sessions \([\s\S]*?\n\);/)?.[0] ?? "";

describe("Sprint 10A Content OS Telegram authentication contract", () => {
  it("stores only fixed-length verifier and session proofs in private RLS tables", () => {
    expect(migration).toContain("create table private.content_os_login_challenges");
    expect(migration).toContain("create table private.content_os_web_sessions");
    expect(challengeTable).toContain("verifier_hash text not null check (verifier_hash ~ '^[0-9a-f]{64}$')");
    expect(sessionTable).toContain("token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')");
    expect(migration).toContain("alter table private.content_os_login_challenges enable row level security");
    expect(migration).toContain("alter table private.content_os_web_sessions enable row level security");
    expect(migration).toContain("from public, anon, authenticated, service_role");
  });

  it("pins ten-minute challenges and thirty-day server sessions", () => {
    expect(migration).toContain("statement_timestamp() + interval '10 minutes'");
    expect(migration).toContain("statement_timestamp() + interval '30 days'");
    expect(migration).toContain("expires_at <= created_at + interval '10 minutes'");
    expect(migration).toContain("expires_at <= created_at + interval '30 days'");
  });

  it("locks approval and redemption and consumes a challenge in the session transaction", () => {
    expect(migration).toContain("create function public.content_os_auth_approve_challenge");
    expect(migration).toContain("create function public.content_os_auth_redeem_challenge");
    expect(migration.match(/for update;/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("set status = 'CONSUMED', consumed_at = statement_timestamp()");
    expect(migration).toContain("private.constant_time_sha256_hex_equal");
  });

  it("validates against current active user state and current role", () => {
    expect(migration).toContain("create function public.content_os_auth_validate_session");
    expect(migration).toContain("join public.users u on u.id = s.user_id");
    expect(migration).toContain("and u.is_active");
    expect(migration).toContain("u.role");
    expect(sessionTable).not.toMatch(/\brole\b/);
  });

  it("revokes sessions and approved challenges when a user is deactivated", () => {
    expect(migration).toContain("users_revoke_content_os_auth_on_deactivation");
    expect(migration).toContain("where user_id = new.id and revoked_at is null");
    expect(migration).toContain("where approved_user_id = new.id and status = 'APPROVED'");
    expect(migration).toContain("when (old.is_active and not new.is_active)");
  });

  it("exposes only narrow service-role RPC execution", () => {
    for (const name of [
      "create_challenge(text)",
      "get_challenge_status(uuid)",
      "approve_challenge(uuid, bigint)",
      "cancel_challenge(uuid, bigint)",
      "redeem_challenge(uuid, text, text)",
      "validate_session(text)",
      "revoke_session(text)",
    ]) {
      expect(migration).toContain(`grant execute on function public.content_os_auth_${name} to service_role`);
    }
  });
});
