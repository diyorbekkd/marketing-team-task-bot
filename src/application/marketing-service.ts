import { CreateTaskInputSchema, isOverdue } from "@/domain/task";
import type { ActorContext, TeamRole } from "@/domain/permissions";
import { canApproveDeadlineRequest, isAssignee, isCreator, isHead } from "@/domain/permissions";
import type { DeadlineChangeRequest, Task, User } from "@/domain/models";
import { TaskActionInputSchema, canTransition, statusForAction } from "@/domain/workflow";
import type { MarketingRepository, TelegramIdentityInput } from "./ports/marketing-repository";
import { ApplicationError } from "./errors";
import { z } from "zod";

const DeadlineRequestInputSchema = z.object({
  requestedDeadline: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(2000),
});

export type TaskScope = "my" | "team" | "today" | "overdue" | "review";

function actorFromUser(user: User): ActorContext {
  return { userId: user.id, role: user.role };
}

function taskAccess(task: Task) {
  return { creatorId: task.creatorId, assigneeId: task.assigneeId };
}

export class MarketingService {
  constructor(private readonly repository: MarketingRepository) {}

  async onboardTelegram(identity: TelegramIdentityInput, expectedHeadTelegramUserId: string): Promise<User> {
    return this.repository.registerTelegramUser(identity, expectedHeadTelegramUserId);
  }

  async requireActorByTelegramId(telegramUserId: string): Promise<User> {
    const user = await this.repository.getUserByTelegramId(telegramUserId);
    if (!user?.isActive) {
      throw new ApplicationError("UNAUTHENTICATED", "This Telegram account is not an active team member.");
    }
    return user;
  }

  async requireActorById(userId: string): Promise<User> {
    const user = await this.repository.getUserById(userId);
    if (!user?.isActive) {
      throw new ApplicationError("UNAUTHENTICATED", "The user session is no longer active.");
    }
    return user;
  }

  async listUsers(actor: User): Promise<User[]> {
    const users = await this.repository.listUsers();
    return isHead(actorFromUser(actor)) ? users : users.filter((user) => user.isActive);
  }

  async activateUser(actor: User, userId: string, role: TeamRole): Promise<User> {
    if (!isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Only Head may activate team members.");
    }
    if (role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("INVALID_INPUT", "Head role transfer is outside the MVP activation flow.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "User not found.");
    }
    if (target.isActive) {
      throw new ApplicationError("CONFLICT", "This team member is already active.");
    }
    return this.repository.activateUser(userId, role);
  }

  async createTask(
    actor: User,
    input: unknown,
    sourceTelegramUpdateId?: number,
  ): Promise<Task> {
    const parsed = CreateTaskInputSchema.parse(input);
    const assignee = await this.repository.getUserById(parsed.assigneeId);
    if (!assignee?.isActive) {
      throw new ApplicationError("INVALID_INPUT", "Assignee must be an active team member.");
    }

    return this.repository.createTask({
      creatorId: actor.id,
      assigneeId: parsed.assigneeId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      deadline: parsed.deadline,
      sourceTelegramUpdateId,
    });
  }

  async createTaskForUsername(
    actor: User,
    input: Omit<z.input<typeof CreateTaskInputSchema>, "assigneeId"> & { assigneeUsername: string },
    sourceTelegramUpdateId?: number,
  ): Promise<{ task: Task; assignee: User }> {
    const assignee = await this.repository.findActiveUserByUsername(input.assigneeUsername);
    if (!assignee) {
      throw new ApplicationError("INVALID_INPUT", `No active teammate matches @${input.assigneeUsername}.`);
    }
    const task = await this.createTask(actor, {
      title: input.title,
      assigneeId: assignee.id,
      deadline: input.deadline,
      priority: input.priority,
      description: input.description,
    }, sourceTelegramUpdateId);
    return { task, assignee };
  }

  async listTasks(actor: User, scope: TaskScope = "my", now = new Date()): Promise<Task[]> {
    if (scope === "team" && !isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Only Head may view team-wide tasks.");
    }

    const allTasks = await this.repository.listTasks();
    const actorTasks = allTasks.filter((task) => task.assigneeId === actor.id || task.creatorId === actor.id);
    const visible = scope === "team" || (isHead(actorFromUser(actor)) && scope !== "my")
      ? allTasks
      : actorTasks;

    if (scope === "overdue") {
      return visible.filter((task) => isOverdue({ deadline: new Date(task.deadline), status: task.status }, now));
    }
    if (scope === "review") {
      return visible.filter((task) => task.status === "REVIEW");
    }
    if (scope === "today") {
      const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
      const year = tashkentNow.getUTCFullYear();
      const month = tashkentNow.getUTCMonth();
      const day = tashkentNow.getUTCDate();
      const start = Date.UTC(year, month, day) - 5 * 60 * 60 * 1000;
      const end = start + 24 * 60 * 60 * 1000;
      return visible.filter((task) => {
        const deadline = new Date(task.deadline).getTime();
        return deadline >= start && deadline < end;
      });
    }
    return visible;
  }

  async getTaskDetails(actor: User, taskId: string) {
    const task = await this.requireVisibleTask(actor, taskId);
    const events = await this.repository.listTaskEvents(taskId);
    const requests = (await this.repository.listDeadlineChangeRequests()).filter((request) => request.taskId === taskId);
    return { task, events, deadlineRequests: requests };
  }

  async performTaskAction(actor: User, taskId: string, input: unknown): Promise<Task> {
    const action = TaskActionInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    const actorContext = actorFromUser(actor);
    const access = taskAccess(task);

    if (!canTransition(task.status, action.action)) {
      throw new ApplicationError("CONFLICT", `${action.action} is not valid while task is ${task.status}.`);
    }

    const assigneeAction = ["ACCEPT", "BLOCK", "RESUME", "SUBMIT_REVIEW"].includes(action.action);
    const reviewerAction = ["APPROVE", "REQUEST_REVISION"].includes(action.action);
    if (assigneeAction && !isAssignee(actorContext, access)) {
      throw new ApplicationError("FORBIDDEN", "Only the assignee may perform this action.");
    }
    if (reviewerAction && !isHead(actorContext) && !isCreator(actorContext, access)) {
      throw new ApplicationError("FORBIDDEN", "Only the creator or Head may review this task.");
    }
    if (action.action === "CANCEL" && !isHead(actorContext) && !isCreator(actorContext, access)) {
      throw new ApplicationError("FORBIDDEN", "Only the creator or Head may cancel this task.");
    }
    if (action.action === "REOPEN" && !isHead(actorContext)) {
      throw new ApplicationError("FORBIDDEN", "Only Head may reopen a task.");
    }

    return this.repository.transitionTask({
      taskId,
      actorId: actor.id,
      newStatus: statusForAction(action.action),
      reason: action.reason,
    });
  }

  async requestDeadlineChange(actor: User, taskId: string, input: unknown): Promise<DeadlineChangeRequest> {
    const parsed = DeadlineRequestInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    if (!isAssignee(actorFromUser(actor), taskAccess(task))) {
      throw new ApplicationError("FORBIDDEN", "Only the assignee may request a deadline change.");
    }
    if (["DONE", "CANCELLED"].includes(task.status)) {
      throw new ApplicationError("CONFLICT", "A terminal task cannot request a new deadline.");
    }
    return this.repository.createDeadlineChangeRequest({
      taskId,
      requestedBy: actor.id,
      requestedDeadline: parsed.requestedDeadline,
      reason: parsed.reason,
    });
  }

  async resolveDeadlineChangeRequest(
    actor: User,
    requestId: string,
    approve: boolean,
    resolutionNote?: string,
  ): Promise<DeadlineChangeRequest> {
    const request = await this.repository.getDeadlineChangeRequest(requestId);
    if (!request) {
      throw new ApplicationError("NOT_FOUND", "Deadline request not found.");
    }
    const task = await this.repository.getTask(request.taskId);
    if (!task) {
      throw new ApplicationError("NOT_FOUND", "Task not found.");
    }
    if (!canApproveDeadlineRequest(actorFromUser(actor), taskAccess(task))) {
      throw new ApplicationError("FORBIDDEN", "Only the task creator or Head may resolve this request.");
    }
    if (request.status !== "PENDING") {
      throw new ApplicationError("CONFLICT", "Deadline request is already resolved.");
    }
    return this.repository.resolveDeadlineChangeRequest({
      requestId,
      resolvedBy: actor.id,
      approve,
      resolutionNote,
    });
  }

  private async requireVisibleTask(actor: User, taskId: string): Promise<Task> {
    const task = await this.repository.getTask(taskId);
    if (!task) {
      throw new ApplicationError("NOT_FOUND", "Task not found.");
    }
    if (!isHead(actorFromUser(actor)) && task.creatorId !== actor.id && task.assigneeId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "You cannot access this task.");
    }
    return task;
  }
}
