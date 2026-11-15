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
  /** Set when this user was a previously-active member who was removed from the
   * team. Distinguishes "deactivated" from "never activated" — both have
   * isActive === false, but only a deactivated user has this set, and only a
   * deactivated user can be Reactivated (a never-activated user goes through
   * the ordinary Activate-with-role flow instead). */
  deactivatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const UserEventTypeSchema = z.enum([
  "USER_ACTIVATED",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
  "USER_ROLE_CHANGED",
]);

export const UserEventSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  eventType: UserEventTypeSchema,
  oldValue: z.unknown(),
  newValue: z.unknown(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});

export const PostingChecklistItemSchema = z.object({
  id: z.string().uuid(),
  checklistId: z.string().uuid(),
  label: z.string(),
  position: z.number().int().nonnegative(),
  isCompleted: z.boolean(),
  completedBy: z.string().uuid().nullable(),
  completedAt: z.string().nullable(),
});

export const PostingChecklistSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  kind: z.literal("POSTING"),
  createdAt: z.string(),
  items: z.array(PostingChecklistItemSchema),
});

export const UserTaskPlanSchema = z.object({
  userId: z.string().uuid(),
  taskId: z.string().uuid(),
  isImportant: z.boolean().nullable(),
  urgentOverride: z.boolean().nullable(),
  plannedOn: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const TaskCheckpointSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  title: z.string(),
  dueAt: z.string().nullable(),
  position: z.number().int().positive(),
  createdBy: z.string().uuid(),
  completedBy: z.string().uuid().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const RecurrenceFrequencySchema = z.enum(["WEEKDAYS", "WEEKLY", "MONTHLY"]);
export const RecurrenceStatusSchema = z.enum(["ACTIVE", "PAUSED", "STOPPED"]);

export const RecurringDefinitionSchema = z.object({
  id: z.string().uuid(),
  sourceTaskId: z.string().uuid(),
  createdBy: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  priority: TaskPrioritySchema,
  assigneeId: z.string().uuid(),
  frequency: RecurrenceFrequencySchema,
  weekday: z.number().int().min(1).max(7).nullable(),
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.literal("Asia/Tashkent"),
  endsOn: z.string().nullable(),
  status: RecurrenceStatusSchema,
  nextOccurrenceAt: z.string().nullable(),
  /** Set when the current PAUSED status was applied automatically (for example,
   * because the assignee was removed from the team) rather than by a Head
   * choosing to pause it. Cleared on resume/stop or a manual pause. */
  pauseReason: z.string().nullable(),
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
  publicationAt: z.string().nullable(),
  blockedReason: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  recurringDefinitionId: z.string().uuid().nullable().optional(),
  scheduledOccurrenceAt: z.string().nullable().optional(),
  workflowRunId: z.string().uuid().nullable().optional(),
  workflowStepId: z.string().uuid().nullable().optional(),
  participantIds: z.array(z.string().uuid()).optional(),
  workflowNextDeadline: z.string().nullable().optional(),
});

export const WorkflowTemplateStepSchema = z.object({
  id: z.string().uuid(),
  templateId: z.string().uuid(),
  position: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullable(),
  assigneeRole: TeamRoleSchema,
  priority: TaskPrioritySchema,
  dueAfterHours: z.number().int().positive(),
  estimatedMinutes: z.number().int().positive().nullable().default(null),
  checkpointTitles: z.array(z.string()).default([]),
});

export const WorkflowTemplateSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  isSystem: z.boolean(),
  steps: z.array(WorkflowTemplateStepSchema),
});

export interface WorkflowPlan {
  id: string;
  subject: string;
  templateName: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  currentPosition: number;
  steps: Array<{
    id: string;
    position: number;
    title: string;
    ownerId: string;
    participantIds: string[];
    estimatedMinutes: number | null;
    checkpointTitles: string[];
    taskId: string | null;
    taskStatus: string | null;
    deadline: string | null;
  }>;
}

export const TaskCommentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  authorId: z.string().uuid(),
  kind: z.enum(["COMMENT", "RESULT"]),
  body: z.string().nullable(),
  attachmentUrl: z.string().url().nullable(),
  createdAt: z.string(),
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
export type TaskComment = z.infer<typeof TaskCommentSchema>;
export type UserTaskPlan = z.infer<typeof UserTaskPlanSchema>;
export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;
export type DeadlineChangeRequest = z.infer<typeof DeadlineChangeRequestSchema>;
export type PostingChecklist = z.infer<typeof PostingChecklistSchema>;
export type PostingChecklistItem = z.infer<typeof PostingChecklistItemSchema>;
export type RecurringDefinition = z.infer<typeof RecurringDefinitionSchema>;
export type RecurrenceFrequency = z.infer<typeof RecurrenceFrequencySchema>;
export type RecurrenceStatus = z.infer<typeof RecurrenceStatusSchema>;
export type UserEvent = z.infer<typeof UserEventSchema>;
export type UserEventType = z.infer<typeof UserEventTypeSchema>;
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;
export type WorkflowTemplateStep = z.infer<typeof WorkflowTemplateStepSchema>;
