import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeadlineChangeRequest, Task, User } from "../src/domain/models";
import type { WorkflowNotificationInput } from "../src/application/ports/notification-dispatcher";

const { sendTelegramMessage } = vi.hoisted(() => ({ sendTelegramMessage: vi.fn() }));

vi.mock("../src/telegram/client", () => ({ sendTelegramMessage }));

import { TelegramNotificationDispatcher } from "../src/server/notifications/telegram-notification-dispatcher";

const creator: User = {
  id: "10000000-0000-4000-8000-000000000001",
  telegramUserId: "42",
  telegramUsername: "lead",
  displayName: "Team Lead",
  role: "HEAD_OF_MARKETING",
  isActive: true,
  deactivatedAt: null,
  createdAt: "2026-09-06T12:00:00.000Z",
  updatedAt: "2026-09-06T12:00:00.000Z",
};

const assignee: User = {
  ...creator,
  id: "10000000-0000-4000-8000-000000000002",
  telegramUserId: "43",
  telegramUsername: "editor",
  displayName: "Editor",
  role: "OPERATOR_VIDEO_EDITOR",
};

const task: Task = {
  id: "20000000-0000-4000-8000-000000000001",
  title: "Publish launch reel",
  description: null,
  priority: "high",
  status: "ASSIGNED",
  creatorId: creator.id,
  assigneeId: assignee.id,
  deadline: "2026-09-08T13:00:00.000Z",
  blockedReason: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: "2026-09-06T12:00:00.000Z",
  updatedAt: "2026-09-06T12:00:00.000Z",
};

const deadlineRequest: DeadlineChangeRequest = {
  id: "30000000-0000-4000-8000-000000000001",
  taskId: task.id,
  requestedBy: assignee.id,
  currentDeadline: task.deadline,
  requestedDeadline: "2026-09-09T07:00:00.000Z",
  reason: "Material kech keldi",
  status: "PENDING",
  resolvedBy: null,
  resolvedAt: null,
  resolutionNote: null,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
};

describe("Telegram notification dispatcher", () => {
  beforeEach(() => sendTelegramMessage.mockReset());

  it("sends assignment context and lifecycle actions to the assignee", async () => {
    sendTelegramMessage.mockResolvedValueOnce(undefined);
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");

    await expect(notifier.notifyAssignment({ task, creator, assignee })).resolves.toEqual({ status: "SENT" });
    expect(sendTelegramMessage).toHaveBeenCalledWith("test-token", expect.objectContaining({
      chatId: "43",
      text: expect.stringContaining("Creator: Team Lead"),
      replyMarkup: {
        inline_keyboard: [
          [{ text: "Accept", callback_data: `task:${task.id}:ACCEPT` }],
          [{ text: "Open task", web_app: { url: "https://tasks.example.com" } }],
        ],
      },
    }));
  });

  it("fails safely without attempting a fabricated chat ID when onboarding is absent", async () => {
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");
    const notOnboarded = { ...assignee, telegramUserId: "" } as User;

    await expect(notifier.notifyAssignment({ task, creator, assignee: notOnboarded })).resolves.toEqual({
      status: "FAILED",
      reason: "ASSIGNEE_NOT_ONBOARDED",
    });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("reports Telegram delivery failure without throwing", async () => {
    sendTelegramMessage.mockRejectedValueOnce(new Error("transport details"));
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");

    await expect(notifier.notifyAssignment({ task, creator, assignee })).resolves.toEqual({
      status: "FAILED",
      reason: "DELIVERY_FAILED",
    });
  });

  it("deduplicates creator and Head by Telegram user ID for a deadline request", async () => {
    sendTelegramMessage.mockResolvedValueOnce(undefined);
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");

    await expect(notifier.notifyWorkflow({
      event: "DEADLINE_CHANGE_REQUESTED",
      task,
      actor: assignee,
      deadlineRequest,
      recipients: [creator, creator],
    })).resolves.toEqual({
      deliveries: [{ recipientUserId: creator.id, status: "SENT" }],
    });

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith("test-token", expect.objectContaining({
      chatId: creator.telegramUserId,
      text: expect.stringContaining("Material kech keldi"),
      replyMarkup: {
        inline_keyboard: [
          [{ text: "✅ Approve", callback_data: `deadline:${deadlineRequest.id}:APPROVE` }],
          [{ text: "❌ Reject", callback_data: `deadline:${deadlineRequest.id}:REJECT` }],
          [{ text: "📋 Open Task", web_app: { url: "https://tasks.example.com" } }],
        ],
      },
    }));
  });

  it("formats every implemented workflow outcome for its recipient", async () => {
    sendTelegramMessage.mockResolvedValue(undefined);
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");
    const cases: ReadonlyArray<{
      input: WorkflowNotificationInput;
      expectedText: string;
    }> = [
      {
        input: {
          event: "DEADLINE_CHANGE_APPROVED",
          task,
          actor: creator,
          recipients: [assignee],
          deadlineRequest: { ...deadlineRequest, status: "APPROVED" },
        },
        expectedText: "✅ Deadline o‘zgartirildi",
      },
      {
        input: {
          event: "DEADLINE_CHANGE_REJECTED",
          task,
          actor: creator,
          recipients: [assignee],
          deadlineRequest: { ...deadlineRequest, status: "REJECTED" },
        },
        expectedText: "❌ Deadline so‘rovi rad etildi",
      },
      {
        input: {
          event: "TASK_ACCEPTED",
          task: { ...task, status: "IN_PROGRESS" },
          actor: assignee,
          recipients: [creator],
        },
        expectedText: "✅ Task qabul qilindi\n\nTask: Publish launch reel\nAssignee: @editor\nDeadline:",
      },
      {
        input: {
          event: "TASK_COMPLETED",
          task: { ...task, status: "DONE" },
          actor: creator,
          recipients: [assignee],
        },
        expectedText: "✅ Task qabul qilindi",
      },
      {
        input: {
          event: "REVISION_REQUESTED",
          task: { ...task, status: "REVISION" },
          actor: creator,
          recipients: [assignee],
          comment: "Use the approved copy",
        },
        expectedText: "Comment:\nUse the approved copy",
      },
      {
        input: {
          event: "TASK_BLOCKED",
          task: { ...task, status: "BLOCKED" },
          actor: assignee,
          recipients: [creator],
          comment: "Waiting for assets",
        },
        expectedText: "Reason:\nWaiting for assets",
      },
    ];

    for (const testCase of cases) {
      sendTelegramMessage.mockClear();
      await notifier.notifyWorkflow(testCase.input);
      expect(sendTelegramMessage).toHaveBeenCalledWith("test-token", expect.objectContaining({
        text: expect.stringContaining(testCase.expectedText),
      }));
    }
  });

  it("sends review controls to every unique reviewer", async () => {
    sendTelegramMessage.mockResolvedValue(undefined);
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");

    await notifier.notifyWorkflow({
      event: "REVIEW_REQUESTED",
      task: { ...task, status: "REVIEW" },
      actor: assignee,
      recipients: [creator],
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith("test-token", expect.objectContaining({
      text: expect.stringContaining("📝 Task reviewga yuborildi"),
      replyMarkup: {
        inline_keyboard: [
          [{ text: "✅ Approve", callback_data: `task:${task.id}:APPROVE` }],
          [{ text: "🔄 Revision", callback_data: `task:${task.id}:REQUEST_REVISION` }],
          [{ text: "📋 Open Task", web_app: { url: "https://tasks.example.com" } }],
        ],
      },
    }));
  });

  it("sends the creator a full accept notification when their task is accepted", async () => {
    sendTelegramMessage.mockResolvedValue(undefined);
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");

    await notifier.notifyWorkflow({
      event: "TASK_ACCEPTED",
      task: { ...task, status: "IN_PROGRESS" },
      actor: assignee,
      recipients: [creator],
    });

    expect(sendTelegramMessage).toHaveBeenCalledWith("test-token", expect.objectContaining({
      chatId: creator.telegramUserId,
      text: [
        "✅ Task qabul qilindi",
        "",
        "Task: Publish launch reel",
        "Assignee: @editor",
        "Deadline: 08.09.2026 18:00",
        "Status: In Progress",
      ].join("\n"),
    }));
  });

  it("records an unonboarded workflow recipient without fabricating a chat ID", async () => {
    const notifier = new TelegramNotificationDispatcher("test-token", "https://tasks.example.com");
    const notOnboarded = { ...assignee, telegramUserId: "" } as User;

    await expect(notifier.notifyWorkflow({
      event: "TASK_COMPLETED",
      task: { ...task, status: "DONE" },
      actor: creator,
      recipients: [notOnboarded],
    })).resolves.toEqual({
      deliveries: [{
        recipientUserId: assignee.id,
        status: "FAILED",
        reason: "RECIPIENT_NOT_ONBOARDED",
      }],
    });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });
});
