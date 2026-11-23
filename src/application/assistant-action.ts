import { z } from "zod";

const DateTime = z.iso.datetime({ offset: true });
export const AssistantActionSchema = z.union([
  z.object({ kind: z.enum(["CREATE_TASK"]), title: z.string().trim().min(1).max(200),
    assigneeId: z.uuid(), deadline: DateTime, priority: z.enum(["high", "normal", "low"]),
    description: z.string().trim().max(5000).nullable() }).strict(),
  z.object({ kind: z.enum(["CHANGE_STATUS"]), taskId: z.uuid(),
    action: z.enum(["ACCEPT", "BLOCK", "RESUME", "SUBMIT_REVIEW", "APPROVE",
      "REQUEST_REVISION", "CANCEL", "REOPEN"]),
    reason: z.string().trim().max(5000).nullable(), nextDeadline: DateTime.nullable() }).strict(),
  z.object({ kind: z.enum(["REQUEST_DEADLINE"]), taskId: z.uuid(),
    requestedDeadline: DateTime, reason: z.string().trim().min(1).max(5000) }).strict(),
  z.object({ kind: z.enum(["ADD_CHECKPOINT"]), taskId: z.uuid(),
    title: z.string().trim().min(1).max(200), dueAt: DateTime.nullable() }).strict(),
]);
export type AssistantAction = z.infer<typeof AssistantActionSchema>;

export const AssistantProposalSchema = z.object({
  action: AssistantActionSchema,
  summary: z.string().min(1).max(1000),
}).strict();
export type AssistantProposal = z.infer<typeof AssistantProposalSchema>;
