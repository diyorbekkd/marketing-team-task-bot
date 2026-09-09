import { describe, expect, it, vi } from "vitest";
import { MarketingService } from "../src/application/marketing-service";
import type {
  NotificationDispatcher,
  WorkflowNotificationInput,
} from "../src/application/ports/notification-dispatcher";
import type { MarketingRepository } from "../src/application/ports/marketing-repository";
import type { DeadlineChangeRequest, Task, User } from "../src/domain/models";

const ids = {
  head: "10000000-0000-4000-8000-000000000001",
  creator: "10000000-0000-4000-8000-000000000002",
  assignee: "10000000-0000-4000-8000-000000000003",
  unrelated: "10000000-0000-4000-8000-000000000004",
  task: "20000000-0000-4000-8000-000000000001",
  request: "30000000-0000-4000-8000-000000000001",
} as const;

function user(id: string, role: User["role"]): User {
  return {
    id,
    telegramUserId: id === ids.head ? "1001" : id === ids.creator ? "1002" : id === ids.assignee ? "1003" : "1004",
    telegramUsername: null,
    displayName: role,
    role,
    isActive: true,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
  };
}

const head = user(ids.head, "HEAD_OF_MARKETING");
const creator = user(ids.creator, "CONTENT_MARKETER");
const assignee = user(ids.assignee, "SMM_MANAGER");
const unrelated = user(ids.unrelated, "DIGITAL_MARKETER");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: ids.task,
    title: "Launch campaign",
    description: null,
    priority: "normal",
    status: "ASSIGNED",
    creatorId: ids.creator,
    assigneeId: ids.assignee,
    deadline: "2026-09-08T13:00:00.000Z",
    blockedReason: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

function deadlineRequest(overrides: Partial<DeadlineChangeRequest> = {}): DeadlineChangeRequest {
  return {
    id: ids.request,
    taskId: ids.task,
    requestedBy: ids.assignee,
    currentDeadline: "2026-09-08T13:00:00.000Z",
    requestedDeadline: "2026-09-09T13:00:00.000Z",
    reason: "Waiting for approved assets",
    status: "PENDING",
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: "2026-09-06T12:00:00.000Z",
    updatedAt: "2026-09-06T12:00:00.000Z",
    ...overrides,
  };
}

function repository(overrides: Partial<MarketingRepository> = {}): MarketingRepository {
  return {
    registerTelegramUser: vi.fn(),
    getUserById: vi.fn(async (id) => [head, creator, assignee, unrelated].find((candidate) => candidate.id === id) ?? null),
    getUserByTelegramId: vi.fn(),
    findActiveUserByUsername: vi.fn(),
    listUsers: vi.fn(async () => [head, creator, assignee, unrelated]),
    activateUser: vi.fn(),
    updateUserRole: vi.fn(async (userId, role) => {
      const found = [head, creator, assignee, unrelated].find((candidate) => candidate.id === userId);
      return { ...(found ?? assignee), role };
    }),
    createTask: vi.fn(),
    getTask: vi.fn(async () => task()),
    listTasks: vi.fn(async () => [task()]),
    transitionTask: vi.fn(async (input) => task({ status: input.newStatus })),
    listTaskEvents: vi.fn(async () => []),
    listAllTaskEvents: vi.fn(async () => []),
    getPostingChecklist: vi.fn(async () => null),
    getPostingChecklistByItemId: vi.fn(async () => null),
    togglePostingChecklistItem: vi.fn(),
    createDeadlineChangeRequest: vi.fn(async () => deadlineRequest()),
    getDeadlineChangeRequest: vi.fn(async () => deadlineRequest()),
    listDeadlineChangeRequests: vi.fn(async () => []),
    resolveDeadlineChangeRequest: vi.fn(async (input) => deadlineRequest({
      status: input.approve ? "APPROVED" : "REJECTED",
      resolvedBy: input.resolvedBy,
      resolvedAt: "2026-09-06T13:00:00.000Z",
    })),
    getRecurringDefinitionForTask: vi.fn(async () => null),
    getRecurringDefinition: vi.fn(async () => null),
    listDueRecurringDefinitions: vi.fn(async () => []),
    createRecurringDefinition: vi.fn(),
    updateRecurringDefinition: vi.fn(),
    generateRecurringOccurrence: vi.fn(async () => null),
    claimReportDelivery: vi.fn(async () => true),
    completeReportDelivery: vi.fn(async () => undefined),
    ...overrides,
  };
}

function notifier(overrides: Partial<NotificationDispatcher> = {}): NotificationDispatcher {
  return {
    notifyAssignment: vi.fn(async () => ({ status: "SENT" as const })),
    notifyWorkflow: vi.fn(async ({ recipients }: WorkflowNotificationInput) => ({
      deliveries: recipients.map((recipient) => ({
        recipientUserId: recipient.id,
        status: "SENT" as const,
      })),
    })),
    ...overrides,
  };
}

describe("MarketingService MVP permissions", () => {
  it("passes the configured Head identity through the onboarding boundary", async () => {
    const repo = repository({ registerTelegramUser: vi.fn(async () => head) });
    const service = new MarketingService(repo, notifier());
    const identity = {
      telegramUserId: "1001",
      telegramUsername: "lead",
      displayName: "Team Lead",
    };

    await expect(service.onboardTelegram(identity, "1001")).resolves.toEqual(head);
    expect(repo.registerTelegramUser).toHaveBeenCalledWith(identity, "1001");
  });

  it("allows only the assignee to accept and block a task", async () => {
    const repo = repository();
    const service = new MarketingService(repo, notifier());

    await expect(service.performTaskAction(creator, ids.task, { action: "ACCEPT" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.performTaskAction(assignee, ids.task, { action: "ACCEPT" });

    expect(repo.transitionTask).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ids.assignee,
      newStatus: "IN_PROGRESS",
    }));
  });

  it("allows either the creator or Head to complete a reviewed task", async () => {
    const reviewed = task({ status: "REVIEW" });
    for (const reviewer of [creator, head]) {
      const repo = repository({ getTask: vi.fn(async () => reviewed) });
      await new MarketingService(repo, notifier()).performTaskAction(reviewer, ids.task, { action: "APPROVE" });
      expect(repo.transitionTask).toHaveBeenCalledWith(expect.objectContaining({ newStatus: "DONE" }));
    }
  });

  it("preserves cancellation as a terminal state unless Head reopens it", async () => {
    const cancelled = task({ status: "CANCELLED", cancelledAt: "2026-09-06T13:00:00.000Z" });
    const repo = repository({ getTask: vi.fn(async () => cancelled) });
    const service = new MarketingService(repo, notifier());

    await expect(service.performTaskAction(creator, ids.task, { action: "ACCEPT" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.performTaskAction(creator, ids.task, { action: "REOPEN" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.performTaskAction(head, ids.task, { action: "REOPEN" });
  });

  it("denies team-wide task data to a normal employee", async () => {
    const service = new MarketingService(repository(), notifier());
    await expect(service.listTasks(assignee, "team")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.listTasks(head, "team")).resolves.toHaveLength(1);
  });

  it("keeps Head's My Tasks personal while team filters remain team-wide", async () => {
    const repo = repository({
      listTasks: vi.fn(async () => [
        task({ id: ids.task, creatorId: ids.head }),
        task({ id: "20000000-0000-4000-8000-000000000002" }),
      ]),
    });
    const service = new MarketingService(repo, notifier());

    await expect(service.listTasks(head, "my")).resolves.toHaveLength(1);
    await expect(service.listTasks(head, "team")).resolves.toHaveLength(2);
  });

  it("activates only pending employees and does not allow Head transfer", async () => {
    const pending = { ...unrelated, isActive: false };
    const repo = repository({ getUserById: vi.fn(async () => pending) });
    const service = new MarketingService(repo, notifier());

    await expect(service.activateUser(assignee, pending.id, "DIGITAL_MARKETER")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.activateUser(head, pending.id, "HEAD_OF_MARKETING")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await service.activateUser(head, pending.id, "DIGITAL_MARKETER");
    expect(repo.activateUser).toHaveBeenCalledWith(pending.id, "DIGITAL_MARKETER");
  });

  it("derives Today and Overdue views in Asia/Tashkent without an OVERDUE status", async () => {
    const repo = repository({
      listTasks: vi.fn(async () => [
        task({ id: ids.task, deadline: "2026-09-06T18:00:00.000Z", status: "BLOCKED", blockedReason: "Dependency" }),
        task({ id: "20000000-0000-4000-8000-000000000002", deadline: "2026-09-07T18:00:00.000Z" }),
      ]),
    });
    const service = new MarketingService(repo, notifier());
    const now = new Date("2026-09-06T20:00:00.000Z");

    await expect(service.listTasks(assignee, "overdue", now)).resolves.toHaveLength(1);
    await expect(service.listTasks(assignee, "today", now)).resolves.toHaveLength(1);
  });

  it("permits only the assignee to request a deadline change", async () => {
    const repo = repository({ getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })) });
    const notifications = notifier();
    const service = new MarketingService(repo, notifications);
    const input = { requestedDeadline: "2026-09-09T13:00:00.000Z", reason: "Assets are late" };

    await expect(service.requestDeadlineChange(creator, ids.task, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.requestDeadlineChange(assignee, ids.task, input);
    expect(repo.createDeadlineChangeRequest).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: ids.assignee }));
    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "DEADLINE_CHANGE_REQUESTED",
      recipients: expect.arrayContaining([creator, head]),
    }));
  });

  it("allows only creator or Head to resolve a pending deadline request", async () => {
    const repo = repository();
    const notifications = notifier();
    const service = new MarketingService(repo, notifications);

    await expect(service.resolveDeadlineChangeRequest(unrelated, ids.request, true)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await service.resolveDeadlineChangeRequest(creator, ids.request, true);
    await service.resolveDeadlineChangeRequest(head, ids.request, false);
    expect(repo.resolveDeadlineChangeRequest).toHaveBeenCalledTimes(2);
    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "DEADLINE_CHANGE_APPROVED",
      recipients: [assignee],
    }));
    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "DEADLINE_CHANGE_REJECTED",
      recipients: [assignee],
    }));
  });

  it("dispatches review, completion, revision, and blocked notifications from the shared workflow", async () => {
    const notifications = notifier();

    await new MarketingService(repository({
      getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })),
    }), notifications).performTaskAction(assignee, ids.task, { action: "SUBMIT_REVIEW" });

    await new MarketingService(repository({
      getTask: vi.fn(async () => task({ status: "REVIEW" })),
    }), notifications).performTaskAction(creator, ids.task, { action: "APPROVE" });

    await new MarketingService(repository({
      getTask: vi.fn(async () => task({ status: "REVIEW" })),
    }), notifications).performTaskAction(creator, ids.task, {
      action: "REQUEST_REVISION",
      reason: "Use the approved copy",
    });

    await new MarketingService(repository({
      getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })),
    }), notifications).performTaskAction(assignee, ids.task, {
      action: "BLOCK",
      reason: "Waiting for assets",
    });

    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "REVIEW_REQUESTED",
      recipients: expect.arrayContaining([creator, head]),
    }));
    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "TASK_COMPLETED",
      recipients: [assignee],
    }));
    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "REVISION_REQUESTED",
      comment: "Use the approved copy",
      recipients: [assignee],
    }));
    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "TASK_BLOCKED",
      comment: "Waiting for assets",
      recipients: expect.arrayContaining([creator, head]),
    }));
  });

  it("excludes a deactivated direct recipient from workflow notifications", async () => {
    const inactiveCreator = { ...creator, isActive: false };
    const notifications = notifier();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await new MarketingService(repository({
      listUsers: vi.fn(async () => [head, inactiveCreator, assignee, unrelated]),
      getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })),
    }), notifications).performTaskAction(assignee, ids.task, { action: "SUBMIT_REVIEW" });

    expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      event: "REVIEW_REQUESTED",
      recipients: [head],
    }));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"RECIPIENT_INACTIVE"'));
    warning.mockRestore();
  });

  it("preserves a completed workflow mutation when notification dispatch fails", async () => {
    const repo = repository({ getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })) });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const notifications = notifier({
      notifyWorkflow: vi.fn(async () => { throw new Error("delivery failed"); }),
    });
    const service = new MarketingService(repo, notifications);

    await expect(service.performTaskAction(assignee, ids.task, { action: "SUBMIT_REVIEW" }))
      .resolves.toMatchObject({ status: "REVIEW" });
    expect(repo.transitionTask).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"event":"workflow_notification_failed"'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"workflowEvent":"REVIEW_REQUESTED"'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"reason":"DISPATCH_FAILED"'));
    warning.mockRestore();
  });

  it("rejects a request already resolved before invoking the transactional repository", async () => {
    const repo = repository({ getDeadlineChangeRequest: vi.fn(async () => deadlineRequest({ status: "APPROVED" })) });
    const service = new MarketingService(repo, notifier());

    await expect(service.resolveDeadlineChangeRequest(creator, ids.request, true)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(repo.resolveDeadlineChangeRequest).not.toHaveBeenCalled();
  });

  it("uses the shared assignment notifier after persisting a task", async () => {
    const created = task();
    const repo = repository({ createTask: vi.fn(async () => created) });
    const assignmentNotifier = notifier();
    const service = new MarketingService(repo, assignmentNotifier);

    const result = await service.createTask(creator, {
      title: created.title,
      assigneeId: assignee.id,
      deadline: created.deadline,
      priority: created.priority,
    });

    expect(result).toEqual({ task: created, assignee, notification: { status: "SENT" } });
    expect(assignmentNotifier.notifyAssignment).toHaveBeenCalledWith({ task: created, creator, assignee });
  });

  it("resolves positional assignees before persistence and preserves assignment notification delivery", async () => {
    const created = task();
    const repo = repository({
      findActiveUserByUsername: vi.fn(async () => assignee),
      createTask: vi.fn(async () => created),
    });
    const notifications = notifier();
    const service = new MarketingService(repo, notifications);

    await service.createTaskForUsername(creator, {
      title: created.title,
      assigneeUsername: "misbahmarketing",
      deadline: created.deadline,
      priority: "normal",
    }, 18);

    expect(repo.findActiveUserByUsername).toHaveBeenCalledWith("misbahmarketing");
    expect(repo.createTask).toHaveBeenCalledTimes(1);
    expect(notifications.notifyAssignment).toHaveBeenCalledWith({ task: created, creator, assignee });
  });

  it("does not persist or notify when a positional assignee is unknown", async () => {
    const repo = repository({ findActiveUserByUsername: vi.fn(async () => null) });
    const notifications = notifier();
    const service = new MarketingService(repo, notifications);

    await expect(service.createTaskForUsername(creator, {
      title: "Yangi creative",
      assigneeUsername: "unknownuser",
      deadline: "2026-09-08T13:00:00.000Z",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(repo.createTask).not.toHaveBeenCalled();
    expect(notifications.notifyAssignment).not.toHaveBeenCalled();
  });

  it("keeps the persisted task result when assignment delivery fails", async () => {
    const created = task();
    const repo = repository({ createTask: vi.fn(async () => created) });
    const assignmentNotifier = notifier({
      notifyAssignment: vi.fn(async () => { throw new Error("delivery failed"); }),
    });
    const service = new MarketingService(repo, assignmentNotifier);

    const result = await service.createTask(creator, {
      title: created.title,
      assigneeId: assignee.id,
      deadline: created.deadline,
    });

    expect(result.task).toEqual(created);
    expect(result.notification).toEqual({ status: "FAILED", reason: "DELIVERY_FAILED" });
    expect(repo.createTask).toHaveBeenCalledTimes(1);
  });

  describe("accept notifies the creator", () => {
    it("notifies the creator through the shared workflow when the assignee accepts", async () => {
      const repo = repository({ getTask: vi.fn(async () => task({ status: "ASSIGNED" })) });
      const notifications = notifier();
      const service = new MarketingService(repo, notifications);

      const result = await service.performTaskAction(assignee, ids.task, { action: "ACCEPT" });

      expect(result.status).toBe("IN_PROGRESS");
      expect(repo.transitionTask).toHaveBeenCalledWith(expect.objectContaining({
        actorId: ids.assignee,
        newStatus: "IN_PROGRESS",
      }));
      expect(notifications.notifyWorkflow).toHaveBeenCalledWith(expect.objectContaining({
        event: "TASK_ACCEPTED",
        recipients: [creator],
      }));
    });

    it("this is the same code path Telegram and the Mini App both call, so both transports notify identically", async () => {
      // There is exactly one acceptance workflow (MarketingService.performTaskAction).
      // Neither the Telegram handler nor the Mini App route implements acceptance
      // notification on its own — both call this method, so this single test
      // stands in for "accept via Mini App" and "accept via Telegram" alike.
      const repo = repository({ getTask: vi.fn(async () => task({ status: "ASSIGNED" })) });
      const notifications = notifier();
      await new MarketingService(repo, notifications).performTaskAction(assignee, ids.task, { action: "ACCEPT" });
      expect(notifications.notifyWorkflow).toHaveBeenCalledTimes(1);
    });

    it("does not notify anyone when the creator accepts their own self-assigned task", async () => {
      const selfTask = task({ creatorId: ids.assignee, assigneeId: ids.assignee, status: "ASSIGNED" });
      const repo = repository({ getTask: vi.fn(async () => selfTask) });
      const notifications = notifier();
      const service = new MarketingService(repo, notifications);

      await service.performTaskAction(assignee, ids.task, { action: "ACCEPT" });

      expect(notifications.notifyWorkflow).not.toHaveBeenCalled();
    });

    it("rejects a duplicate accept once the task is already in progress, sending no second notification", async () => {
      const notifications = notifier();
      let currentStatus: "ASSIGNED" | "IN_PROGRESS" = "ASSIGNED";
      const repo = repository({
        getTask: vi.fn(async () => task({ status: currentStatus })),
        transitionTask: vi.fn(async (input) => {
          currentStatus = "IN_PROGRESS";
          return task({ status: input.newStatus });
        }),
      });
      const service = new MarketingService(repo, notifications);

      await service.performTaskAction(assignee, ids.task, { action: "ACCEPT" });
      await expect(service.performTaskAction(assignee, ids.task, { action: "ACCEPT" }))
        .rejects.toMatchObject({ code: "CONFLICT" });

      expect(repo.transitionTask).toHaveBeenCalledTimes(1);
      expect(notifications.notifyWorkflow).toHaveBeenCalledTimes(1);
    });

    it("keeps the accepted task state even if the creator notification fails to send", async () => {
      const repo = repository({ getTask: vi.fn(async () => task({ status: "ASSIGNED" })) });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const notifications = notifier({
        notifyWorkflow: vi.fn(async () => { throw new Error("delivery failed"); }),
      });
      const service = new MarketingService(repo, notifications);

      await expect(service.performTaskAction(assignee, ids.task, { action: "ACCEPT" }))
        .resolves.toMatchObject({ status: "IN_PROGRESS" });
      expect(repo.transitionTask).toHaveBeenCalledTimes(1);
      warning.mockRestore();
    });
  });

  describe("role can be corrected later", () => {
    it("lets Head correct another team member's role", async () => {
      const repo = repository();
      const service = new MarketingService(repo, notifier());

      const updated = await service.updateUserRole(head, ids.assignee, "DIGITAL_MARKETER");

      expect(repo.updateUserRole).toHaveBeenCalledWith(ids.assignee, "DIGITAL_MARKETER");
      expect(updated.role).toBe("DIGITAL_MARKETER");
    });

    it("lets a team member correct their own mis-set role", async () => {
      const repo = repository();
      const service = new MarketingService(repo, notifier());

      await service.updateUserRole(assignee, ids.assignee, "CONTENT_MARKETER");

      expect(repo.updateUserRole).toHaveBeenCalledWith(ids.assignee, "CONTENT_MARKETER");
    });

    it("does not let an ordinary user change someone else's role", async () => {
      const repo = repository();
      const service = new MarketingService(repo, notifier());

      await expect(service.updateUserRole(assignee, ids.creator, "DIGITAL_MARKETER"))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(repo.updateUserRole).not.toHaveBeenCalled();
    });

    it("never allows self-promotion to Head, even for Head acting on themself", async () => {
      const repo = repository();
      const service = new MarketingService(repo, notifier());

      await expect(service.updateUserRole(assignee, ids.assignee, "HEAD_OF_MARKETING"))
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
      await expect(service.updateUserRole(head, ids.head, "HEAD_OF_MARKETING"))
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(repo.updateUserRole).not.toHaveBeenCalled();
    });

    it("refuses to change the Head's role through this flow, even when Head requests it", async () => {
      const repo = repository();
      const service = new MarketingService(repo, notifier());

      await expect(service.updateUserRole(head, ids.head, "SMM_MANAGER"))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(repo.updateUserRole).not.toHaveBeenCalled();
    });

    it("rejects a role change for a user that does not exist", async () => {
      const repo = repository({ getUserById: vi.fn(async () => null) });
      const service = new MarketingService(repo, notifier());

      await expect(service.updateUserRole(head, "10000000-0000-4000-8000-000000000099", "SMM_MANAGER"))
        .rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("posting checklist", () => {
    const checklist = {
      id: "40000000-0000-4000-8000-000000000001",
      taskId: ids.task,
      kind: "POSTING" as const,
      createdAt: "2026-09-06T12:00:00.000Z",
      items: [{
        id: "50000000-0000-4000-8000-000000000001",
        checklistId: "40000000-0000-4000-8000-000000000001",
        label: "Telegram",
        position: 0,
        isCompleted: false,
        completedBy: null,
        completedAt: null,
      }],
    };

    it("does not send a posting task to review while an item is incomplete", async () => {
      const repo = repository({
        getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })),
        getPostingChecklist: vi.fn(async () => checklist),
      });
      await expect(new MarketingService(repo, notifier()).performTaskAction(assignee, ids.task, { action: "SUBMIT_REVIEW" }))
        .rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(repo.transitionTask).not.toHaveBeenCalled();
    });

    it("lets only the assignee toggle a checklist item", async () => {
      const repo = repository({
        getPostingChecklistByItemId: vi.fn(async () => checklist),
        getPostingChecklist: vi.fn(async () => ({ ...checklist, items: [{ ...checklist.items[0], isCompleted: true }] })),
      });
      const service = new MarketingService(repo, notifier());
      await expect(service.togglePostingChecklistItem(creator, checklist.items[0].id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await service.togglePostingChecklistItem(assignee, checklist.items[0].id);
      expect(repo.togglePostingChecklistItem).toHaveBeenCalledWith({ itemId: checklist.items[0].id, actorId: assignee.id });
    });

    it("allows sending to review once every checklist item is complete", async () => {
      const repo = repository({
        getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })),
        getPostingChecklist: vi.fn(async () => ({ ...checklist, items: [{ ...checklist.items[0], isCompleted: true }] })),
      });
      await expect(new MarketingService(repo, notifier()).performTaskAction(assignee, ids.task, { action: "SUBMIT_REVIEW" }))
        .resolves.toMatchObject({ status: "REVIEW" });
      expect(repo.transitionTask).toHaveBeenCalledOnce();
    });

    it("leaves a task with no checklist unaffected by the posting gate", async () => {
      const repo = repository({ getTask: vi.fn(async () => task({ status: "IN_PROGRESS" })) });
      await expect(new MarketingService(repo, notifier()).performTaskAction(assignee, ids.task, { action: "SUBMIT_REVIEW" }))
        .resolves.toMatchObject({ status: "REVIEW" });
    });
  });

  describe("recurring tasks", () => {
    const definition = {
      id: "60000000-0000-4000-8000-000000000001",
      sourceTaskId: ids.task,
      createdBy: ids.creator,
      title: "Weekly post #posting",
      description: null,
      priority: "normal" as const,
      assigneeId: ids.assignee,
      frequency: "WEEKLY" as const,
      weekday: 3,
      dayOfMonth: null,
      localTime: "09:00",
      timezone: "Asia/Tashkent" as const,
      endsOn: null,
      status: "ACTIVE" as const,
      nextOccurrenceAt: "2026-09-09T04:00:00.000Z",
      createdAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    };

    it("atomically advances a due definition and notifies for the new normal task", async () => {
      const generated = task({
        creatorId: ids.creator, assigneeId: ids.assignee, deadline: definition.nextOccurrenceAt!,
        recurringDefinitionId: definition.id, scheduledOccurrenceAt: definition.nextOccurrenceAt,
      });
      const repo = repository({
        listDueRecurringDefinitions: vi.fn(async () => [definition]),
        generateRecurringOccurrence: vi.fn(async () => generated),
      });
      const notifications = notifier();
      const result = await new MarketingService(repo, notifications)
        .generateDueRecurringTasks(new Date("2026-09-09T04:01:00.000Z"));

      expect(result.generated).toBe(1);
      expect(repo.generateRecurringOccurrence).toHaveBeenCalledWith({
        definitionId: definition.id,
        scheduledOccurrenceAt: definition.nextOccurrenceAt,
        nextOccurrenceAt: "2026-09-16T04:00:00.000Z",
      });
      expect(notifications.notifyAssignment).toHaveBeenCalledTimes(1);
    });

    it("allows only the source creator or Head to configure recurrence", async () => {
      const repo = repository({
        getTask: vi.fn(async () => task()),
        createRecurringDefinition: vi.fn(async () => definition),
      });
      const service = new MarketingService(repo, notifier());
      const input = { frequency: "WEEKDAYS", localTime: "09:00" };
      await expect(service.createRecurrence(assignee, ids.task, input, new Date("2026-09-08T00:00:00Z")))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      await service.createRecurrence(creator, ids.task, input, new Date("2026-09-08T00:00:00Z"));
      expect(repo.createRecurringDefinition).toHaveBeenCalledOnce();
    });

    it("does not generate a second task when a stale scheduler run repeats the same occurrence", async () => {
      // The database only advances next_occurrence_at on the run that actually
      // wins the row lock; a second, racing/retried invocation gets null back
      // from generateRecurringOccurrence for that same scheduled instant.
      const repo = repository({
        listDueRecurringDefinitions: vi.fn(async () => [definition]),
        generateRecurringOccurrence: vi.fn(async () => null),
      });
      const notifications = notifier();
      const result = await new MarketingService(repo, notifications)
        .generateDueRecurringTasks(new Date("2026-09-09T04:01:00.000Z"));

      expect(result.generated).toBe(0);
      expect(repo.generateRecurringOccurrence).toHaveBeenCalledTimes(1);
      expect(notifications.notifyAssignment).not.toHaveBeenCalled();
    });

    it("denies a non-owning, non-Head assignee from pausing someone else's recurrence", async () => {
      const repo = repository({ getRecurringDefinition: vi.fn(async () => definition) });
      const service = new MarketingService(repo, notifier());
      await expect(service.updateRecurrence(assignee, definition.id, { action: "PAUSE" }))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(repo.updateRecurringDefinition).not.toHaveBeenCalled();
    });

    it("pauses a recurrence, keeping its next occurrence pointer for a later resume", async () => {
      const repo = repository({ getRecurringDefinition: vi.fn(async () => definition) });
      const service = new MarketingService(repo, notifier());

      await service.updateRecurrence(creator, definition.id, { action: "PAUSE" });
      expect(repo.updateRecurringDefinition).toHaveBeenLastCalledWith(expect.objectContaining({
        status: "PAUSED", nextOccurrenceAt: definition.nextOccurrenceAt,
      }));
    });

    it("stops a recurrence and clears its schedule, which a further resume cannot revive", async () => {
      const stopped = { ...definition, status: "STOPPED" as const, nextOccurrenceAt: null };
      const repo = repository({ getRecurringDefinition: vi.fn(async () => definition) });
      const service = new MarketingService(repo, notifier());

      await service.updateRecurrence(head, definition.id, { action: "STOP" });
      expect(repo.updateRecurringDefinition).toHaveBeenLastCalledWith(expect.objectContaining({
        status: "STOPPED", nextOccurrenceAt: null,
      }));

      const stoppedRepo = repository({ getRecurringDefinition: vi.fn(async () => stopped) });
      await expect(new MarketingService(stoppedRepo, notifier()).updateRecurrence(head, definition.id, { action: "RESUME" }))
        .rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("analytics visibility", () => {
    it("gives an employee only their own analytics and Head the whole team", async () => {
      const repo = repository();
      const service = new MarketingService(repo, notifier());

      const employeeView = await service.getAnalytics(assignee, 30, new Date("2026-09-09T00:00:00Z"));
      expect(employeeView.team).toEqual([]);

      const headView = await service.getAnalytics(head, 30, new Date("2026-09-09T00:00:00Z"));
      expect(headView.team.length).toBeGreaterThan(0);
      expect(headView.team.every((row) => "workload" in row && "metrics" in row)).toBe(true);
    });
  });
});
