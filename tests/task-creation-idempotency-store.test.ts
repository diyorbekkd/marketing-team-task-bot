import { describe, expect, it } from "vitest";
import { InMemoryTaskCreationIdempotencyStore } from "./stubs/in-memory-task-creation-idempotency-store";

describe("TaskCreationIdempotencyStore contract (exercised via the test-only in-memory stub)", () => {
  it("an unclaimed key has no existing task id", async () => {
    const store = new InMemoryTaskCreationIdempotencyStore();
    await expect(store.findExistingTaskId("key-1")).resolves.toBeNull();
  });

  it("claiming a key makes it resolvable afterward", async () => {
    const store = new InMemoryTaskCreationIdempotencyStore();
    await store.claim("key-1", "task-1");
    await expect(store.findExistingTaskId("key-1")).resolves.toBe("task-1");
  });

  it("claiming the same key twice fails -- first write wins, no silent double-claim", async () => {
    const store = new InMemoryTaskCreationIdempotencyStore();
    await store.claim("key-1", "task-1");
    await expect(store.claim("key-1", "task-2")).rejects.toThrow();
    await expect(store.findExistingTaskId("key-1")).resolves.toBe("task-1");
  });

  it("different keys are independent", async () => {
    const store = new InMemoryTaskCreationIdempotencyStore();
    await store.claim("key-a", "task-a");
    await store.claim("key-b", "task-b");
    await expect(store.findExistingTaskId("key-a")).resolves.toBe("task-a");
    await expect(store.findExistingTaskId("key-b")).resolves.toBe("task-b");
  });
});
