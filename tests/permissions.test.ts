import { describe, expect, it } from "vitest";
import {
  assertCanChangeDeadline,
  canChangeDeadline,
  canArchiveTask,
  canCancelTask,
  canRequestDeadlineChange,
  canRequestReassign,
  canRestoreTask,
  canViewTask,
  canEditTask,
  canReassignTask,
  canReviewTask,
  PermissionDeniedError,
  type ActorContext,
  type TaskAccessContext,
} from "../src/domain/permissions";

const task: TaskAccessContext = {
  creatorId: "creator-id",
  assigneeId: "assignee-id",
  status: "IN_PROGRESS",
  isArchived: false,
};

const assignee: ActorContext = {
  userId: "assignee-id",
  role: "SMM_MANAGER",
  isActive: true,
};

const creator: ActorContext = {
  userId: "creator-id",
  role: "CONTENT_MARKETER",
  isActive: true,
};

const head: ActorContext = {
  userId: "head-id",
  role: "HEAD_OF_MARKETING",
  isActive: true,
};

const unrelatedMember: ActorContext = {
  userId: "unrelated-id",
  role: "DIGITAL_MARKETER",
  isActive: true,
};

describe("task permission foundation", () => {
  it("prevents an assignee from directly changing the deadline", () => {
    expect(canChangeDeadline(assignee, task)).toBe(false);
    expect(canEditTask(assignee, task, "deadline")).toBe(false);
    expect(() => assertCanChangeDeadline(assignee, task)).toThrow(PermissionDeniedError);
  });

  it("prevents an assignee from directly reassigning the task", () => {
    expect(canReassignTask(assignee, task)).toBe(false);
    expect(canEditTask(assignee, task, "assignee")).toBe(false);
  });

  it("keeps ordinary assignees on lifecycle/request paths rather than direct edits", () => {
    expect(canEditTask(assignee, task, "title")).toBe(false);
    expect(canRequestDeadlineChange(assignee, task)).toBe(true);
    expect(canRequestReassign(assignee, task)).toBe(true);
  });

  it("allows a creator to manage their own task", () => {
    expect(canChangeDeadline(creator, task)).toBe(true);
    expect(canReassignTask(creator, task)).toBe(true);
    expect(canReviewTask(creator, task)).toBe(true);
    expect(canEditTask(creator, task, "deadline")).toBe(true);
  });

  it("allows Head to manage any task", () => {
    expect(canChangeDeadline(head, task)).toBe(true);
    expect(canReassignTask(head, task)).toBe(true);
    expect(canReviewTask(head, task)).toBe(true);
    expect(canEditTask(head, task, "assignee")).toBe(true);
  });

  it("does not derive generic creator rights from Content OS creator_id", () => {
    const blog = { ...task, assigneeId: creator.userId, contentTaskTypeCode: "BLOG" };
    expect(canEditTask(creator, blog, "title")).toBe(false);
    expect(canChangeDeadline(creator, blog)).toBe(false);
    expect(canReassignTask(creator, blog)).toBe(false);
    expect(canReviewTask(creator, blog)).toBe(false);
    expect(canCancelTask(creator, blog)).toBe(false);
    expect(canRequestDeadlineChange(creator, blog)).toBe(true);
    expect(canRequestReassign(creator, blog)).toBe(true);
  });

  it("gives a Head Review authority only to its assignee and active Head", () => {
    const headReview = { ...task, contentTaskTypeCode: "HEAD_REVIEW" };
    expect(canReviewTask(creator, headReview)).toBe(false);
    expect(canReviewTask(assignee, headReview)).toBe(true);
    expect(canReviewTask(head, headReview)).toBe(true);
    expect(canReviewTask(unrelatedMember, headReview)).toBe(false);
  });

  it("denies a team member unrelated to the task", () => {
    expect(canViewTask(unrelatedMember, task)).toBe(true);
    expect(canEditTask(unrelatedMember, task, "title")).toBe(false);
    expect(canChangeDeadline(unrelatedMember, task)).toBe(false);
    expect(canReassignTask(unrelatedMember, task)).toBe(false);
    expect(canReviewTask(unrelatedMember, task)).toBe(false);
  });

  it("lets only active Head archive and view/restore archived tasks", () => {
    const archived = { ...task, isArchived: true };
    expect(canArchiveTask(head, task)).toBe(true);
    expect(canViewTask(creator, archived)).toBe(false);
    expect(canViewTask(head, archived)).toBe(true);
    expect(canRestoreTask(head, archived)).toBe(true);
    expect(canArchiveTask({ ...head, isActive: false }, task)).toBe(false);
  });
});
