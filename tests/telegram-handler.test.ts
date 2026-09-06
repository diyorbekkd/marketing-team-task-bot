import { describe, expect, it, vi } from "vitest";
import type { MarketingService } from "../src/application/marketing-service";
import type { Task, User } from "../src/domain/models";
import { createTelegramUpdateHandler } from "../src/telegram/handler";
import { TelegramUpdateSchema } from "../src/telegram/update";

const actor: User = {
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
  ...actor,
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
  creatorId: actor.id,
  assigneeId: assignee.id,
  deadline: "2026-09-08T13:00:00.000Z",
  blockedReason: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: "2026-09-06T12:00:00.000Z",
  updatedAt: "2026-09-06T12:00:00.000Z",
};

function serviceMock(overrides: Record<string, unknown> = {}) {
  return {
    onboardTelegram: vi.fn(async () => actor),
    requireActorByTelegramId: vi.fn(async () => actor),
    createTaskForUsername: vi.fn(async () => ({ task, assignee })),
    performTaskAction: vi.fn(async () => ({ ...task, status: "IN_PROGRESS" })),
    requestDeadlineChange: vi.fn(),
    ...overrides,
  } as unknown as MarketingService;
}

describe("Telegram MVP handler", () => {
  it("onboards a private-chat user from Telegram identity", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service)(TelegramUpdateSchema.parse({
      update_id: 10,
      message: {
        message_id: 1,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
        text: "/start",
      },
    }));

    expect(service.onboardTelegram).toHaveBeenCalledWith({
      telegramUserId: "42",
      telegramUsername: "lead",
      displayName: "Team Lead",
    });
    expect(result.messages[0]?.text).toContain("HEAD_OF_MARKETING");
  });

  it("creates an idempotent group task and notifies the assignee", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service)(TelegramUpdateSchema.parse({
      update_id: 11,
      message: {
        message_id: 2,
        chat: { id: -100123, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
        text: "T: Publish launch reel\nA: @editor\nDL: 08.09.2026 18:00\nP: high",
      },
    }));

    expect(service.createTaskForUsername).toHaveBeenCalledWith(actor, expect.objectContaining({
      title: "Publish launch reel",
      assigneeUsername: "editor",
    }), 11);
    expect(result.messages.map((message) => message.chatId)).toEqual([-100123, 43]);
    expect(result.messages[1]?.replyMarkup?.inline_keyboard[0]?.[0]?.callback_data).toBe(`task:${task.id}:ACCEPT`);
  });

  it("maps a Telegram callback to the shared workflow service", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service)(TelegramUpdateSchema.parse({
      update_id: 12,
      callback_query: {
        id: "callback-1",
        from: { id: 43, is_bot: false, first_name: "Editor" },
        data: `task:${task.id}:ACCEPT`,
        message: { message_id: 3, chat: { id: 43, type: "private" } },
      },
    }));

    expect(service.performTaskAction).toHaveBeenCalledWith(actor, task.id, { action: "ACCEPT" });
    expect(result.callbackQueryId).toBe("callback-1");
  });
});
