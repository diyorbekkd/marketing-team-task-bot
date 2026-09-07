import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task, User } from "../src/domain/models";

const { sendTelegramMessage } = vi.hoisted(() => ({ sendTelegramMessage: vi.fn() }));

vi.mock("../src/telegram/client", () => ({ sendTelegramMessage }));

import { TelegramAssignmentNotifier } from "../src/server/notifications/telegram-assignment-notifier";

const creator: User = {
  id: "10000000-0000-4000-8000-000000000001",
  telegramUserId: "42",
  telegramUsername: "lead",
  displayName: "Team Lead",
  role: "HEAD_OF_MARKETING",
  isActive: true,
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

describe("Telegram assignment notifier", () => {
  beforeEach(() => sendTelegramMessage.mockReset());

  it("sends assignment context and lifecycle actions to the assignee", async () => {
    sendTelegramMessage.mockResolvedValueOnce(undefined);
    const notifier = new TelegramAssignmentNotifier("test-token", "https://tasks.example.com");

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
    const notifier = new TelegramAssignmentNotifier("test-token", "https://tasks.example.com");
    const notOnboarded = { ...assignee, telegramUserId: "" } as User;

    await expect(notifier.notifyAssignment({ task, creator, assignee: notOnboarded })).resolves.toEqual({
      status: "FAILED",
      reason: "ASSIGNEE_NOT_ONBOARDED",
    });
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("reports Telegram delivery failure without throwing", async () => {
    sendTelegramMessage.mockRejectedValueOnce(new Error("transport details"));
    const notifier = new TelegramAssignmentNotifier("test-token", "https://tasks.example.com");

    await expect(notifier.notifyAssignment({ task, creator, assignee })).resolves.toEqual({
      status: "FAILED",
      reason: "DELIVERY_FAILED",
    });
  });
});
