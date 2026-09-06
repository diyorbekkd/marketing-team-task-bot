import "server-only";

import { z } from "zod";

const requiredSecret = z.string().trim().min(1);
const negativeTelegramInteger = z.string().regex(/^-\d+$/, "Must be a negative Telegram group ID");
const positiveTelegramInteger = z.string().regex(/^\d+$/, "Must be a positive Telegram integer ID");
const telegramBotToken = z
  .string()
  .regex(/^\d{6,12}:[A-Za-z0-9_-]{30,100}$/, "Must be a valid Telegram bot token");
const telegramWebhookSecret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,256}$/, "Must be 16-256 URL-safe characters");

const AppConfigSchema = z.object({
  APP_URL: z.string().url(),
  APP_TIMEZONE: z.literal("Asia/Tashkent").default("Asia/Tashkent"),
});

const SupabaseConfigSchema = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: requiredSecret.optional(),
    SUPABASE_SECRET_KEY: requiredSecret.optional(),
    SUPABASE_ANON_KEY: requiredSecret.optional(),
    SUPABASE_SERVICE_ROLE_KEY: requiredSecret.optional(),
  })
  .superRefine((value, context) => {
    if (!value.SUPABASE_PUBLISHABLE_KEY && !value.SUPABASE_ANON_KEY) {
      context.addIssue({
        code: "custom",
        path: ["SUPABASE_PUBLISHABLE_KEY"],
        message: "A publishable or legacy anon key is required",
      });
    }
    if (!value.SUPABASE_SECRET_KEY && !value.SUPABASE_SERVICE_ROLE_KEY) {
      context.addIssue({
        code: "custom",
        path: ["SUPABASE_SECRET_KEY"],
        message: "A secret or legacy service-role key is required",
      });
    }
  });

const TelegramConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: telegramBotToken,
  TELEGRAM_WEBHOOK_SECRET: telegramWebhookSecret,
});

const TeamBootstrapConfigSchema = z.object({
  TELEGRAM_GROUP_ID: negativeTelegramInteger,
  HEAD_TELEGRAM_USER_ID: positiveTelegramInteger,
});

export class ConfigurationError extends Error {
  readonly code = "INVALID_CONFIGURATION";

  constructor(scope: string, error: z.ZodError) {
    const details = error.issues
      .map((issue) => `${issue.path.join(".") || "configuration"}: ${issue.message}`)
      .join("; ");
    super(`Invalid ${scope} configuration: ${details}`);
    this.name = "ConfigurationError";
  }
}

type Environment = Record<string, string | undefined>;

function parseConfig<T extends z.ZodType>(scope: string, schema: T, env: Environment): z.infer<T> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new ConfigurationError(scope, result.error);
  }
  return result.data;
}

export function getAppConfig(env: Environment = process.env) {
  const parsed = parseConfig("application", AppConfigSchema, env);
  return {
    appUrl: parsed.APP_URL,
    timezone: parsed.APP_TIMEZONE,
  } as const;
}

export function getSupabaseConfig(env: Environment = process.env) {
  const parsed = parseConfig("Supabase", SupabaseConfigSchema, env);
  return {
    url: parsed.SUPABASE_URL,
    publishableKey: parsed.SUPABASE_PUBLISHABLE_KEY ?? parsed.SUPABASE_ANON_KEY!,
    secretKey: parsed.SUPABASE_SECRET_KEY ?? parsed.SUPABASE_SERVICE_ROLE_KEY!,
  } as const;
}

export function getTelegramConfig(env: Environment = process.env) {
  const parsed = parseConfig("Telegram", TelegramConfigSchema, env);
  return {
    botToken: parsed.TELEGRAM_BOT_TOKEN,
    webhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
  } as const;
}

export function getTeamBootstrapConfig(env: Environment = process.env) {
  const parsed = parseConfig("team bootstrap", TeamBootstrapConfigSchema, env);
  return {
    groupId: parsed.TELEGRAM_GROUP_ID,
    headTelegramUserId: parsed.HEAD_TELEGRAM_USER_ID,
  } as const;
}
