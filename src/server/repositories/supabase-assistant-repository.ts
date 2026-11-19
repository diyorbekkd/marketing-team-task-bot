import "server-only";

import { z } from "zod";
import { ApplicationError } from "@/application/errors";
import type { AssistantRepository, AssistantTurn } from "@/application/ports/assistant-repository";
import { AssistantProposalSchema } from "@/application/assistant-action";
import { getSupabaseAdminClient } from "@/server/db/supabase";

const RowSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), request_key: z.string(),
  source: z.enum(["WEB", "TELEGRAM"]), user_text: z.string(), answer_text: z.string().nullable(),
  status: z.enum(["PENDING", "COMPLETE", "FAILED"]), created_at: z.string(),
  action_proposal: z.unknown().nullable(),
  action_status: z.enum(["PENDING", "CLAIMED", "DONE", "FAILED"]).nullable(),
  action_expires_at: z.string().nullable(),
  action_result: z.string().nullable(),
});

function mapTurn(value: unknown): AssistantTurn {
  const row = RowSchema.parse(value);
  return { id: row.id, userId: row.user_id, requestKey: row.request_key,
    source: row.source, userText: row.user_text, answerText: row.answer_text,
    status: row.status, createdAt: row.created_at,
    proposal: row.action_proposal ? AssistantProposalSchema.parse(row.action_proposal) : null,
    proposalStatus: row.action_status, proposalExpiresAt: row.action_expires_at,
    actionResult: row.action_result };
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

  async setProposal(input: Parameters<AssistantRepository["setProposal"]>[0]) {
    const { data, error } = await this.client.from("assistant_turns").update({
      action_proposal: input.proposal,
      action_status: input.proposal ? "PENDING" : null,
      action_expires_at: input.proposal ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
      action_result: null,
    }).eq("id", input.turnId).eq("user_id", input.userId).eq("status", "PENDING").select("id").single();
    if (error || !data) throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI amal taklifini saqlab bo‘lmadi.");
  }

  async claimAction(input: Parameters<AssistantRepository["claimAction"]>[0]) {
    const { data, error } = await this.client.rpc("claim_assistant_action", {
      p_turn_id: input.turnId, p_user_id: input.userId,
    });
    if (error?.code === "P0002") throw new ApplicationError("CONFLICT", "Taklif eskirgan yoki allaqachon bajarilmoqda.");
    if (error?.code === "42501") throw new ApplicationError("FORBIDDEN", "Faol hisob kerak.");
    if (error || !data) throw new ApplicationError("INTEGRATION_UNAVAILABLE", "Taklifni tasdiqlab bo‘lmadi.");
    const parsed = z.discriminatedUnion("fresh", [
      z.object({ fresh: z.literal(true), proposal: AssistantProposalSchema }),
      z.object({ fresh: z.literal(false), result: z.string() }),
    ]).parse(data);
    return parsed;
  }

  async finishAction(input: Parameters<AssistantRepository["finishAction"]>[0]) {
    const { error } = await this.client.rpc("finish_assistant_action", {
      p_turn_id: input.turnId, p_user_id: input.userId,
      p_result: input.result, p_success: input.success,
    });
    if (error) throw new ApplicationError("INTEGRATION_UNAVAILABLE", "AI amal natijasini saqlab bo‘lmadi.");
  }
}
