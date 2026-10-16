import { describe, expect, it } from "vitest";
import { assertCloudflareStagingEnvironment } from "../src/server/cloudflare-staging";

const validEnvironment = {
  DEPLOYMENT_ENVIRONMENT: "staging",
  SUPABASE_PROJECT_REF: "yuznbaaoonyqonhiywkt",
  SUPABASE_URL: "https://yuznbaaoonyqonhiywkt.supabase.co",
  APP_URL: "https://ibox-task-bot-staging.example-account.workers.dev",
};

describe("Cloudflare staging guard", () => {
  it("accepts the staging workers.dev URL and local preview", () => {
    expect(() => assertCloudflareStagingEnvironment(validEnvironment)).not.toThrow();
    expect(() => assertCloudflareStagingEnvironment({
      ...validEnvironment,
      APP_URL: "http://127.0.0.1:8787",
    })).not.toThrow();
  });

  it("rejects the production Supabase project", () => {
    expect(() => assertCloudflareStagingEnvironment({
      ...validEnvironment,
      SUPABASE_PROJECT_REF: "cbjcclefgxrdyjwkjcpq",
      SUPABASE_URL: "https://cbjcclefgxrdyjwkjcpq.supabase.co",
    })).toThrow("approved staging Supabase project");
  });

  it("rejects production and non-Worker application URLs", () => {
    expect(() => assertCloudflareStagingEnvironment({
      ...validEnvironment,
      APP_URL: "https://marketing-team-task-bot.vercel.app",
    })).toThrow("staging workers.dev URL");
  });

  it("rejects a missing explicit staging marker", () => {
    expect(() => assertCloudflareStagingEnvironment({
      ...validEnvironment,
      DEPLOYMENT_ENVIRONMENT: "production",
    })).toThrow("DEPLOYMENT_ENVIRONMENT=staging");
  });
});
