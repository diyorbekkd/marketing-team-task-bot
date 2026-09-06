import { z } from "zod";
import type { TaskStatus } from "./task";

export const TASK_ACTIONS = [
  "ACCEPT",
  "BLOCK",
  "RESUME",
  "SUBMIT_REVIEW",
  "APPROVE",
  "REQUEST_REVISION",
  "CANCEL",
  "REOPEN",
] as const;

export const TaskActionSchema = z.enum(TASK_ACTIONS);
export type TaskAction = z.infer<typeof TaskActionSchema>;

export const TaskActionInputSchema = z
  .object({
    action: TaskActionSchema,
    reason: z.string().trim().max(5000).optional(),
  })
  .superRefine((input, context) => {
    if (input.action === "BLOCK" && !input.reason) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Blocked reason is required" });
    }
  });

const TRANSITIONS: Readonly<Record<TaskAction, readonly TaskStatus[]>> = {
  ACCEPT: ["ASSIGNED"],
  BLOCK: ["IN_PROGRESS", "REVISION"],
  RESUME: ["BLOCKED", "REVISION"],
  SUBMIT_REVIEW: ["IN_PROGRESS", "REVISION"],
  APPROVE: ["REVIEW"],
  REQUEST_REVISION: ["REVIEW"],
  CANCEL: ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION"],
  REOPEN: ["DONE", "CANCELLED"],
};

const TARGET_STATUS: Readonly<Record<TaskAction, TaskStatus>> = {
  ACCEPT: "IN_PROGRESS",
  BLOCK: "BLOCKED",
  RESUME: "IN_PROGRESS",
  SUBMIT_REVIEW: "REVIEW",
  APPROVE: "DONE",
  REQUEST_REVISION: "REVISION",
  CANCEL: "CANCELLED",
  REOPEN: "ASSIGNED",
};

export function canTransition(status: TaskStatus, action: TaskAction): boolean {
  return TRANSITIONS[action].includes(status);
}

export function statusForAction(action: TaskAction): TaskStatus {
  return TARGET_STATUS[action];
}
