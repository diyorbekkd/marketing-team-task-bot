import "server-only";

import { z } from "zod";
import { ApplicationError } from "@/application/errors";
import type { AssistantRepository, AssistantTurn } from "@/application/ports/assistant-repository";
import { getSupabaseAdminClient } from "@/server/db/supabase";

const RowSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), request_key: z.string(),
  source: z.enum(["WEB", "TELEGRAM"]), user_text: z.string(), answer_text: z.string().nullable(),
  status: z.enum(["PENDING", "COMPLETE", "FAILED"]), created_at: z.string(),
});

function mapTurn(value: unknown): AssistantTurn {
  const row = RowSchema.parse(value);
  return { id: row.id, userId: row.user_id, requestKey: row.request_key,
    source: row.source, userText: row.user_text, answerText: row.answer_text,
    status: row.status, createdAt: row.created_at };
}

export class SupabaseAssistantRepository implements AssistantRepository {
  private get client() { return getSupabaseAdminClient(); }

  async claim(input: Parameters<AssistantRepository["claim"]>[0]) {
    const { data, error } = await this.client.rpc("claim_assistant_turn", {
      p_user_id: input.userId, p_request_key: input.requestKey,
      p_source: input.source, p_user_text: input.text,
    });
    if (error?.code === "P0001") throw new ApplicationError("INVALID_INPUT", "Bugungi AI suhbat limiti tugadi (30 ta). Ertaga yana yozishingiz mumkin.");
    if (error || !data) throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI suhbatni boshlab bo‘lmadi.");
    const parsed = z.object({ turn: z.unknown(), fresh: z.boolean() }).parse(data);
    return { turn: mapTurn(parsed.turn), fresh: parsed.fresh };
  }

  async listRecent(userId: string, limit: number) {
    const { data, error } = await this.client.from("assistant_turns").select("*")
      .eq("user_id", userId).eq("status", "COMPLETE")
      .order("created_at", { ascending: false }).limit(limit);
    if (error) throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI suhbat tarixini yuklab bo‘lmadi.");
    return (data ?? []).map(mapTurn).reverse();
  }

  async finish(input: Parameters<AssistantRepository["finish"]>[0]) {
    const { error } = await this.client.rpc("finish_assistant_turn", {
      p_turn_id: input.turnId, p_user_id: input.userId, p_answer_text: input.answer,
      p_input_tokens: input.inputTokens, p_output_tokens: input.outputTokens,
    });
    if (error) throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI javobini saqlab bo‘lmadi.");
  }
}
