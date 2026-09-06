import { z } from "zod";

export const TASK_STATUSES = [
  "ASSIGNED",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "REVISION",
  "DONE",
  "CANCELLED",
] as const;

export const TASK_PRIORITIES = ["high", "normal", "low"] as const;

export const TaskStatusSchema = z.enum(TASK_STATUSES);
export const TaskPrioritySchema = z.enum(TASK_PRIORITIES);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const CreateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    assigneeId: z.string().uuid(),
    deadline: z.string().datetime({ offset: true }),
    priority: TaskPrioritySchema.default("normal"),
    description: z.string().trim().max(5000).optional(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export function isOverdue(
  task: Readonly<{ deadline: Date; status: TaskStatus }>,
  now: Date = new Date(),
): boolean {
  return task.deadline.getTime() < now.getTime() && task.status !== "DONE" && task.status !== "CANCELLED";
}
