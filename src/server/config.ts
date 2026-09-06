import { z } from "zod";

const requiredSecret = z.string().trim().min(1);
const telegramInteger = z.string().regex(/^-?\d+$/, "Must be a Telegram integer ID");
const positiveTelegramInteger = z.string().regex(/^\d+$/, "Must be a positive Telegram integer ID");

const AppConfigSchema = z.object({
  APP_URL: z.string().url(),
  APP_TIMEZONE: z.literal("Asia/Tashkent").default("Asia/Tashkent"),
});

const SupabaseConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: requiredSecret,
  SUPABASE_SERVICE_ROLE_KEY: requiredSecret,
});

const TelegramConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: requiredSecret,
  TELEGRAM_WEBHOOK_SECRET: requiredSecret,
  TELEGRAM_GROUP_ID: telegramInteger,
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
    anonKey: parsed.SUPABASE_ANON_KEY,
    serviceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
  } as const;
}

export function getTelegramConfig(env: Environment = process.env) {
  const parsed = parseConfig("Telegram", TelegramConfigSchema, env);
  return {
    botToken: parsed.TELEGRAM_BOT_TOKEN,
    webhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET,
    groupId: parsed.TELEGRAM_GROUP_ID,
    headTelegramUserId: parsed.HEAD_TELEGRAM_USER_ID,
  } as const;
}
