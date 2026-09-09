export const TEAM_ROLES = [
  "OPERATOR_VIDEO_EDITOR",
  "CONTENT_MARKETER",
  "DIGITAL_MARKETER",
  "SMM_MANAGER",
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
] as const satisfies readonly TeamRole[];

export interface ActorContext {
  readonly userId: string;
  readonly role: TeamRole;
}

export interface TaskAccessContext {
  readonly creatorId: string;
  readonly assigneeId: string;
}

export type EditableTaskField =
  | "title"
  | "description"
  | "priority"
  | "deadline"
  | "assignee"
  | "subtasks"
  | "status";

const ASSIGNEE_EDITABLE_FIELDS: ReadonlySet<EditableTaskField> = new Set([
  "title",
  "description",
  "priority",
  "subtasks",
  "status",
]);

export function isHead(actor: ActorContext): boolean {
  return actor.role === "HEAD_OF_MARKETING";
}

export function isCreator(actor: ActorContext, task: TaskAccessContext): boolean {
  return actor.userId === task.creatorId;
}

export function isAssignee(actor: ActorContext, task: TaskAccessContext): boolean {
  return actor.userId === task.assigneeId;
}

export function canEditTask(
  actor: ActorContext,
  task: TaskAccessContext,
  field: EditableTaskField,
): boolean {
  if (isHead(actor) || isCreator(actor, task)) {
    return true;
  }

  return isAssignee(actor, task) && ASSIGNEE_EDITABLE_FIELDS.has(field);
}

export function canChangeDeadline(actor: ActorContext, task: TaskAccessContext): boolean {
  return isHead(actor) || isCreator(actor, task);
}

export function canApproveDeadlineRequest(actor: ActorContext, task: TaskAccessContext): boolean {
  return isHead(actor) || isCreator(actor, task);
}

export function canReassignTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return isHead(actor) || isCreator(actor, task);
}

export function canReviewTask(actor: ActorContext, task: TaskAccessContext): boolean {
  return isHead(actor) || isCreator(actor, task);
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
    throw new PermissionDeniedError("Only the task creator or Head may directly change the deadline.");
  }
}
