import type { TaskCreationIdempotencyStore } from "../../src/application/ports/task-creation-idempotency-store";

/** Test-only in-memory implementation, used to exercise the
 * TaskCreationIdempotencyStore contract before Codex's real, DB-backed one
 * exists. Never imported by production code. */
export class InMemoryTaskCreationIdempotencyStore implements TaskCreationIdempotencyStore {
  private readonly claims = new Map<string, string>();

  async findExistingTaskId(idempotencyKey: string): Promise<string | null> {
    return this.claims.get(idempotencyKey) ?? null;
  }

  async claim(idempotencyKey: string, taskId: string): Promise<void> {
    if (this.claims.has(idempotencyKey)) {
      throw new Error(`Idempotency key "${idempotencyKey}" is already claimed.`);
    }
    this.claims.set(idempotencyKey, taskId);
  }
}
