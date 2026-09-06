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
      SUPABASE_PUBLISHABLE_KEY: "public-placeholder",
      SUPABASE_SECRET_KEY: "server-placeholder",
      TELEGRAM_BOT_TOKEN: ["123456789", "abcdefghijklmnopqrstuvwxyz_ABCD12345"].join(":"),
      TELEGRAM_WEBHOOK_SECRET: "webhook-placeholder",
      TELEGRAM_GROUP_ID: "-1001234567890",
      HEAD_TELEGRAM_USER_ID: "123456789",
    };

    expect(getAppConfig(env).timezone).toBe("Asia/Tashkent");
    expect(getSupabaseConfig(env).secretKey).toBe("server-placeholder");
    expect(getTelegramConfig(env).webhookSecret).toBe("webhook-placeholder");
  });

  it("fails with the missing variable name but not secret values", () => {
    const env = {
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_WEBHOOK_SECRET: "do-not-print-this",
    };

    let thrown: unknown;
    try {
      getTelegramConfig(env);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConfigurationError);
    expect(String(thrown)).toContain("TELEGRAM_BOT_TOKEN");
    expect(String(thrown)).not.toContain("do-not-print-this");
  });

  it("supports legacy Supabase key names during migration", () => {
    const config = getSupabaseConfig({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "legacy-public-placeholder",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-server-placeholder",
    });

    expect(config.publishableKey).toBe("legacy-public-placeholder");
    expect(config.secretKey).toBe("legacy-server-placeholder");
  });
});
