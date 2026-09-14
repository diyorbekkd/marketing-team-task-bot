import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  deactivatedAt: null,
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
    createTasksBulk: vi.fn(async () => []),
    performTaskAction: vi.fn(async () => ({ ...task, status: "IN_PROGRESS" })),
    requestDeadlineChange: vi.fn(),
    resolveDeadlineChangeRequest: vi.fn(async () => ({ status: "APPROVED" })),
    ...overrides,
  } as unknown as MarketingService;
}

describe("Telegram MVP handler", () => {
  // The shorthand parser checks deadlines against the real wall clock in
  // production (correct — a deadline is only "past" relative to now). Fixture
  // dates below are fixed calendar dates, so the clock is pinned here to keep
  // these tests deterministic regardless of when the suite actually runs.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"event":"task_parse_failed"'));
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

  it("renders inline posting toggles and enables review only after completion", async () => {
    const checklist = {
      id: "40000000-0000-4000-8000-000000000001",
      taskId: task.id,
      kind: "POSTING" as const,
      createdAt: "2026-09-07T00:00:00Z",
      items: [
        { id: "50000000-0000-4000-8000-000000000001", checklistId: "40000000-0000-4000-8000-000000000001", label: "Telegram", position: 0, isCompleted: true, completedBy: actor.id, completedAt: "2026-09-07T00:00:00Z" },
      ],
    };
    const service = serviceMock({ togglePostingChecklistItem: vi.fn(async () => checklist) });
    const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
      update_id: 25,
      callback_query: {
        id: "callback-checklist", from: { id: 43, is_bot: false, first_name: "Editor" },
        data: `check:${checklist.items[0].id}`,
        message: { message_id: 8, chat: { id: 43, type: "private" } },
      },
    }));
    expect(service.togglePostingChecklistItem).toHaveBeenCalledWith(actor, checklist.items[0].id);
    expect(result.messages[0]?.replyMarkup?.inline_keyboard.flat().map((button) => button.text))
      .toContain("✅ Reviewga yuborish");
  });

  describe("private-chat task creation", () => {
    it("creates a task from the positional format sent directly to the bot", async () => {
      const service = serviceMock();
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 30,
        message: {
          message_id: 30,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text: "Yangi creative\n@editor\n08.09.2026 18:00",
        },
      }));

      expect(service.createTaskForUsername).toHaveBeenCalledWith(actor, {
        title: "Yangi creative",
        assigneeUsername: "editor",
        deadline: "2026-09-08T13:00:00.000Z",
        priority: "normal",
      }, 30);
      expect(result.messages[0]?.text).toContain("Task created.");
    });

    it("creates a task from the labeled format sent directly to the bot", async () => {
      const service = serviceMock();
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 31,
        message: {
          message_id: 31,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text: "T: Publish launch reel\nA: @editor\nDL: 08.09.2026 18:00",
        },
      }));

      expect(service.createTaskForUsername).toHaveBeenCalledWith(actor, expect.objectContaining({
        title: "Publish launch reel",
        assigneeUsername: "editor",
      }), 31);
      expect(result.messages[0]?.text).toContain("Task created.");
    });

    it("never parses /start as a task even in a private chat", async () => {
      const service = serviceMock();
      await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 32,
        message: {
          message_id: 32,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text: "/start",
        },
      }));

      expect(service.onboardTelegram).toHaveBeenCalled();
      expect(service.createTaskForUsername).not.toHaveBeenCalled();
    });

    it("gives a more helpful parse-error message in a private chat than in the group", async () => {
      const service = serviceMock();
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 33,
        message: {
          message_id: 33,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text: "T: Publish launch reel",
        },
      }));

      expect(service.createTaskForUsername).not.toHaveBeenCalled();
      expect(result.messages[0]?.text).toContain("Task yaratish formati");
      expect(result.messages[0]?.text).toContain("---");
    });

    it("rejects task creation from a sender who is not onboarded, without creating a task", async () => {
      const service = serviceMock({
        requireActorByTelegramId: vi.fn(async () => {
          throw new ApplicationError("FORBIDDEN", "You are not part of the marketing team yet.");
        }),
      });
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 34,
        message: {
          message_id: 34,
          chat: { id: 999, type: "private" },
          from: { id: 999, is_bot: false, first_name: "Stranger" },
          text: "Yangi creative\n@editor\n08.09.2026 18:00",
        },
      }));

      expect(service.createTaskForUsername).not.toHaveBeenCalled();
      expect(result.messages[0]?.text).toBe("You are not part of the marketing team yet.");
    });
  });

  describe("bulk task creation", () => {
    const bulkText = [
      "First task",
      "@editor",
      "08.09.2026 18:00",
      "---",
      "Second task",
      "@lead",
      "09.09.2026 07:00",
    ].join("\n");

    it("parses each '---'-separated block with the exact single-task parser and reports full success", async () => {
      const service = serviceMock({
        createTasksBulk: vi.fn(async () => [
          { index: 0, status: "CREATED" as const, task, assignee },
          { index: 1, status: "CREATED" as const, task: { ...task, id: "20000000-0000-4000-8000-000000000002" }, assignee: actor },
        ]),
      });
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 40,
        message: {
          message_id: 40,
          chat: { id: -100123, type: "supergroup" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text: bulkText,
        },
      }));

      expect(service.createTasksBulk).toHaveBeenCalledWith(actor, [
        expect.objectContaining({ title: "First task", assigneeUsername: "editor" }),
        expect.objectContaining({ title: "Second task", assigneeUsername: "lead" }),
      ], 40);
      expect(result.messages[0]?.text).toContain("✅ 2 ta task yaratildi");
      expect(result.messages[0]?.text).not.toContain("❌");
    });

    it("reports one failed block by its 1-based position while the valid block still succeeds", async () => {
      const service = serviceMock({
        createTasksBulk: vi.fn(async () => [
          { index: 0, status: "CREATED" as const, task, assignee },
          { index: 1, status: "FAILED" as const, errorMessage: "@unknown aktiv jamoa a'zolari orasida topilmadi." },
        ]),
      });
      const text = ["Valid task", "@editor", "08.09.2026 18:00", "---", "Bad task", "@unknown", "09.09.2026 07:00"].join("\n");
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 41,
        message: {
          message_id: 41,
          chat: { id: -100123, type: "supergroup" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text,
        },
      }));

      expect(result.messages[0]?.text).toContain("✅ 1 ta task yaratildi");
      expect(result.messages[0]?.text).toContain("❌ 1 ta task yaratilmadi");
      expect(result.messages[0]?.text).toContain("2-task:");
      expect(result.messages[0]?.text).toContain("@unknown aktiv jamoa a'zolari orasida topilmadi.");
    });

    it("reports a parse-time failure (malformed block) by position without ever attempting to create it", async () => {
      const service = serviceMock({
        createTasksBulk: vi.fn(async () => [{ index: 0, status: "CREATED" as const, task, assignee }]),
      });
      const text = ["Valid task", "@editor", "08.09.2026 18:00", "---", "Valid task 2", "@editor", "08-09-2026 18:00"].join("\n");
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 42,
        message: {
          message_id: 42,
          chat: { id: -100123, type: "supergroup" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text,
        },
      }));

      expect(service.createTasksBulk).toHaveBeenCalledWith(actor, [
        expect.objectContaining({ title: "Valid task" }),
      ], 42);
      expect(result.messages[0]?.text).toContain("✅ 1 ta task yaratildi");
      expect(result.messages[0]?.text).toContain("❌ 1 ta task yaratilmadi");
      expect(result.messages[0]?.text).toContain("2-task:");
    });

    it("never treats a lone separator with no real content as a task creation attempt", async () => {
      const service = serviceMock();
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 43,
        message: {
          message_id: 43,
          chat: { id: -100123, type: "supergroup" },
          from: { id: 99, is_bot: false, first_name: "Guest" },
          text: "---",
        },
      }));

      // No task is ever created and no confirmation/error is sent — a bare
      // separator with nothing real on either side is never an attempt.
      expect(result.messages).toEqual([]);
      expect(service.createTasksBulk).not.toHaveBeenCalled();
      expect(service.createTaskForUsername).not.toHaveBeenCalled();
    });

    it("works identically in a private chat, using the same shared parser and reporting format", async () => {
      const service = serviceMock({
        createTasksBulk: vi.fn(async () => [
          { index: 0, status: "CREATED" as const, task, assignee },
          { index: 1, status: "CREATED" as const, task: { ...task, id: "20000000-0000-4000-8000-000000000002" }, assignee: actor },
        ]),
      });
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 44,
        message: {
          message_id: 44,
          chat: { id: 42, type: "private" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text: bulkText,
        },
      }));

      expect(service.createTasksBulk).toHaveBeenCalledWith(actor, expect.any(Array), 44);
      expect(result.messages[0]?.text).toContain("✅ 2 ta task yaratildi");
    });

    it("rejects a batch over the 20-task limit with the documented message instead of silently truncating", async () => {
      const service = serviceMock({
        createTasksBulk: vi.fn(async () => Array.from({ length: 20 }, (_, i) => ({
          index: i, status: "CREATED" as const, task, assignee,
        }))),
      });
      const blocks = Array.from({ length: 21 }, (_, i) => `Task ${i + 1}\n@editor\n0${(i % 9) + 1}.09.2026 18:00`);
      const result = await createTelegramUpdateHandler(service, handlerConfig)(TelegramUpdateSchema.parse({
        update_id: 45,
        message: {
          message_id: 45,
          chat: { id: -100123, type: "supergroup" },
          from: { id: 42, is_bot: false, first_name: "Team", last_name: "Lead", username: "lead" },
          text: blocks.join("\n---\n"),
        },
      }));

      expect(result.messages[0]?.text).toContain("Bir xabarda maksimum 20 ta task yaratish mumkin.");
    });
  });
});
