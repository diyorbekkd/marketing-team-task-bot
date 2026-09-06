import { z } from "zod";

export const TASK_EVENT_TYPES = [
  "TASK_CREATED",
  "TASK_ACCEPTED",
  "STATUS_CHANGED",
  "TITLE_CHANGED",
  "DESCRIPTION_CHANGED",
  "PRIORITY_CHANGED",
  "DEADLINE_CHANGE_REQUESTED",
  "DEADLINE_CHANGE_APPROVED",
  "DEADLINE_CHANGE_REJECTED",
  "DEADLINE_CHANGED",
  "REASSIGN_REQUESTED",
  "REASSIGN_APPROVED",
  "REASSIGN_REJECTED",
  "ASSIGNEE_CHANGED",
  "TASK_BLOCKED",
  "TASK_UNBLOCKED",
  "REVIEW_REQUESTED",
  "REVISION_REQUESTED",
  "TASK_COMPLETED",
  "TASK_CANCELLED",
  "TASK_REOPENED",
] as const;

export const TaskEventTypeSchema = z.enum(TASK_EVENT_TYPES);

const UserActorSchema = z.object({
  kind: z.literal("USER"),
  userId: z.string().uuid(),
});

const SystemActorSchema = z.object({
  kind: z.literal("SYSTEM"),
});

export const TaskEventDraftSchema = z
  .object({
    taskId: z.string().uuid(),
    actor: z.discriminatedUnion("kind", [UserActorSchema, SystemActorSchema]),
    type: TaskEventTypeSchema,
    oldValue: z.unknown().optional(),
    newValue: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export type TaskEventDraft = z.infer<typeof TaskEventDraftSchema>;

export function createTaskEvent(input: unknown): TaskEventDraft {
  return TaskEventDraftSchema.parse(input);
}
