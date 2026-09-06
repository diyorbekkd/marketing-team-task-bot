import type { TaskStatus } from "@/domain/task";
import type { TaskEventDraft } from "@/domain/task-events";

export interface AtomicTaskMutation {
  readonly taskId: string;
  readonly expectedStatus?: TaskStatus;
  readonly changes: Readonly<Record<string, unknown>>;
  readonly event: TaskEventDraft;
}

/**
 * Implementations must apply the state patch and insert the event in one
 * PostgreSQL transaction. Supabase implementations should call a narrow RPC,
 * not perform two independent Data API requests.
 */
export interface TaskMutationRepository {
  applyWithEvent(mutation: AtomicTaskMutation): Promise<void>;
}
