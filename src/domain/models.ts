import { z } from "zod";
import { TEAM_ROLES } from "./permissions";
import { TaskPrioritySchema, TaskStatusSchema } from "./task";
import { TaskEventTypeSchema } from "./task-events";

export const TeamRoleSchema = z.enum(TEAM_ROLES);

export const UserSchema = z.object({
  id: z.string().uuid(),
  telegramUserId: z.string().regex(/^\d+$/),
  telegramUsername: z.string().nullable(),
  displayName: z.string(),
  role: TeamRoleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  creatorId: z.string().uuid(),
  assigneeId: z.string().uuid(),
  deadline: z.string(),
  blockedReason: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TaskEventSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  actorKind: z.enum(["USER", "SYSTEM"]),
  eventType: TaskEventTypeSchema,
  oldValue: z.unknown(),
  newValue: z.unknown(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const DeadlineChangeRequestSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  currentDeadline: z.string(),
  requestedDeadline: z.string(),
  reason: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]),
  resolvedBy: z.string().uuid().nullable(),
  resolvedAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type User = z.infer<typeof UserSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskEvent = z.infer<typeof TaskEventSchema>;
export type DeadlineChangeRequest = z.infer<typeof DeadlineChangeRequestSchema>;
