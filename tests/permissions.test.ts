import { describe, expect, it } from "vitest";
import {
  assertCanChangeDeadline,
  canChangeDeadline,
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
};

const assignee: ActorContext = {
  userId: "assignee-id",
  role: "SMM_MANAGER",
};

const creator: ActorContext = {
  userId: "creator-id",
  role: "CONTENT_MARKETER",
};

const head: ActorContext = {
  userId: "head-id",
  role: "HEAD_OF_MARKETING",
};

const unrelatedMember: ActorContext = {
  userId: "unrelated-id",
  role: "DIGITAL_MARKETER",
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

  it("allows an assignee to edit permitted content fields", () => {
    expect(canEditTask(assignee, task, "title")).toBe(true);
    expect(canEditTask(assignee, task, "description")).toBe(true);
    expect(canEditTask(assignee, task, "priority")).toBe(true);
    expect(canEditTask(assignee, task, "subtasks")).toBe(true);
    expect(canEditTask(assignee, task, "status")).toBe(true);
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

  it("denies a team member unrelated to the task", () => {
    expect(canEditTask(unrelatedMember, task, "title")).toBe(false);
    expect(canChangeDeadline(unrelatedMember, task)).toBe(false);
    expect(canReassignTask(unrelatedMember, task)).toBe(false);
    expect(canReviewTask(unrelatedMember, task)).toBe(false);
  });
});
