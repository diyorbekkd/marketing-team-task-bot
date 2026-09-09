import { CreateTaskInputSchema, isOverdue } from "@/domain/task";
import type { ActorContext, TeamRole } from "@/domain/permissions";
import { canApproveDeadlineRequest, isAssignee, isCreator, isHead } from "@/domain/permissions";
import type { DeadlineChangeRequest, Task, User } from "@/domain/models";
import { TaskActionInputSchema, canTransition, statusForAction } from "@/domain/workflow";
import type { MarketingRepository, TelegramIdentityInput } from "./ports/marketing-repository";
import type {
  AssignmentNotificationResult,
  NotificationDispatcher,
  WorkflowNotificationInput,
} from "./ports/notification-dispatcher";
import { ApplicationError } from "./errors";
import { z } from "zod";
import { nextOccurrence, RecurrenceInputSchema, RecurrenceUpdateSchema } from "@/domain/recurrence";
import { calculateAnalytics, isOpenTask, workloadMetrics } from "@/domain/reporting";

const DeactivationInputSchema = z.object({
  openTasksAction: z.enum(["REASSIGN", "CANCEL", "KEEP"]).default("KEEP"),
  reassignToUserId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (value.openTasksAction === "REASSIGN" && !value.reassignToUserId) {
    context.addIssue({ code: "custom", path: ["reassignToUserId"], message: "Choose who the open tasks go to." });
  }
});

const DeadlineRequestInputSchema = z.object({
  requestedDeadline: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(2000),
});

export type TaskScope = "my" | "team" | "today" | "overdue" | "review";

export interface TaskCreationResult {
  readonly task: Task;
  readonly assignee: User;
  readonly notification: AssignmentNotificationResult;
}

function actorFromUser(user: User): ActorContext {
  return { userId: user.id, role: user.role };
}

function taskAccess(task: Task) {
  return { creatorId: task.creatorId, assigneeId: task.assigneeId };
}

export class MarketingService {
  constructor(
    private readonly repository: MarketingRepository,
    private readonly notificationDispatcher: NotificationDispatcher,
  ) {}

  async onboardTelegram(identity: TelegramIdentityInput, expectedHeadTelegramUserId: string): Promise<User> {
    return this.repository.registerTelegramUser(identity, expectedHeadTelegramUserId);
  }

  async requireActorByTelegramId(telegramUserId: string): Promise<User> {
    const user = await this.repository.getUserByTelegramId(telegramUserId);
    if (!user?.isActive) {
      throw new ApplicationError("UNAUTHENTICATED", "Siz hozir aktiv marketing jamoasida emassiz. Head of Marketing bilan bog‘laning.");
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
    if (target.deactivatedAt) {
      throw new ApplicationError("CONFLICT", "This person was previously on the team — reactivate them instead of activating.");
    }
    return this.repository.activateUser({ userId, actorId: actor.id, role });
  }

  /**
   * Fixes a role picked incorrectly at onboarding. Head may correct anyone's
   * role; a team member may correct their own. The Head role itself is never
   * settable here — transferring Head is a deliberate, out-of-scope operation,
   * so neither a self-promotion nor a Head-to-Head reassignment can happen
   * through this path.
   */
  async updateUserRole(actor: User, userId: string, role: TeamRole): Promise<User> {
    if (role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("INVALID_INPUT", "Head role changes are outside this flow.");
    }
    const actingOnSelf = actor.id === userId;
    if (!isHead(actorFromUser(actor)) && !actingOnSelf) {
      throw new ApplicationError("FORBIDDEN", "Only Head may change another teammate's role.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "User not found.");
    }
    if (!target.isActive) {
      throw new ApplicationError("CONFLICT", "Pending users are assigned a role through activation.");
    }
    if (target.role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("FORBIDDEN", "Head's role cannot be changed through this flow.");
    }
    if (target.role === role) {
      return target;
    }
    return this.repository.updateUserRole({ userId, actorId: actor.id, role });
  }

  /**
   * Facts a Head needs before removing someone from the active team: how many
   * open tasks would otherwise be left pointing at a soon-to-be-inactive
   * assignee, and how many recurring definitions would auto-pause.
   */
  async getDeactivationPreview(actor: User, userId: string) {
    if (!isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Only Head may manage team membership.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "User not found.");
    }
    const [tasks, recurringDefinitions] = await Promise.all([
      this.repository.listTasks(),
      this.repository.listRecurringDefinitionsByAssignee(userId),
    ]);
    const openTasks = tasks.filter((task) => task.assigneeId === userId && isOpenTask(task));
    const historicalTaskCount = tasks.filter(
      (task) => (task.assigneeId === userId || task.creatorId === userId) && !isOpenTask(task),
    ).length;
    return {
      user: target,
      openTasks,
      historicalTaskCount,
      activeRecurringCount: recurringDefinitions.filter((definition) => definition.status === "ACTIVE").length,
    };
  }

  /**
   * Removes a team member from active duty without deleting them: historical
   * task ownership, audit events, and report history all remain valid because
   * nothing is deleted, only `isActive`/`deactivatedAt` flip. Open tasks are
   * handled first (reassign/cancel/keep, per the Head's explicit choice) and
   * only committed once that succeeds, so a failure partway through never
   * leaves the account already-deactivated with unresolved tasks. Active
   * recurring definitions for this assignee are auto-paused so the cron sweep
   * cannot keep generating tasks for someone no longer on the team.
   */
  async deactivateUser(actor: User, userId: string, input: unknown) {
    if (!isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Only Head may manage team membership.");
    }
    if (actor.id === userId) {
      throw new ApplicationError("FORBIDDEN", "You cannot remove yourself from the team.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "User not found.");
    }
    if (!target.isActive) {
      throw new ApplicationError("CONFLICT", "This team member is already inactive.");
    }
    if (target.role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("FORBIDDEN", "Head cannot be removed through this flow.");
    }
    const parsed = DeactivationInputSchema.parse(input);

    const tasks = await this.repository.listTasks();
    const openTasks = tasks.filter((task) => task.assigneeId === userId && isOpenTask(task));

    if (openTasks.length > 0 && parsed.openTasksAction === "REASSIGN") {
      const newAssignee = await this.repository.getUserById(parsed.reassignToUserId!);
      if (!newAssignee?.isActive) {
        throw new ApplicationError("INVALID_INPUT", "Reassignment target must be an active team member.");
      }
      if (newAssignee.id === userId) {
        throw new ApplicationError("INVALID_INPUT", "Choose a different teammate to reassign to.");
      }
      for (const task of openTasks) {
        const reassigned = await this.repository.reassignTask({ taskId: task.id, newAssigneeId: newAssignee.id, actorId: actor.id });
        try {
          await this.notificationDispatcher.notifyAssignment({ task: reassigned, creator: actor, assignee: newAssignee });
        } catch {
          console.warn(JSON.stringify({ event: "reassignment_notification_failed", taskId: task.id }));
        }
      }
    } else if (openTasks.length > 0 && parsed.openTasksAction === "CANCEL") {
      for (const task of openTasks) {
        await this.repository.transitionTask({
          taskId: task.id,
          actorId: actor.id,
          newStatus: "CANCELLED",
          reason: "Assignee removed from the team",
        });
      }
    }
    // "KEEP" (or no open tasks): nothing to do — the Head explicitly chose to
    // leave the historical assignment as-is.

    const definitions = await this.repository.listRecurringDefinitionsByAssignee(userId);
    for (const definition of definitions.filter((d) => d.status === "ACTIVE")) {
      await this.repository.updateRecurringDefinition({
        id: definition.id,
        status: "PAUSED",
        nextOccurrenceAt: definition.nextOccurrenceAt,
        pauseReason: "ASSIGNEE_DEACTIVATED",
      });
    }

    const updated = await this.repository.deactivateUser({ userId, actorId: actor.id });
    return { user: updated, openTasksHandled: openTasks.length, recurringPaused: definitions.filter((d) => d.status === "ACTIVE").length };
  }

  /**
   * Restores active access for a previously-deactivated member. Never creates
   * a new row — it flips the same account back on — so there is no duplicate
   * account risk. Does not touch recurring definitions that were auto-paused;
   * Head resumes those separately once they've confirmed the assignee (or a
   * replacement) is right.
   */
  async reactivateUser(actor: User, userId: string): Promise<User> {
    if (!isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Only Head may manage team membership.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "User not found.");
    }
    if (target.isActive) {
      throw new ApplicationError("CONFLICT", "This team member is already active.");
    }
    if (!target.deactivatedAt) {
      throw new ApplicationError("INVALID_INPUT", "This user was never an active member; activate them instead.");
    }
    return this.repository.reactivateUser({ userId, actorId: actor.id });
  }

  async createTask(
    actor: User,
    input: unknown,
    sourceTelegramUpdateId?: number,
  ): Promise<TaskCreationResult> {
    const parsed = CreateTaskInputSchema.parse(input);
    const assignee = await this.repository.getUserById(parsed.assigneeId);
    if (!assignee?.isActive) {
      throw new ApplicationError("INVALID_INPUT", "Assignee must be an active team member.");
    }

    const task = await this.repository.createTask({
      creatorId: actor.id,
      assigneeId: parsed.assigneeId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      deadline: parsed.deadline,
      sourceTelegramUpdateId,
    });

    let notification: AssignmentNotificationResult;
    try {
      notification = await this.notificationDispatcher.notifyAssignment({ task, creator: actor, assignee });
    } catch {
      notification = { status: "FAILED", reason: "DELIVERY_FAILED" };
    }

    const log = {
      event: notification.status === "SENT"
        ? "task_assignment_notification_sent"
        : "task_assignment_notification_failed",
      taskId: task.id,
      ...(notification.status === "FAILED" ? { reason: notification.reason } : {}),
    };
    if (notification.status === "SENT") console.info(JSON.stringify(log));
    else console.warn(JSON.stringify(log));

    return { task, assignee, notification };
  }

  async createTaskForUsername(
    actor: User,
    input: Omit<z.input<typeof CreateTaskInputSchema>, "assigneeId"> & { assigneeUsername: string },
    sourceTelegramUpdateId?: number,
  ): Promise<TaskCreationResult> {
    const assignee = await this.repository.findActiveUserByUsername(input.assigneeUsername);
    if (!assignee) {
      throw new ApplicationError("INVALID_INPUT", `No active teammate matches @${input.assigneeUsername}.`);
    }
    return this.createTask(actor, {
      title: input.title,
      assigneeId: assignee.id,
      deadline: input.deadline,
      priority: input.priority,
      description: input.description,
    }, sourceTelegramUpdateId);
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
    const [events, requests, postingChecklist, recurringDefinition] = await Promise.all([
      this.repository.listTaskEvents(taskId),
      this.repository.listDeadlineChangeRequests(),
      this.repository.getPostingChecklist(taskId),
      this.repository.getRecurringDefinitionForTask(taskId),
    ]);
    return {
      task,
      events,
      deadlineRequests: requests.filter((request) => request.taskId === taskId),
      postingChecklist,
      recurringDefinition,
    };
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

    if (action.action === "SUBMIT_REVIEW") {
      const checklist = await this.repository.getPostingChecklist(taskId);
      if (checklist && checklist.items.some((item) => !item.isCompleted)) {
        throw new ApplicationError("INVALID_INPUT", "Complete every posting checklist item before sending to review.");
      }
    }
    if (action.action === "CANCEL" && !isHead(actorContext) && !isCreator(actorContext, access)) {
      throw new ApplicationError("FORBIDDEN", "Only the creator or Head may cancel this task.");
    }
    if (action.action === "REOPEN" && !isHead(actorContext)) {
      throw new ApplicationError("FORBIDDEN", "Only Head may reopen a task.");
    }

    const transitionedTask = await this.repository.transitionTask({
      taskId,
      actorId: actor.id,
      newStatus: statusForAction(action.action),
      reason: action.reason,
    });

    if (action.action === "ACCEPT") {
      // The creator gets notified whenever their task is accepted, regardless of
      // whether the acceptance came from the Telegram bot or the Mini App — both
      // transports call this same method. Skip the notification when the creator
      // accepted their own self-assigned task; there is no one else to inform.
      if (task.creatorId !== actor.id) {
        await this.dispatchWorkflowNotification(
          { event: "TASK_ACCEPTED", task: transitionedTask, actor },
          [task.creatorId],
        );
      }
    } else if (action.action === "SUBMIT_REVIEW") {
      await this.dispatchWorkflowNotification(
        { event: "REVIEW_REQUESTED", task: transitionedTask, actor },
        [task.creatorId],
        true,
      );
    } else if (action.action === "APPROVE") {
      await this.dispatchWorkflowNotification(
        { event: "TASK_COMPLETED", task: transitionedTask, actor },
        [task.assigneeId],
      );
    } else if (action.action === "REQUEST_REVISION") {
      await this.dispatchWorkflowNotification(
        { event: "REVISION_REQUESTED", task: transitionedTask, actor, comment: action.reason },
        [task.assigneeId],
      );
    } else if (action.action === "BLOCK") {
      await this.dispatchWorkflowNotification(
        { event: "TASK_BLOCKED", task: transitionedTask, actor, comment: action.reason },
        [task.creatorId],
        true,
      );
    }

    return transitionedTask;
  }

  async togglePostingChecklistItem(actor: User, itemId: string) {
    const checklist = await this.repository.getPostingChecklistByItemId(itemId);
    if (!checklist) throw new ApplicationError("NOT_FOUND", "Posting checklist item not found.");
    const task = await this.requireVisibleTask(actor, checklist.taskId);
    if (task.assigneeId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Only the assignee may update the posting checklist.");
    }
    await this.repository.togglePostingChecklistItem({ itemId, actorId: actor.id });
    return this.repository.getPostingChecklist(checklist.taskId);
  }

  async createRecurrence(actor: User, taskId: string, input: unknown, now = new Date()) {
    const parsed = RecurrenceInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    if (!isHead(actorFromUser(actor)) && task.creatorId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Only the task creator or Head may make it recurring.");
    }
    if (await this.repository.getRecurringDefinitionForTask(taskId)) {
      throw new ApplicationError("CONFLICT", "This task already has a recurring definition.");
    }
    const assignee = await this.repository.getUserById(task.assigneeId);
    if (!assignee?.isActive) {
      throw new ApplicationError("INVALID_INPUT", "The current assignee is not an active team member; reassign the task first.");
    }
    const next = nextOccurrence(parsed, now);
    if (!next) throw new ApplicationError("INVALID_INPUT", "The recurrence end date leaves no future occurrence.");
    return this.repository.createRecurringDefinition({
      sourceTaskId: task.id,
      createdBy: actor.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeId: task.assigneeId,
      frequency: parsed.frequency,
      weekday: parsed.frequency === "WEEKLY" ? parsed.weekday ?? null : null,
      dayOfMonth: parsed.frequency === "MONTHLY" ? parsed.dayOfMonth ?? null : null,
      localTime: parsed.localTime,
      endsOn: parsed.endsOn ?? null,
      nextOccurrenceAt: next,
    });
  }

  async updateRecurrence(actor: User, definitionId: string, input: unknown, now = new Date()) {
    const parsed = RecurrenceUpdateSchema.parse(input);
    const definition = await this.repository.getRecurringDefinition(definitionId);
    if (!definition) throw new ApplicationError("NOT_FOUND", "Recurring definition not found.");
    if (!isHead(actorFromUser(actor)) && definition.createdBy !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Only the recurrence creator or Head may manage it.");
    }
    if (definition.status === "STOPPED") {
      throw new ApplicationError("CONFLICT", "A stopped recurrence cannot be changed or resumed.");
    }

    const frequency = parsed.frequency ?? definition.frequency;
    const weekday = frequency === "WEEKLY" ? parsed.weekday ?? definition.weekday : null;
    const dayOfMonth = frequency === "MONTHLY" ? parsed.dayOfMonth ?? definition.dayOfMonth : null;
    const localTime = parsed.localTime ?? definition.localTime;
    const endsOn = parsed.endsOn !== undefined ? parsed.endsOn : definition.endsOn;
    if (frequency === "WEEKLY" && weekday == null) {
      throw new ApplicationError("INVALID_INPUT", "Weekday is required for weekly recurrence.");
    }
    if (frequency === "MONTHLY" && dayOfMonth == null) {
      throw new ApplicationError("INVALID_INPUT", "Day of month is required for monthly recurrence.");
    }

    let assigneeId = definition.assigneeId;
    if (parsed.assigneeId !== undefined && parsed.assigneeId !== definition.assigneeId) {
      const newAssignee = await this.repository.getUserById(parsed.assigneeId);
      if (!newAssignee?.isActive) {
        throw new ApplicationError("INVALID_INPUT", "The new assignee must be an active team member.");
      }
      assigneeId = newAssignee.id;
    }

    const status = parsed.action === "PAUSE" ? "PAUSED"
      : parsed.action === "STOP" ? "STOPPED"
      : parsed.action === "RESUME" ? "ACTIVE"
      : definition.status;
    // A manual pause/resume/stop, or fixing the assignee that caused an
    // automatic pause, both clear the "why paused" marker — it only describes
    // an automatic pause that is still in effect.
    const pauseReason = (parsed.action || assigneeId !== definition.assigneeId) ? null : definition.pauseReason;
    const scheduleChanged = parsed.frequency !== undefined || parsed.weekday !== undefined
      || parsed.dayOfMonth !== undefined || parsed.localTime !== undefined || parsed.endsOn !== undefined;
    const next = status === "STOPPED" ? null
      : status === "PAUSED" ? definition.nextOccurrenceAt
      : (scheduleChanged || parsed.action === "RESUME")
          ? nextOccurrence({ frequency, weekday, dayOfMonth, localTime, endsOn }, now)
          : definition.nextOccurrenceAt;

    return this.repository.updateRecurringDefinition({
      id: definition.id, frequency, weekday, dayOfMonth, localTime, endsOn, status, nextOccurrenceAt: next,
      pauseReason, assigneeId,
    });
  }

  async generateDueRecurringTasks(now = new Date()) {
    const definitions = await this.repository.listDueRecurringDefinitions(now.toISOString());
    let generated = 0;
    let paused = 0;
    for (const definition of definitions) {
      // Defense in depth: deactivateUser() already auto-pauses a definition
      // the moment its assignee is removed, but this check means an inactive
      // assignee can never cause a new task to be generated even if that hook
      // was ever bypassed (a direct DB edit, a future code path, etc.).
      const assignee = await this.repository.getUserById(definition.assigneeId);
      if (!assignee?.isActive) {
        await this.repository.updateRecurringDefinition({
          id: definition.id, status: "PAUSED", nextOccurrenceAt: definition.nextOccurrenceAt, pauseReason: "ASSIGNEE_DEACTIVATED",
        });
        console.warn(JSON.stringify({ event: "recurring_definition_paused_inactive_assignee", definitionId: definition.id }));
        paused += 1;
        continue;
      }

      let scheduled = definition.nextOccurrenceAt;
      let iterations = 0;
      while (scheduled && new Date(scheduled).getTime() <= now.getTime() && iterations < 100) {
        const next = nextOccurrence(definition, new Date(scheduled));
        const task = await this.repository.generateRecurringOccurrence({
          definitionId: definition.id,
          scheduledOccurrenceAt: scheduled,
          nextOccurrenceAt: next,
        });
        if (!task) break;
        generated += 1;
        const creator = await this.repository.getUserById(task.creatorId);
        if (creator) {
          try {
            const notification = await this.notificationDispatcher.notifyAssignment({ task, creator, assignee });
            const log = {
              event: notification.status === "SENT"
                ? "recurring_assignment_notification_sent"
                : "recurring_assignment_notification_failed",
              taskId: task.id,
              definitionId: definition.id,
              ...(notification.status === "FAILED" ? { reason: notification.reason } : {}),
            };
            if (notification.status === "SENT") console.info(JSON.stringify(log));
            else console.warn(JSON.stringify(log));
          } catch {
            console.warn(JSON.stringify({
              event: "recurring_assignment_notification_failed",
              taskId: task.id,
              definitionId: definition.id,
              reason: "DISPATCH_THREW",
            }));
          }
        } else {
          console.warn(JSON.stringify({
            event: "recurring_assignment_notification_skipped",
            taskId: task.id,
            definitionId: definition.id,
            reason: "CREATOR_MISSING",
          }));
        }
        scheduled = next;
        iterations += 1;
      }
    }
    return { definitions: definitions.length, generated, paused };
  }

  async getAnalytics(actor: User, windowDays = 30, now = new Date()) {
    const days = z.number().int().min(1).max(365).parse(windowDays);
    const [tasks, events, requests, users] = await Promise.all([
      this.repository.listTasks(), this.repository.listAllTaskEvents(),
      this.repository.listDeadlineChangeRequests(), this.repository.listUsers(),
    ]);
    const isTeamView = isHead(actorFromUser(actor));
    const metrics = calculateAnalytics({
      tasks, events, deadlineRequests: requests, now, windowDays: days,
      userId: isTeamView ? undefined : actor.id,
    });
    const team = isTeamView
      ? users.filter((user) => user.isActive).map((user) => ({
          user,
          metrics: calculateAnalytics({
            tasks, events, deadlineRequests: requests, now, windowDays: days, userId: user.id,
          }),
          workload: workloadMetrics(tasks, now, user.id),
        }))
      : [];
    return { generatedAt: now.toISOString(), metrics, team };
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
    const deadlineRequest = await this.repository.createDeadlineChangeRequest({
      taskId,
      requestedBy: actor.id,
      requestedDeadline: parsed.requestedDeadline,
      reason: parsed.reason,
    });
    await this.dispatchWorkflowNotification(
      { event: "DEADLINE_CHANGE_REQUESTED", task, actor, deadlineRequest },
      [task.creatorId],
      true,
    );
    return deadlineRequest;
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
    const resolvedRequest = await this.repository.resolveDeadlineChangeRequest({
      requestId,
      resolvedBy: actor.id,
      approve,
      resolutionNote,
    });
    await this.dispatchWorkflowNotification(
      {
        event: approve ? "DEADLINE_CHANGE_APPROVED" : "DEADLINE_CHANGE_REJECTED",
        task,
        actor,
        deadlineRequest: resolvedRequest,
      },
      [request.requestedBy, task.assigneeId],
    );
    return resolvedRequest;
  }

  private async dispatchWorkflowNotification(
    notification: Omit<WorkflowNotificationInput, "recipients">,
    directRecipientIds: readonly string[],
    includeHeads = false,
  ): Promise<void> {
    try {
      const users = await this.repository.listUsers();
      const usersById = new Map(users.map((user) => [user.id, user]));
      const recipientIds = [...new Set(directRecipientIds)];
      const directRecipients = recipientIds.flatMap((id) => {
        const recipient = usersById.get(id);
        if (!recipient) {
          this.logWorkflowDelivery(notification, {
            status: "FAILED",
            recipientUserId: id,
            reason: "RECIPIENT_NOT_FOUND",
          });
          return [];
        }
        if (!recipient.isActive) {
          this.logWorkflowDelivery(notification, {
            status: "FAILED",
            recipientUserId: id,
            reason: "RECIPIENT_INACTIVE",
          });
          return [];
        }
        return [recipient];
      });
      const heads = includeHeads
        ? users.filter((user) => user.isActive && user.role === "HEAD_OF_MARKETING")
        : [];
      if (includeHeads && heads.length === 0) {
        this.logWorkflowDelivery(notification, {
          status: "FAILED",
          reason: "HEAD_NOT_FOUND",
        });
      }

      const recipients = [...directRecipients, ...heads];
      if (recipients.length === 0) return;

      let result;
      try {
        result = await this.notificationDispatcher.notifyWorkflow({ ...notification, recipients });
      } catch {
        const uniqueRecipients = new Map(recipients.map((recipient) => [
          /^\d+$/.test(recipient.telegramUserId) ? `telegram:${recipient.telegramUserId}` : `user:${recipient.id}`,
          recipient,
        ]));
        for (const recipient of uniqueRecipients.values()) {
          this.logWorkflowDelivery(notification, {
            status: "FAILED",
            recipientUserId: recipient.id,
            reason: "DISPATCH_FAILED",
          });
        }
        return;
      }

      for (const delivery of result.deliveries) {
        this.logWorkflowDelivery(notification, delivery);
      }
    } catch {
      this.logWorkflowDelivery(notification, {
        status: "FAILED",
        reason: "RECIPIENT_LOOKUP_FAILED",
      });
    }
  }

  private logWorkflowDelivery(
    notification: Omit<WorkflowNotificationInput, "recipients">,
    delivery: Readonly<{
      status: "SENT" | "FAILED";
      recipientUserId?: string;
      reason?: string;
    }>,
  ): void {
    const log = {
      event: delivery.status === "SENT" ? "workflow_notification_sent" : "workflow_notification_failed",
      workflowEvent: notification.event,
      taskId: notification.task.id,
      ...(delivery.recipientUserId ? { recipientUserId: delivery.recipientUserId } : {}),
      ...(delivery.reason ? { reason: delivery.reason } : {}),
    };
    if (delivery.status === "SENT") console.info(JSON.stringify(log));
    else console.warn(JSON.stringify(log));
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
