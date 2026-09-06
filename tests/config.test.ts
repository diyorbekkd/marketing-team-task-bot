import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  getAppConfig,
  getSupabaseConfig,
  getTelegramConfig,
} from "../src/server/config";

describe("configuration validation", () => {
  it("parses each server configuration boundary", () => {
    const env = {
      APP_URL: "https://tasks.example.com",
      APP_TIMEZONE: "Asia/Tashkent",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "public-placeholder",
      SUPABASE_SERVICE_ROLE_KEY: "server-placeholder",
      TELEGRAM_BOT_TOKEN: "bot-placeholder",
      TELEGRAM_WEBHOOK_SECRET: "webhook-placeholder",
      TELEGRAM_GROUP_ID: "-1001234567890",
      HEAD_TELEGRAM_USER_ID: "123456789",
    };

    expect(getAppConfig(env).timezone).toBe("Asia/Tashkent");
    expect(getSupabaseConfig(env).serviceRoleKey).toBe("server-placeholder");
    expect(getTelegramConfig(env).groupId).toBe("-1001234567890");
  });

  it("fails with the missing variable name but not secret values", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_WEBHOOK_SECRET: "do-not-print-this",
      TELEGRAM_GROUP_ID: "not-an-id",
      HEAD_TELEGRAM_USER_ID: "123",
    };

    let thrown: unknown;
    try {
      getTelegramConfig(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect(String(thrown)).toContain("TELEGRAM_BOT_TOKEN");
    expect(String(thrown)).toContain("TELEGRAM_GROUP_ID");
    expect(String(thrown)).not.toContain("do-not-print-this");
  });
});
