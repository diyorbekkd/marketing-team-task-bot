export const TEAM_ROLES = [
  "OPERATOR_VIDEO_EDITOR",
  "CONTENT_MARKETER",
  "DIGITAL_MARKETER",
  "SMM_MANAGER",
  "SEO_SPECIALIST",
  "HEAD_OF_MARKETING",
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];

/** Roles assignable through the activation/role-edit flows. Head is excluded on
 * purpose: transferring the Head role is a sensitive, out-of-band operation and
 * must never happen through the generic role-assignment surface. */
export const NON_HEAD_ROLES = [
  "OPERATOR_VIDEO_EDITOR",
  "CONTENT_MARKETER",
  "DIGITAL_MARKETER",
  "SMM_MANAGER",
  "SEO_SPECIALIST",
] as const satisfies readonly TeamRole[];

export interface ActorContext {
  readonly userId: string;
  readonly role: TeamRole;
  readonly isActive: boolean;
}

export interface TaskAccessContext {
  readonly creatorId: string;
  readonly assigneeId: string;
  readonly status: TaskStatus;
  readonly isArchived: boolean;
  /** Null/undefined means a manual Task Bot task. A stable Content OS Task
   * Type code means generic creator privileges must not apply. */
  readonly contentTaskTypeCode?: string | null;
  /** HEAD_REVIEW only: the immutable source Blog's current author/assignee.
   * Missing provenance fails closed for review decisions. */
  readonly sourceBlogAuthorId?: string | null;
}

export type EditableTaskField =
  | "title"
  | "description"
  | "priority"
  | "deadline"
  | "assignee"
  | "subtasks"
  | "status";

export function isHead(actor: ActorContext): boolean {
  return actor.isActive && actor.role === "HEAD_OF_MARKETING";
}

export function isCreator(actor: ActorContext, task: TaskAccessContext): boolean {
  return actor.isActive && actor.userId === task.creatorId;
}

export function isAssignee(actor: ActorContext, task: TaskAccessContext): boolean {
  return actor.isActive && actor.userId === task.assigneeId;
}

export function canViewTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return actor.isActive && (!task.isArchived || isHead(actor));
}

export function canEditTask(
  actor: ActorContext,
  task: TaskAccessContext,
  _field?: EditableTaskField,
): boolean {
  void _field;
  return canViewTask(actor, task)
    && !task.isArchived
    && (isHead(actor) || (!task.contentTaskTypeCode && isCreator(actor, task)));
}

export function canDirectChangeDeadline(actor: ActorContext, task: TaskAccessContext): boolean {
  return canEditTask(actor, task) && !["DONE", "CANCELLED"].includes(task.status);
}

export function canApproveDeadlineRequest(actor: ActorContext, task: TaskAccessContext): boolean {
  return canViewTask(actor, task) && !task.isArchived && isHead(actor);
}

export function canDirectReassign(actor: ActorContext, task: TaskAccessContext): boolean {
  return canEditTask(actor, task) && !["DONE", "CANCELLED"].includes(task.status);
}

export function canRequestDeadlineChange(actor: ActorContext, task: TaskAccessContext): boolean {
  return canViewTask(actor, task)
    && !task.isArchived
    && !["DONE", "CANCELLED"].includes(task.status)
    && isAssignee(actor, task)
    && (Boolean(task.contentTaskTypeCode) || !isCreator(actor, task))
    && !isHead(actor);
}

export function canRequestReassign(actor: ActorContext, task: TaskAccessContext): boolean {
  return canRequestDeadlineChange(actor, task);
}

export function canArchiveTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return actor.isActive && isHead(actor) && !task.isArchived;
}

export function canRestoreTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return actor.isActive && isHead(actor) && task.isArchived;
}

/** Compatibility names used by older call sites. */
export function canChangeDeadline(actor: ActorContext, task: TaskAccessContext): boolean {
  return canDirectChangeDeadline(actor, task);
}

export function canReassignTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return canDirectReassign(actor, task);
}

export function canApproveTask(actor: ActorContext, task: TaskAccessContext): boolean {
  if (!canViewTask(actor, task) || task.isArchived) return false;
  if (task.contentTaskTypeCode) {
    if (task.contentTaskTypeCode === "HEAD_REVIEW") {
      return Boolean(task.sourceBlogAuthorId)
        && actor.userId !== task.sourceBlogAuthorId
        && isAssignee(actor, task);
    }
    return isHead(actor);
  }
  return isHead(actor) || isCreator(actor, task);
}

export function canRequestRevision(actor: ActorContext, task: TaskAccessContext): boolean {
  if (!canViewTask(actor, task) || task.isArchived) return false;
  if (task.contentTaskTypeCode) {
    if (task.contentTaskTypeCode === "HEAD_REVIEW") {
      return Boolean(task.sourceBlogAuthorId)
        && actor.userId !== task.sourceBlogAuthorId
        && (isAssignee(actor, task) || isHead(actor));
    }
    return isHead(actor);
  }
  return isHead(actor) || isCreator(actor, task);
}

/** Compatibility name: a generic review check is approval authority. */
export function canReviewTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return canApproveTask(actor, task);
}

export function canCancelTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return canViewTask(actor, task)
    && !task.isArchived
    && (isHead(actor) || (!task.contentTaskTypeCode && isCreator(actor, task)));
}

export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";

  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

export function assertCanChangeDeadline(actor: ActorContext, task: TaskAccessContext): void {
  if (!canChangeDeadline(actor, task)) {
    throw new PermissionDeniedError("Only Head or the creator of a manual task may directly change the deadline.");
  }
}
import type { TaskStatus } from "./task";
