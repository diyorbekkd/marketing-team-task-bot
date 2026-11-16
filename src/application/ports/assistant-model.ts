import type { Task, User } from "@/domain/models";
import type { AssistantTurn } from "./assistant-repository";

export interface AssistantModel {
  isAvailable(): boolean;
  generate(input: {
    actor: User;
    question: string;
    history: AssistantTurn[];
    tasks: Task[];
    users: User[];
  }): Promise<{ answer: string; inputTokens: number | null; outputTokens: number | null }>;
}
