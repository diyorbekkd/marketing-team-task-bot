import type { Task, User } from "@/domain/models";
import type { AssistantTurn } from "./assistant-repository";
import type { AssistantAction } from "../assistant-action";

export interface AssistantModel {
  isAvailable(): boolean;
  generate(input: {
    actor: User;
    question: string;
    history: AssistantTurn[];
    tasks: Task[];
    users: User[];
  }): Promise<{ answer: string; action: AssistantAction | null;
    inputTokens: number | null; outputTokens: number | null }>;
}
