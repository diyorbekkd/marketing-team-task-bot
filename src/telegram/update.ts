import { z } from "zod";

const TelegramUserSchema = z
  .object({
    id: z.number().int().safe().positive(),
    is_bot: z.boolean(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
  })
  .passthrough();

const TelegramChatSchema = z
  .object({
    id: z.number().int().safe(),
    type: z.enum(["private", "group", "supergroup", "channel"]),
  })
  .passthrough();

const TelegramMessageSchema = z
  .object({
    message_id: z.number().int().nonnegative(),
    from: TelegramUserSchema.optional(),
    chat: TelegramChatSchema,
    text: z.string().optional(),
  })
  .passthrough();

const TelegramCallbackQuerySchema = z
  .object({
    id: z.string(),
    from: TelegramUserSchema,
    message: TelegramMessageSchema.optional(),
    data: z.string().max(64).optional(),
  })
  .passthrough();

export const TelegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: TelegramMessageSchema.optional(),
    callback_query: TelegramCallbackQuerySchema.optional(),
  })
  .passthrough();

export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export interface TelegramReply {
  readonly chatId: number;
  readonly text: string;
}

export function handleTelegramUpdate(update: TelegramUpdate): TelegramReply | null {
  const message = update.message;
  if (!message?.text) {
    return null;
  }

  const command = message.text.trim().split(/\s+/, 1)[0]?.split("@", 1)[0]?.toLowerCase();
  if (command !== "/start") {
    return null;
  }

  return {
    chatId: message.chat.id,
    text: "Marketing Team Task Bot is online. Team onboarding will be available in Sprint 1.",
  };
}
