import type { AssistantProposal } from "../assistant-action";

export interface AssistantTurn {
  id: string;
  userId: string;
  requestKey: string;
  source: "WEB" | "TELEGRAM";
  userText: string;
  answerText: string | null;
  status: "PENDING" | "COMPLETE" | "FAILED";
  createdAt: string;
  proposal: AssistantProposal | null;
  proposalStatus: "PENDING" | "CLAIMED" | "DONE" | "FAILED" | null;
  proposalExpiresAt: string | null;
  actionResult: string | null;
}

export interface AssistantRepository {
  claim(input: { userId: string; requestKey: string; source: AssistantTurn["source"]; text: string }): Promise<{ turn: AssistantTurn; fresh: boolean }>;
  listRecent(userId: string, limit: number): Promise<AssistantTurn[]>;
  finish(input: { turnId: string; userId: string; answer: string | null; inputTokens: number | null; outputTokens: number | null }): Promise<void>;
  setProposal(input: { turnId: string; userId: string; proposal: AssistantProposal | null }): Promise<void>;
  claimAction(input: { turnId: string; userId: string }): Promise<
    { fresh: true; proposal: AssistantProposal } | { fresh: false; result: string }
  >;
  finishAction(input: { turnId: string; userId: string; result: string; success: boolean }): Promise<void>;
}
