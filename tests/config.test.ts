import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  getAppConfig,
  getCronConfig,
  getSupabaseConfig,
  getTeamBootstrapConfig,
  getTelegramConfig,
  getVideoMediaTopicConfig,
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
      CRON_SECRET: "cron-secret-placeholder",
    };

    expect(getAppConfig(env).timezone).toBe("Asia/Tashkent");
    expect(getSupabaseConfig(env).secretKey).toBe("server-placeholder");
    expect(getTelegramConfig(env).webhookSecret).toBe("webhook-placeholder");
    expect(getTeamBootstrapConfig(env)).toEqual({
      groupId: "-1001234567890",
      headTelegramUserId: "123456789",
    });
    expect(getCronConfig(env).secret).toBe("cron-secret-placeholder");
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

  it("rejects a private chat ID as the configured marketing group", () => {
    expect(() => getTeamBootstrapConfig({
      TELEGRAM_GROUP_ID: "123456789",
      HEAD_TELEGRAM_USER_ID: "123456789",
    })).toThrow(ConfigurationError);
  });

  it("requires both video group and topic IDs or leaves the feature disabled", () => {
    expect(getVideoMediaTopicConfig({})).toBeNull();
    expect(getVideoMediaTopicConfig({ VIDEO_MEDIA_CHAT_ID: "-1001234567890", VIDEO_MEDIA_TOPIC_ID: "42" }))
      .toEqual({ chatId: "-1001234567890", topicId: 42 });
    expect(() => getVideoMediaTopicConfig({ VIDEO_MEDIA_CHAT_ID: "-1001234567890" }))
      .toThrow(ConfigurationError);
  });
});
