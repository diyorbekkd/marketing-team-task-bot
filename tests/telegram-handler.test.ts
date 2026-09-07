import { describe, expect, it, vi } from "vitest";
import { ApplicationError } from "../src/application/errors";
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

const handlerConfig = {
  marketingGroupId: "-100123",
  headTelegramUserId: "42",
} as const;

function serviceMock(overrides: Record<string, unknown> = {}) {
  return {
    onboardTelegram: vi.fn(async () => actor),
    requireActorByTelegramId: vi.fn(async () => actor),
    createTaskForUsername: vi.fn(async () => ({ task, assignee, notification: { status: "SENT" as const } })),
    performTaskAction: vi.fn(async () => ({ ...task, status: "IN_PROGRESS" })),
    requestDeadlineChange: vi.fn(),
    resolveDeadlineChangeRequest: vi.fn(async () => ({ status: "APPROVED" })),
    ...overrides,
  } as unknown as MarketingService;
}

describe("Telegram MVP handler", () => {
  it("onboards a private-chat user from Telegram identity", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 10,
      message: {
        message_id: 1,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
        text: "/start",
      },
    }));

    expect(service.onboardTelegram).toHaveBeenCalledWith(
      {
        telegramUserId: "42",
        telegramUsername: "lead",
        displayName: "Team Lead",
      },
      "42",
    );
    expect(result.messages[0]?.text).toContain("HEAD_OF_MARKETING");
  });

  it("creates an idempotent group task through the notification-aware service", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
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
    expect(result.messages.map((message) => message.chatId)).toEqual([-100123]);
    expect(result.messages[0]?.text).toContain("Task created.");
  });

  it("keeps accepting an explicit bot mention with the labeled format", async () => {
    const service = serviceMock();
    await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 23,
      message: {
        message_id: 23,
        chat: { id: -100123, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead" },
        text: "@ibox_marketing_tasks_bot\nT: Publish launch reel\nA: @editor\nDL: 08.09.2026 18:00",
        entities: [{ type: "mention", offset: 0, length: 25 }],
      },
    }));

    expect(service.createTaskForUsername).toHaveBeenCalledWith(actor, expect.objectContaining({
      title: "Publish launch reel",
      assigneeUsername: "editor",
    }), 23);
  });

  it("creates a positional task without a bot mention through the same service", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 18,
      message: {
        message_id: 8,
        chat: { id: -100123, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
        text: "Yangi creative\n@misbahmarketing\n08.09.2026 18:00",
      },
    }));

    expect(service.createTaskForUsername).toHaveBeenCalledWith(actor, {
      title: "Yangi creative",
      assigneeUsername: "misbahmarketing",
      deadline: "2026-09-08T13:00:00.000Z",
      priority: "normal",
    }, 18);
    expect(result.messages[0]?.text).toContain("Task created.");
  });

  it("silently ignores ordinary three-line group conversation before actor lookup", async () => {
    for (const [updateId, text] of [
      [19, "Bugun yig‘ilish bor\nHamma qatnashsin\nSoat oltida"],
      [24, "Yig‘ilish\nHamma qatnashsin\n09.09.2026 14:00"],
    ] as const) {
      const service = serviceMock();
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: updateId,
        message: {
          message_id: updateId,
          chat: { id: -100123, type: "supergroup" },
          from: { id: 99, is_bot: false, first_name: "Guest" },
          text,
        },
      }));

      expect(result.messages).toEqual([]);
      expect(service.requireActorByTelegramId).not.toHaveBeenCalled();
      expect(service.createTaskForUsername).not.toHaveBeenCalled();
    }
  });

  it("returns a concise error without creating when a positional deadline is malformed or past", async () => {
    for (const [updateId, deadline] of [[20, "08-09-2026 18:00"], [21, "01.01.2020 10:00"]] as const) {
      const service = serviceMock();
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: updateId,
        message: {
          message_id: updateId,
          chat: { id: -100123, type: "supergroup" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead" },
          text: `Yangi creative\n@misbahmarketing\n${deadline}`,
        },
      }));

      expect(result.messages[0]?.text).toContain("Task yaratilmadi");
      expect(service.createTaskForUsername).not.toHaveBeenCalled();
    }
  });

  it("rejects an unknown positional assignee without a success confirmation", async () => {
    const service = serviceMock({
      createTaskForUsername: vi.fn(async () => {
        throw new ApplicationError("INVALID_INPUT", "No active teammate matches @unknownuser.");
      }),
    });
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 22,
      message: {
        message_id: 22,
        chat: { id: -100123, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead" },
        text: "Yangi creative\n@unknownuser\n08.09.2026 18:00",
      },
    }));

    expect(result.messages[0]?.text).toBe("No active teammate matches @unknownuser.");
    expect(result.messages[0]?.text).not.toContain("Task created.");
  });

  it("returns a useful format response for incomplete group shorthand", async () => {
    const service = serviceMock();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 14,
      message: {
        message_id: 4,
        chat: { id: -100123, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Team", username: "lead" },
        text: "@marketing_team_task_bot T: Publish launch reel",
        entities: [{ type: "mention", offset: 0, length: 24 }],
      },
    }));

    expect(service.createTaskForUsername).not.toHaveBeenCalled();
    expect(result.messages[0]?.text).toContain("Task yaratilmadi");
    expect(result.messages[0]?.text).toContain("@username");
    expect(result.messages[0]?.text).toContain("DD.MM.YYYY HH:mm");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"event":"group_task_parse_failed"'));
  });

  it("confirms persistence while warning when assignment notification fails", async () => {
    const service = serviceMock({
      createTaskForUsername: vi.fn(async () => ({
        task,
        assignee,
        notification: { status: "FAILED" as const, reason: "DELIVERY_FAILED" as const },
      })),
    });
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 15,
      message: {
        message_id: 5,
        chat: { id: -100123, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Team", username: "lead" },
        text: "T: Publish launch reel\nA: @editor\nDL: 08.09.2026 18:00",
      },
    }));

    expect(result.messages[0]?.text).toContain("Task saqlandi");
    expect(result.messages[0]?.text).toContain("/start");
  });

  it("rejects shorthand task creation outside the configured marketing group", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 12,
      message: {
        message_id: 3,
        chat: { id: -100999, type: "supergroup" },
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
        text: "T: Publish launch reel\nA: @editor\nDL: 08.09.2026 18:00",
      },
    }));

    expect(service.createTaskForUsername).not.toHaveBeenCalled();
    expect(result.messages[0]?.text).toBe("Tasks may only be created in the configured marketing group.");
  });

  it("maps a Telegram callback to the shared workflow service", async () => {
    const service = serviceMock();
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 13,
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

  it("maps deadline approval buttons to the shared resolution workflow", async () => {
    const service = serviceMock();
    const requestId = "30000000-0000-4000-8000-000000000001";
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 16,
      callback_query: {
        id: "callback-2",
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead" },
        data: `deadline:${requestId}:APPROVE`,
        message: { message_id: 6, chat: { id: 42, type: "private" } },
      },
    }));

    expect(service.resolveDeadlineChangeRequest).toHaveBeenCalledWith(actor, requestId, true);
    expect(result.messages[0]?.text).toContain("APPROVED");
    expect(result.callbackQueryId).toBe("callback-2");
  });

  it("maps review revision buttons to the shared task workflow", async () => {
    const service = serviceMock();
    await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 17,
      callback_query: {
        id: "callback-3",
        from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead" },
        data: `task:${task.id}:REQUEST_REVISION`,
        message: { message_id: 7, chat: { id: 42, type: "private" } },
      },
    }));

    expect(service.performTaskAction).toHaveBeenCalledWith(actor, task.id, { action: "REQUEST_REVISION" });
  });
});
