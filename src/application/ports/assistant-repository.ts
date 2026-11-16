export interface AssistantTurn {
  id: string;
  userId: string;
  requestKey: string;
  source: "WEB" | "TELEGRAM";
  userText: string;
  answerText: string | null;
  status: "PENDING" | "COMPLETE" | "FAILED";
  createdAt: string;
}

export interface AssistantRepository {
  claim(input: { userId: string; requestKey: string; source: AssistantTurn["source"]; text: string }): Promise<{ turn: AssistantTurn; fresh: boolean }>;
  listRecent(userId: string, limit: number): Promise<AssistantTurn[]>;
  finish(input: { turnId: string; userId: string; answer: string | null; inputTokens: number | null; outputTokens: number | null }): Promise<void>;
}
