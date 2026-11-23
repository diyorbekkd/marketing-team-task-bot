import { CreateTaskInputSchema, isOverdue } from "@/domain/task";
import type { ActorContext, TeamRole } from "@/domain/permissions";
import { canApproveDeadlineRequest, canEditTask, isAssignee, isCreator, isHead } from "@/domain/permissions";
import type { DeadlineChangeRequest, Task, User } from "@/domain/models";
import { TaskActionInputSchema, canTransition, statusForAction } from "@/domain/workflow";
import type { MarketingRepository, TelegramIdentityInput } from "./ports/marketing-repository";
import type { TaskPageSort } from "./ports/marketing-repository";
import type {
  NotificationQueue,
  AssignmentNotificationResult,
  NotificationDispatcher,
  WorkflowNotificationInput,
} from "./ports/notification-dispatcher";
import { ApplicationError } from "./errors";
import { z } from "zod";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { nextOccurrence, RecurrenceInputSchema, RecurrenceUpdateSchema } from "@/domain/recurrence";
import { calculateAnalytics, isOpenTask, tashkentDayRange, workloadMetrics } from "@/domain/reporting";
import { SaveTaskTemplateSchema } from "@/domain/task-template";

/**
 * Deterministic per-block idempotency key reusing the existing unique
 * `tasks.source_telegram_update_id` column — no schema change needed. Safe
 * for any realistic Telegram update id: multiplying by a fixed base larger
 * than the maximum batch size and adding a 0-based block index never
 * overlaps a different update's range, and a duplicated webhook delivery
 * recomputes the exact same key for the exact same block, so
 * `ON CONFLICT DO NOTHING` already makes a retry a no-op exactly the way it
 * does for a single task.
 */
const BULK_UPDATE_ID_BASE = 100;
function bulkBlockUpdateId(updateId: number, blockIndex: number): number {
  return updateId * BULK_UPDATE_ID_BASE + blockIndex;
}

const DeactivationInputSchema = z.object({
  openTasksAction: z.enum(["REASSIGN", "CANCEL", "KEEP"]).default("KEEP"),
  reassignToUserId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (value.openTasksAction === "REASSIGN" && !value.reassignToUserId) {
    context.addIssue({ code: "custom", path: ["reassignToUserId"], message: "Ochiq vazifalar kimga o‘tkazilishini tanlang." });
  }
});

const DeadlineRequestInputSchema = z.object({
  requestedDeadline: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(1).max(2000),
});

const UpdateTaskInputSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  deadline: z.string().datetime({ offset: true }).optional(),
  assigneeId: z.string().uuid().optional(),
  publicationAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Kamida bitta maydonni o‘zgartiring.",
});

const AddTaskCommentInputSchema = z.object({
  kind: z.enum(["COMMENT", "RESULT"]).default("COMMENT"),
  body: z.string().trim().min(1).max(4000).optional(),
  attachmentUrl: z.string().trim().url().max(2048).refine(
    (value) => value.startsWith("https://") || value.startsWith("http://"),
    "Havola http:// yoki https:// bilan boshlanishi kerak.",
  ).optional(),
}).strict().refine((value) => Boolean(value.body || value.attachmentUrl), {
  message: "Izoh yoki natija havolasini kiriting.",
});

const NotificationPreferencesPatchSchema = z.object({
  assignments: z.boolean().optional(),
  workflow: z.boolean().optional(),
  reminders: z.boolean().optional(),
  dailyCheck: z.boolean().optional(),
  reports: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Kamida bitta bildirishnoma sozlamasini tanlang.",
});

const WORKFLOW_ROLES = [
  "OPERATOR_VIDEO_EDITOR", "CONTENT_MARKETER", "DIGITAL_MARKETER", "SMM_MANAGER", "HEAD_OF_MARKETING",
] as const;
const StartWorkflowInputSchema = z.object({
  templateId: z.string().uuid(),
  subject: z.string().trim().min(1).max(200),
  firstDeadline: z.string().datetime({ offset: true }),
  stepAssignments: z.record(z.string().uuid(), z.object({
    ownerId: z.string().uuid(), participantIds: z.array(z.string().uuid()).max(30),
  }).strict()),
}).strict();

const SaveWorkflowTemplateInputSchema = z.object({
  sourceTemplateId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  steps: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).nullable(),
    assigneeRole: z.enum(WORKFLOW_ROLES),
    priority: z.enum(["high", "normal", "low"]),
    estimatedMinutes: z.number().int().min(5).max(10080).nullable(),
    checkpointTitles: z.array(z.string().trim().min(1).max(200)).max(50),
    videoKind: z.enum(["SHOOT", "EDIT"]).nullable().default(null),
  }).strict()).min(1).max(50),
}).strict().superRefine((value, context) => {
  value.steps.forEach((step, index) => {
    if (step.videoKind && step.assigneeRole !== "OPERATOR_VIDEO_EDITOR") {
      context.addIssue({ code: "custom", path: ["steps", index, "assigneeRole"], message: "Video bosqichi operator roliga tegishli." });
    }
  });
});

const WebUrlSchema = z.url().max(2048).refine((url) => /^https?:\/\//.test(url), "http:// yoki https:// havolasini kiriting.");
const VideoBriefInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("SHOOT"), scenarioUrl: WebUrlSchema,
    onCameraPerson: z.string().trim().min(1).max(200),
    location: z.string().trim().min(1).max(300),
    scheduledAt: z.iso.datetime({ offset: true }),
    durationMinutes: z.number().int().min(5).max(1440),
  }).strict(),
  z.object({
    kind: z.literal("EDIT"),
    editLevel: z.enum(["SIMPLE", "STANDARD", "COMPLEX"]),
  }).strict(),
]);
const BrowserCreateTaskInputSchema = CreateTaskInputSchema.extend({
  clientRequestId: z.string().uuid().optional(),
  manualCheckpoints: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
  }).strict()).max(50).optional(),
  videoBrief: VideoBriefInputSchema.optional(),
  taskTemplate: z.object({
    templateId: z.string().uuid(), eventOn: z.iso.date(), deadlineOverride: z.boolean(),
  }).strict().optional(),
}).refine((value) => !(value.videoBrief && value.taskTemplate), "Video brif va vazifa shabloni birga tanlanmaydi.");

export type TaskScope = "my" | "created" | "team" | "today" | "overdue" | "review";

const TaskPageInputSchema = z.object({
  reportView: z.enum(["open", "completed", "carry_over", "overdue"]).optional(),
  status: z.enum(["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"]).optional(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  assigneeId: z.string().uuid().optional(),
  deadlineRange: z.enum(["today", "next_7_days", "overdue"]).optional(),
  search: z.string().trim().min(1).max(80).optional(),
  sort: z.enum(["deadline_asc", "deadline_desc", "created_desc"]).default("created_desc"),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(1024).optional(),
}).strict();

const CursorSchema = z.object({
  sort: z.enum(["deadline_asc", "deadline_desc", "created_desc"]),
  value: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();

function decodeTaskCursor(cursor: string | undefined, sort: TaskPageSort) {
  if (!cursor) return undefined;
  try {
    const parsed = CursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    if (parsed.sort !== sort) throw new Error("sort mismatch");
    return { value: parsed.value, id: parsed.id };
  } catch {
    throw new ApplicationError("INVALID_INPUT", "Vazifalar kursori noto‘g‘ri yoki tanlangan saralashga mos kelmaydi.");
  }
}

function encodeTaskCursor(task: Task, sort: TaskPageSort): string {
  const value = sort === "created_desc" ? task.createdAt : task.deadline;
  return Buffer.from(JSON.stringify({ sort, value, id: task.id }), "utf8").toString("base64url");
}

export interface TaskCreationResult {
  readonly task: Task;
  readonly assignee: User;
  readonly notification: AssignmentNotificationResult;
}

export interface BrowserTaskCreationResult extends Omit<TaskCreationResult, "notification"> {
  readonly notification: AssignmentNotificationResult | { readonly status: "QUEUED" | "SKIPPED" };
}

const PersonalPlanInputSchema = z.object({
  isImportant: z.boolean().nullable(),
  urgentOverride: z.boolean().nullable(),
  plannedOn: z.iso.date().nullable(),
  estimatedMinutes: z.number().int().min(5).max(1440).nullable(),
}).strict();

const CheckpointInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).strict();

export type BulkTaskCreationOutcome =
  | { readonly index: number; readonly status: "CREATED"; readonly task: Task; readonly assignee: User }
  | { readonly index: number; readonly status: "FAILED"; readonly errorMessage: string };

function actorFromUser(user: User): ActorContext {
  return { userId: user.id, role: user.role };
}

function taskAccess(task: Task) {
  return { creatorId: task.creatorId, assigneeId: task.assigneeId };
}

const WEB_BOT_LOGIN_TTL_MS = 10 * 60 * 1000;
const WEB_BOT_CODE_PATTERN = /^wl_[A-Za-z0-9_-]{24}$/;
const WEB_BOT_BROWSER_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function webLoginHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class MarketingService {
  constructor(
    private readonly repository: MarketingRepository,
    private readonly notificationDispatcher: NotificationDispatcher,
    private readonly notificationQueue?: NotificationQueue,
  ) {}

  async onboardTelegram(identity: TelegramIdentityInput, expectedHeadTelegramUserId: string): Promise<User> {
    return this.repository.registerTelegramUser(identity, expectedHeadTelegramUserId);
  }

  async requireActorByTelegramId(telegramUserId: string): Promise<User> {
    const user = await this.repository.getUserByTelegramId(telegramUserId);
    if (!user?.isActive) {
      throw new ApplicationError("UNAUTHENTICATED", "Siz hozir faol marketing jamoasida emassiz. Marketing rahbari bilan bog‘laning.");
    }
    return user;
  }

  async requireActorById(userId: string): Promise<User> {
    const user = await this.repository.getUserById(userId);
    if (!user?.isActive) {
      throw new ApplicationError("UNAUTHENTICATED", "Foydalanuvchi sessiyasi endi faol emas.");
    }
    return user;
  }

  async createWebBotLogin(now = new Date()) {
    const code = `wl_${randomBytes(18).toString("base64url")}`;
    const browserToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + WEB_BOT_LOGIN_TTL_MS);
    await this.repository.createWebLoginChallenge({
      browserHash: webLoginHash(browserToken), codeHash: webLoginHash(code), expiresAt: expiresAt.toISOString(),
    });
    return { code, browserToken, expiresAt };
  }

  async approveWebBotLogin(telegramUserId: string, code: string, now = new Date()): Promise<boolean> {
    if (!WEB_BOT_CODE_PATTERN.test(code)) return false;
    const actor = await this.requireActorByTelegramId(telegramUserId);
    return this.repository.approveWebLoginChallenge({
      codeHash: webLoginHash(code), userId: actor.id, now: now.toISOString(),
    });
  }

  async consumeWebBotLogin(browserToken: string, now = new Date()): Promise<User | null> {
    if (!WEB_BOT_BROWSER_PATTERN.test(browserToken)) return null;
    const userId = await this.repository.consumeWebLoginChallenge({
      browserHash: webLoginHash(browserToken), now: now.toISOString(),
    });
    return userId ? this.requireActorById(userId) : null;
  }

  async listUsers(actor: User): Promise<User[]> {
    const users = await this.repository.listUsers();
    return isHead(actorFromUser(actor)) ? users : users.filter((user) => user.isActive);
  }

  async activateUser(actor: User, userId: string, role: TeamRole): Promise<User> {
    if (!isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Jamoa a’zolarini faqat Marketing rahbari faollashtira oladi.");
    }
    if (role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("INVALID_INPUT", "Marketing rahbari rolini o‘tkazish ushbu faollashtirish jarayoniga kirmaydi.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "Foydalanuvchi topilmadi.");
    }
    if (target.isActive) {
      throw new ApplicationError("CONFLICT", "Bu jamoa a’zosi allaqachon faol.");
    }
    if (target.deactivatedAt) {
      throw new ApplicationError("CONFLICT", "Bu foydalanuvchi avval jamoada bo‘lgan — uni qayta faollashtiring.");
    }
    return this.repository.activateUser({ userId, actorId: actor.id, role });
  }

  /**
   * Corrects a role picked incorrectly at onboarding. This is deliberately a
   * Head-only operation: organizational roles are authorization data, not
   * profile preferences. The Head role itself is never settable here —
   * transferring Head remains a deliberate out-of-band operation.
   */
  async updateUserRole(actor: User, userId: string, role: TeamRole): Promise<User> {
    if (role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("INVALID_INPUT", "Marketing rahbari rolini o‘zgartirish ushbu jarayonga kirmaydi.");
    }
    if (!isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Jamoa rollarini faqat Marketing rahbari o‘zgartira oladi.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "Foydalanuvchi topilmadi.");
    }
    if (!target.isActive) {
      throw new ApplicationError("CONFLICT", "Kutilayotgan foydalanuvchiga rol faollashtirish paytida beriladi.");
    }
    if (target.role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("FORBIDDEN", "Marketing rahbari rolini bu jarayon orqali o‘zgartirib bo‘lmaydi.");
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
      throw new ApplicationError("FORBIDDEN", "Jamoa a’zoligini faqat Marketing rahbari boshqara oladi.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "Foydalanuvchi topilmadi.");
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
      throw new ApplicationError("FORBIDDEN", "Jamoa a’zoligini faqat Marketing rahbari boshqara oladi.");
    }
    if (actor.id === userId) {
      throw new ApplicationError("FORBIDDEN", "O‘zingizni jamoadan chiqara olmaysiz.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "Foydalanuvchi topilmadi.");
    }
    if (!target.isActive) {
      throw new ApplicationError("CONFLICT", "Bu jamoa a’zosi allaqachon faol emas.");
    }
    if (target.role === "HEAD_OF_MARKETING") {
      throw new ApplicationError("FORBIDDEN", "Marketing rahbarini bu jarayon orqali jamoadan chiqarib bo‘lmaydi.");
    }
    const parsed = DeactivationInputSchema.parse(input);

    const tasks = await this.repository.listTasks();
    const openTasks = tasks.filter((task) => task.assigneeId === userId && isOpenTask(task));

    if (openTasks.length > 0 && parsed.openTasksAction === "REASSIGN") {
      const newAssignee = await this.repository.getUserById(parsed.reassignToUserId!);
      if (!newAssignee?.isActive) {
        throw new ApplicationError("INVALID_INPUT", "Vazifalar o‘tkaziladigan foydalanuvchi faol jamoa a’zosi bo‘lishi kerak.");
      }
      if (newAssignee.id === userId) {
        throw new ApplicationError("INVALID_INPUT", "Vazifalarni o‘tkazish uchun boshqa jamoa a’zosini tanlang.");
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
          reason: "Mas’ul jamoadan chiqarildi",
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
      throw new ApplicationError("FORBIDDEN", "Jamoa a’zoligini faqat Marketing rahbari boshqara oladi.");
    }
    const target = await this.repository.getUserById(userId);
    if (!target) {
      throw new ApplicationError("NOT_FOUND", "Foydalanuvchi topilmadi.");
    }
    if (target.isActive) {
      throw new ApplicationError("CONFLICT", "Bu jamoa a’zosi allaqachon faol.");
    }
    if (!target.deactivatedAt) {
      throw new ApplicationError("INVALID_INPUT", "Bu foydalanuvchi avval faol a’zo bo‘lmagan — uni faollashtiring.");
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
      throw new ApplicationError("INVALID_INPUT", "Mas’ul faol jamoa a’zosi bo‘lishi kerak.");
    }
    return this.createTaskWithAssignee(actor, assignee, parsed, sourceTelegramUpdateId);
  }

  async createTaskQueued(actor: User, input: unknown): Promise<BrowserTaskCreationResult> {
    if (!this.notificationQueue) throw new Error("Notification queue is not configured.");
    const parsed = BrowserCreateTaskInputSchema.parse(input);
    const assignee = await this.repository.getUserById(parsed.assigneeId);
    if (!assignee?.isActive) {
      throw new ApplicationError("INVALID_INPUT", "Mas’ul faol jamoa a’zosi bo‘lishi kerak.");
    }
    if (parsed.videoBrief && assignee.role !== "OPERATOR_VIDEO_EDITOR") {
      throw new ApplicationError("INVALID_INPUT", "Video vazifasi video operatorga biriktirilishi kerak.");
    }
    if (parsed.videoBrief?.kind === "SHOOT" && Date.parse(parsed.videoBrief.scheduledAt) <= Date.now()) {
      throw new ApplicationError("INVALID_INPUT", "Syomka vaqti kelajakda bo‘lishi kerak.");
    }
    const requestHash = createHash("sha256").update(JSON.stringify({
      creatorId: actor.id, assigneeId: assignee.id, title: parsed.title,
      description: parsed.description ?? "", priority: parsed.priority, deadline: parsed.deadline,
      videoBrief: parsed.videoBrief ?? null, taskTemplate: parsed.taskTemplate ?? null,
      manualCheckpoints: parsed.manualCheckpoints ?? [],
    })).digest("hex");
    const requestId = parsed.clientRequestId ?? randomUUID();
    const task = await this.repository.createBrowserTask({
      requestId, requestHash,
      creatorId: actor.id, assigneeId: assignee.id, title: parsed.title,
      description: parsed.description, priority: parsed.priority, deadline: parsed.deadline,
      manualCheckpoints: parsed.manualCheckpoints ?? [],
      ...(parsed.taskTemplate ? { taskTemplate: parsed.taskTemplate } : {}),
      ...(parsed.videoBrief ? { videoBrief: { kind: parsed.videoBrief.kind, brief: parsed.videoBrief } } : {}),
    });
    // The request row is the durable notification intent. The route's after()
    // callback sends it immediately; the five-minute cron recovers crashes.
    return { task, assignee, notification: { status: "QUEUED" } };
  }

  /**
   * Resolves the assignee by username exactly once, then hands the already-
   * validated User straight to task creation — createTask (the Mini App's
   * by-id path) must never be asked to re-resolve the same person a second
   * time. A second, redundant lookup was the confirmed root cause of an
   * intermittent "assignee not found" report: it doubled the exposure to any
   * single slow/failed read for no benefit, since the first read had already
   * proven the assignee's identity.
   */
  async createTaskForUsername(
    actor: User,
    input: Omit<z.input<typeof CreateTaskInputSchema>, "assigneeId"> & { assigneeUsername: string },
    sourceTelegramUpdateId?: number,
  ): Promise<TaskCreationResult> {
    const assignee = await this.resolveActiveAssigneeByUsername(input.assigneeUsername);
    const parsed = CreateTaskInputSchema.parse({
      title: input.title,
      assigneeId: assignee.id,
      deadline: input.deadline,
      priority: input.priority,
      description: input.description,
    });
    return this.createTaskWithAssignee(actor, assignee, parsed, sourceTelegramUpdateId);
  }

  /**
   * Distinguishes a genuinely unknown username from one that exists but is
   * currently inactive — the two need different, specific messages rather
   * than one generic "not found" that could just as easily describe a typo
   * or a teammate Head hasn't reactivated yet.
   */
  private async resolveActiveAssigneeByUsername(username: string): Promise<User> {
    const user = await this.repository.findUserByUsername(username);
    if (!user) {
      throw new ApplicationError("INVALID_INPUT", `@${username} aktiv jamoa a'zolari orasida topilmadi.`);
    }
    if (!user.isActive) {
      throw new ApplicationError("INVALID_INPUT", `@${username} hozir aktiv jamoa a'zosi emas.`);
    }
    return user;
  }

  private async createTaskWithAssignee(
    actor: User,
    assignee: User,
    parsed: z.infer<typeof CreateTaskInputSchema>,
    sourceTelegramUpdateId?: number,
  ): Promise<TaskCreationResult> {
    const task = await this.persistTaskWithAssignee(actor, assignee, parsed, sourceTelegramUpdateId);

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

  private persistTaskWithAssignee(
    actor: User,
    assignee: User,
    parsed: z.infer<typeof CreateTaskInputSchema>,
    sourceTelegramUpdateId?: number,
  ): Promise<Task> {
    return this.repository.createTask({
      creatorId: actor.id,
      assigneeId: assignee.id,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      deadline: parsed.deadline,
      sourceTelegramUpdateId,
    });
  }

  /**
   * Bulk creation for one Telegram message containing several `---`
   * -separated task blocks. Each block is already independently parsed and
   * validated by the shared shorthand parser before this runs; this method
   * only handles resolving/creating/notifying, one block at a time, so a
   * failure on one block can never affect another. Idempotency is per block:
   * callers pass a distinct `sourceTelegramUpdateId` per block (a
   * deterministic function of the real Telegram update id and the block's
   * position), reusing the same unique-constraint mechanism that already
   * protects a single task from a duplicated webhook delivery.
   *
   * Notifications are grouped per assignee: someone who receives exactly one
   * task from the batch gets the normal individual message; someone who
   * receives more than one gets a single combined message instead of one
   * per task. This never affects task creation itself — every block is
   * created and audited through the same `repository.createTask` call as a
   * single task would be, whether or not its notification ends up grouped.
   */
  async createTasksBulk(
    actor: User,
    blocks: ReadonlyArray<Omit<z.input<typeof CreateTaskInputSchema>, "assigneeId"> & { assigneeUsername: string }>,
    baseSourceTelegramUpdateId: number,
  ): Promise<BulkTaskCreationOutcome[]> {
    const outcomes: BulkTaskCreationOutcome[] = [];
    const perAssignee = new Map<string, Array<{ task: Task; assignee: User }>>();

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      try {
        const assignee = await this.resolveActiveAssigneeByUsername(block.assigneeUsername);
        const parsed = CreateTaskInputSchema.parse({
          title: block.title,
          assigneeId: assignee.id,
          deadline: block.deadline,
          priority: block.priority,
          description: block.description,
        });
        const task = await this.repository.createTask({
          creatorId: actor.id,
          assigneeId: assignee.id,
          title: parsed.title,
          description: parsed.description,
          priority: parsed.priority,
          deadline: parsed.deadline,
          sourceTelegramUpdateId: bulkBlockUpdateId(baseSourceTelegramUpdateId, index),
        });
        outcomes.push({ index, status: "CREATED", task, assignee });
        const group = perAssignee.get(assignee.id) ?? [];
        group.push({ task, assignee });
        perAssignee.set(assignee.id, group);
      } catch (error) {
        // One invalid/failing block must never abort the rest of the batch —
        // each block is independently validated and created.
        const message = error instanceof ApplicationError
          ? error.message
          : error instanceof z.ZodError
            ? (error.issues[0]?.message ?? "Vazifa formati noto‘g‘ri.")
            : "Vazifani yaratib bo‘lmadi.";
        outcomes.push({ index, status: "FAILED", errorMessage: message });
      }
    }

    for (const group of perAssignee.values()) {
      const assignee = group[0].assignee;
      try {
        const notification = group.length === 1
          ? await this.notificationDispatcher.notifyAssignment({ task: group[0].task, creator: actor, assignee })
          : await this.notificationDispatcher.notifyBulkAssignment({
              tasks: group.map((entry) => entry.task),
              creator: actor,
              assignee,
            });
        const log = {
          event: notification.status === "SENT" ? "task_assignment_notification_sent" : "task_assignment_notification_failed",
          taskIds: group.map((entry) => entry.task.id),
          batched: group.length > 1,
          ...(notification.status === "FAILED" ? { reason: notification.reason } : {}),
        };
        if (notification.status === "SENT") console.info(JSON.stringify(log));
        else console.warn(JSON.stringify(log));
      } catch {
        console.warn(JSON.stringify({
          event: "task_assignment_notification_failed",
          taskIds: group.map((entry) => entry.task.id),
          batched: group.length > 1,
          reason: "DISPATCH_FAILED",
        }));
      }
    }

    return outcomes;
  }

  async listTasks(actor: User, scope: TaskScope = "my", now = new Date()): Promise<Task[]> {
    if (scope === "team" && !isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Jamoaning barcha vazifalarini faqat Marketing rahbari ko‘ra oladi.");
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

  listHomeTasks(actor: User): Promise<Task[]> {
    return this.repository.listHomeTasks(isHead(actorFromUser(actor)) ? undefined : actor.id);
  }

  async listTaskPage(actor: User, scope: TaskScope = "my", input: unknown = {}, now = new Date()) {
    if (scope === "team" && !isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Jamoaning barcha vazifalarini faqat Marketing rahbari ko‘ra oladi.");
    }
    const parsed = TaskPageInputSchema.parse(input);
    const head = isHead(actorFromUser(actor));
    let deadlineFrom: string | undefined;
    let deadlineBefore: string | undefined;
    let createdBefore: string | undefined;
    let completedFrom: string | undefined;
    let completedBefore: string | undefined;
    let reportStatus: Task["status"] | undefined;
    let excludeTerminal = false;
    if (scope === "overdue") {
      deadlineBefore = now.toISOString();
      excludeTerminal = true;
    } else if (scope === "today") {
      const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
      const start = Date.UTC(
        tashkentNow.getUTCFullYear(),
        tashkentNow.getUTCMonth(),
        tashkentNow.getUTCDate(),
      ) - 5 * 60 * 60 * 1000;
      deadlineFrom = new Date(start).toISOString();
      deadlineBefore = new Date(start + 24 * 60 * 60 * 1000).toISOString();
    } else if (parsed.deadlineRange === "overdue") {
      deadlineBefore = now.toISOString();
      excludeTerminal = true;
    } else if (parsed.deadlineRange === "today") {
      const tashkentNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
      const start = Date.UTC(tashkentNow.getUTCFullYear(), tashkentNow.getUTCMonth(), tashkentNow.getUTCDate()) - 5 * 60 * 60 * 1000;
      deadlineFrom = new Date(start).toISOString();
      deadlineBefore = new Date(start + 24 * 60 * 60 * 1000).toISOString();
    } else if (parsed.deadlineRange === "next_7_days") {
      deadlineFrom = now.toISOString();
      deadlineBefore = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    if (parsed.reportView) {
      const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      if (parsed.reportView === "open") excludeTerminal = true;
      if (parsed.reportView === "completed") {
        reportStatus = "DONE";
        completedFrom = periodStart;
        completedBefore = now.toISOString();
      }
      if (parsed.reportView === "carry_over") {
        createdBefore = periodStart;
        excludeTerminal = true;
      }
      if (parsed.reportView === "overdue") {
        deadlineBefore = now.toISOString();
        excludeTerminal = true;
      }
    }

    const page = await this.repository.listTaskPage({
      visibleToUserId: scope === "my" || (!head && scope !== "created") ? actor.id : undefined,
      status: reportStatus ?? (scope === "review" ? "REVIEW" : parsed.status),
      priority: parsed.priority,
      assigneeId: parsed.reportView && scope === "my" ? actor.id : parsed.assigneeId,
      creatorId: scope === "created" ? actor.id : undefined,
      deadlineFrom,
      deadlineBefore,
      createdBefore,
      completedFrom,
      completedBefore,
      excludeTerminal,
      search: parsed.search,
      sort: parsed.sort,
      limit: parsed.pageSize,
      cursor: decodeTaskCursor(parsed.cursor, parsed.sort),
    });
    const last = page.tasks.at(-1);
    return {
      tasks: page.tasks,
      pagination: {
        pageSize: parsed.pageSize,
        hasMore: page.hasMore,
        nextCursor: page.hasMore && last ? encodeTaskCursor(last, parsed.sort) : null,
      },
    };
  }

  async getTaskDetails(actor: User, taskId: string) {
    const task = await this.requireVisibleTask(actor, taskId);
    const [events, comments, requests, postingChecklist, recurringDefinition, personalPlan, checkpoints, workflowPlan, videoBrief, taskTemplate] = await Promise.all([
      this.repository.listTaskEvents(taskId),
      this.repository.listTaskComments(taskId),
      this.repository.listDeadlineChangeRequests({ taskId }),
      this.repository.getPostingChecklist(taskId),
      this.repository.getRecurringDefinitionForTask(taskId, task.recurringDefinitionId ?? null),
      this.repository.getUserTaskPlan(actor.id, taskId),
      this.repository.listTaskCheckpoints(taskId),
      task.workflowRunId ? this.repository.getWorkflowPlan(task.workflowRunId) : Promise.resolve(null),
      this.repository.getTaskVideoBrief(taskId),
      this.repository.getTaskTemplateInstance(taskId),
    ]);
    return {
      task,
      events,
      comments,
      deadlineRequests: requests,
      postingChecklist,
      recurringDefinition,
      personalPlan,
      checkpoints,
      workflowPlan,
      videoBrief,
      taskTemplate,
    };
  }

  async saveVideoBrief(actor: User, taskId: string, input: unknown) {
    const parsed = VideoBriefInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    if (task.status === "DONE" || task.status === "CANCELLED") {
      throw new ApplicationError("CONFLICT", "Yopilgan vazifa brifini o‘zgartirib bo‘lmaydi.");
    }
    const assignee = await this.repository.getUserById(task.assigneeId);
    if (assignee?.role !== "OPERATOR_VIDEO_EDITOR") {
      throw new ApplicationError("INVALID_INPUT", "Video vazifasi video operatorga biriktirilishi kerak.");
    }
    const existingBrief = await this.repository.getTaskVideoBrief(taskId);
    if (!existingBrief || existingBrief.kind !== parsed.kind) {
      throw new ApplicationError("CONFLICT", "Video turi vazifa yaratilayotganda tanlanadi.");
    }
    if (actor.role !== "HEAD_OF_MARKETING" && actor.id !== task.creatorId &&
      !(parsed.kind === "EDIT" && actor.id === task.assigneeId)) {
      throw new ApplicationError("FORBIDDEN", "Bu brifni tahrirlashga ruxsatingiz yo‘q.");
    }
    if (parsed.kind === "SHOOT" && Date.parse(parsed.scheduledAt) <= Date.now()) {
      throw new ApplicationError("INVALID_INPUT", "Syomka vaqti kelajakda bo‘lishi kerak.");
    }
    const { kind, ...brief } = parsed;
    const saved = await this.repository.saveTaskVideoBrief({ taskId, actorId: actor.id, kind, brief, confirm: false });
    if (parsed.kind === "SHOOT" && existingBrief.scenarioUrl !== saved.scenarioUrl && saved.scenarioUrl) {
      try {
        await this.notificationQueue?.queueShootScenario?.({ task, scenarioUrl: saved.scenarioUrl,
          changeToken: saved.updatedAt });
      } catch {
        console.error(JSON.stringify({ event: "shoot_scenario_enqueue_failed", taskId }));
      }
    }
    return saved;
  }

  async confirmShoot(actor: User, taskId: string) {
    const task = await this.requireVisibleTask(actor, taskId);
    if (actor.id !== task.assigneeId || actor.role !== "OPERATOR_VIDEO_EDITOR") {
      throw new ApplicationError("FORBIDDEN", "Syomkani faqat mas’ul operator tasdiqlaydi.");
    }
    return this.repository.saveTaskVideoBrief({ taskId, actorId: actor.id, kind: "SHOOT", brief: {}, confirm: true });
  }

  listPersonalPlans(actor: User) {
    return this.repository.listUserTaskPlans(actor.id);
  }

  listTodaysCheckpoints(actor: User, now = new Date()) {
    const day = tashkentDayRange(now);
    return this.repository.listUserCheckpointsDueBetween(actor.id, day.start.toISOString(), day.end.toISOString());
  }

  async savePersonalPlan(actor: User, taskId: string, input: unknown) {
    const parsed = PersonalPlanInputSchema.parse(input);
    await this.requireVisibleTask(actor, taskId);
    return this.repository.saveUserTaskPlan({ userId: actor.id, taskId, ...parsed });
  }

  async addCheckpoint(actor: User, taskId: string, input: unknown) {
    const parsed = CheckpointInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    if (task.status === "DONE" || task.status === "CANCELLED") {
      throw new ApplicationError("CONFLICT", "Yopilgan vazifaga checkpoint qo‘shib bo‘lmaydi.");
    }
    if (actor.role !== "HEAD_OF_MARKETING" && task.creatorId !== actor.id && task.assigneeId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Checkpointni faqat mas’ul yoki yaratuvchi o‘zgartira oladi.");
    }
    return this.repository.addTaskCheckpoint({ taskId, actorId: actor.id, title: parsed.title, dueAt: parsed.dueAt ?? null });
  }

  async toggleCheckpoint(actor: User, id: string) {
    const checkpoint = await this.repository.getTaskCheckpoint(id);
    if (!checkpoint) throw new ApplicationError("NOT_FOUND", "Checkpoint topilmadi.");
    const task = await this.requireVisibleTask(actor, checkpoint.taskId);
    if (actor.role !== "HEAD_OF_MARKETING" && task.creatorId !== actor.id && task.assigneeId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Checkpointni faqat mas’ul yoki yaratuvchi o‘zgartira oladi.");
    }
    return this.repository.toggleTaskCheckpoint({ id, actorId: actor.id });
  }

  async setCheckpointDue(actor: User, id: string, input: unknown) {
    const { dueAt } = z.object({ dueAt: z.string().datetime({ offset: true }).nullable() }).strict().parse(input);
    const checkpoint = await this.repository.getTaskCheckpoint(id);
    if (!checkpoint) throw new ApplicationError("NOT_FOUND", "Checkpoint topilmadi.");
    const task = await this.requireVisibleTask(actor, checkpoint.taskId);
    if (actor.role !== "HEAD_OF_MARKETING" && task.creatorId !== actor.id && task.assigneeId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Checkpointni faqat mas’ul yoki yaratuvchi o‘zgartira oladi.");
    }
    return this.repository.setTaskCheckpointDue({ id, actorId: actor.id, dueAt });
  }

  async removeCheckpoint(actor: User, id: string) {
    const checkpoint = await this.repository.getTaskCheckpoint(id);
    if (!checkpoint) throw new ApplicationError("NOT_FOUND", "Checkpoint topilmadi.");
    const task = await this.requireVisibleTask(actor, checkpoint.taskId);
    if (actor.role !== "HEAD_OF_MARKETING" && task.creatorId !== actor.id && task.assigneeId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Checkpointni faqat mas’ul yoki yaratuvchi o‘zgartira oladi.");
    }
    await this.repository.removeTaskCheckpoint({ id, actorId: actor.id });
    return { ok: true };
  }

  async updateTask(actor: User, taskId: string, input: unknown): Promise<Task> {
    const parsed = UpdateTaskInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    const actorContext = actorFromUser(actor);
    const access = taskAccess(task);
    const requestedFields: Array<readonly [boolean, Parameters<typeof canEditTask>[2]]> = [
      [parsed.title !== undefined, "title"],
      [parsed.description !== undefined, "description"],
      [parsed.priority !== undefined, "priority"],
      [parsed.deadline !== undefined, "deadline"],
      [parsed.assigneeId !== undefined, "assignee"],
      [parsed.publicationAt !== undefined, "publicationAt"],
    ];
    if (requestedFields.some(([requested, field]) => requested && !canEditTask(actorContext, access, field))) {
      throw new ApplicationError("FORBIDDEN", "Bu vazifa maydonini o‘zgartirishga ruxsatingiz yo‘q.");
    }
    if (parsed.assigneeId !== undefined) {
      const assignee = await this.repository.getUserById(parsed.assigneeId);
      if (!assignee?.isActive) {
        throw new ApplicationError("INVALID_INPUT", "Mas’ul faol jamoa a’zosi bo‘lishi kerak.");
      }
    }
    return this.repository.updateTask({
      taskId,
      actorId: actor.id,
      patch: parsed,
    });
  }

  async listTaskComments(actor: User, taskId: string) {
    await this.requireVisibleTask(actor, taskId);
    return this.repository.listTaskComments(taskId);
  }

  async addTaskComment(actor: User, taskId: string, input: unknown) {
    const parsed = AddTaskCommentInputSchema.parse(input);
    await this.requireVisibleTask(actor, taskId);
    return this.repository.addTaskComment({
      taskId,
      authorId: actor.id,
      kind: parsed.kind,
      body: parsed.body,
      attachmentUrl: parsed.attachmentUrl,
    });
  }

  getNotificationPreferences(actor: User) {
    return this.repository.getNotificationPreferences(actor.id);
  }

  async updateNotificationPreferences(actor: User, input: unknown) {
    const patch = NotificationPreferencesPatchSchema.parse(input);
    const current = await this.repository.getNotificationPreferences(actor.id);
    return this.repository.updateNotificationPreferences(actor.id, { ...current, ...patch });
  }

  async performTaskAction(
    actor: User,
    taskId: string,
    input: unknown,
    options: { deferNotifications?: boolean } = {},
  ): Promise<Task> {
    const action = TaskActionInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    if (action.action === "SUBMIT_REVIEW" && task.creatorId === actor.id && task.assigneeId === actor.id) {
      return this.performTaskAction(actor, taskId, { ...action, action: "COMPLETE_SELF" }, options);
    }
    const actorContext = actorFromUser(actor);
    const access = taskAccess(task);

    if (!canTransition(task.status, action.action)) {
      throw new ApplicationError("CONFLICT", `${action.action} amali vazifaning ${task.status} holatida bajarilmaydi.`);
    }

    const assigneeAction = ["ACCEPT", "BLOCK", "RESUME", "SUBMIT_REVIEW", "COMPLETE_SELF"].includes(action.action);
    const reviewerAction = ["APPROVE", "REQUEST_REVISION"].includes(action.action);
    if (assigneeAction && !isAssignee(actorContext, access)) {
      throw new ApplicationError("FORBIDDEN", "Bu amalni faqat vazifa mas’uli bajara oladi.");
    }
    if (reviewerAction && !isHead(actorContext) && !isCreator(actorContext, access)) {
      throw new ApplicationError("FORBIDDEN", "Vazifani faqat yaratuvchi yoki Marketing rahbari tekshira oladi.");
    }
    if (action.action === "COMPLETE_SELF" && (task.creatorId !== actor.id || task.assigneeId !== actor.id)) {
      throw new ApplicationError("FORBIDDEN", "Vazifani faqat yaratuvchi va mas’ul bir odam bo‘lsa bevosita tasdiqlash mumkin.");
    }
    const workflowPlan = task.workflowRunId && ["SUBMIT_REVIEW", "COMPLETE_SELF"].includes(action.action)
      ? await this.repository.getWorkflowPlan(task.workflowRunId) : null;
    const isNewWorkflow = Boolean(workflowPlan);
    const hasNextStep = workflowPlan?.steps.some((step) => step.position > workflowPlan.currentPosition) ?? false;
    if (["SUBMIT_REVIEW", "COMPLETE_SELF"].includes(action.action) && hasNextStep &&
      (!action.nextDeadline || Date.parse(action.nextDeadline) <= Date.now())) {
      throw new ApplicationError("INVALID_INPUT", "Keyingi bosqichning aniq muddatini ilovada belgilang.");
    }

    if (action.action === "SUBMIT_REVIEW" || action.action === "COMPLETE_SELF") {
      const videoBrief = await this.repository.getTaskVideoBrief(taskId);
      if (videoBrief?.kind === "SHOOT" && !videoBrief.confirmedAt) {
        throw new ApplicationError("INVALID_INPUT", "Syomka vaqtini operator tasdiqlashi kerak.");
      }
      if (videoBrief?.kind === "EDIT" && !videoBrief.editLevel) {
        throw new ApplicationError("INVALID_INPUT", "Montaj darajasini tanlang.");
      }
      const checklist = await this.repository.getPostingChecklist(taskId);
      if (checklist && checklist.items.some((item) => !item.isCompleted)) {
        throw new ApplicationError("INVALID_INPUT", "Tekshiruvga yuborishdan oldin joylash ro‘yxatidagi barcha bandlarni bajaring.");
      }
    }
    if (action.action === "CANCEL" && !isHead(actorContext) && !isCreator(actorContext, access)) {
      throw new ApplicationError("FORBIDDEN", "Vazifani faqat yaratuvchi yoki Marketing rahbari bekor qila oladi.");
    }
    if (action.action === "REOPEN" && !isHead(actorContext)) {
      throw new ApplicationError("FORBIDDEN", "Vazifani faqat Marketing rahbari qayta ocha oladi.");
    }

    const transitionedTask = action.action === "COMPLETE_SELF"
      ? await this.repository.completeSelfOwnedTask({ taskId, actorId: actor.id, nextDeadline: action.nextDeadline ?? null })
      : action.action === "SUBMIT_REVIEW" && isNewWorkflow
        ? await this.repository.submitWorkflowStepForReview({ taskId, actorId: actor.id, nextDeadline: action.nextDeadline ?? null })
        : await this.repository.transitionTask({
          taskId, actorId: actor.id, newStatus: statusForAction(action.action), reason: action.reason,
        });

    if (action.action === "ACCEPT") {
      // Browser actions also confirm the result to the actor's bot chat.
      if (task.creatorId !== actor.id || options.deferNotifications) {
        await this.dispatchWorkflowNotification(
          { event: "TASK_ACCEPTED", task: transitionedTask, actor },
          [task.creatorId, ...(options.deferNotifications ? [actor.id] : [])],
          false,
          options.deferNotifications,
        );
      }
    } else if (action.action === "SUBMIT_REVIEW") {
      await this.dispatchWorkflowNotification(
        { event: "REVIEW_REQUESTED", task: transitionedTask, actor },
        [task.creatorId],
        true,
        options.deferNotifications,
      );
      if (options.deferNotifications && actor.id !== task.creatorId && actor.role !== "HEAD_OF_MARKETING") {
        await this.dispatchWorkflowNotification(
          { event: "REVIEW_SUBMITTED", task: transitionedTask, actor },
          [actor.id], false, true,
        );
      }
    } else if (action.action === "APPROVE" || action.action === "COMPLETE_SELF") {
      await this.dispatchWorkflowNotification(
        { event: "TASK_COMPLETED", task: transitionedTask, actor },
        [task.assigneeId, ...(options.deferNotifications ? [task.creatorId, actor.id] : [])],
        false,
        options.deferNotifications,
      );
      if (transitionedTask.workflowRunId) {
        try {
          const nextTask = await this.repository.advanceWorkflowRun({ completedTaskId: taskId, actorId: actor.id });
          if (nextTask) {
            if (options.deferNotifications && this.notificationQueue) {
              const assignee = await this.repository.getUserById(nextTask.assigneeId);
              const creator = await this.repository.getUserById(nextTask.creatorId);
              if (assignee?.isActive) {
                await this.notificationQueue.queueAssignment({ task: nextTask, assignee, creator: creator ?? actor });
              }
              if (nextTask.participantIds?.length) {
                await this.dispatchWorkflowNotification(
                  { event: "WORKFLOW_STEP_ACTIVATED", task: nextTask, actor },
                  nextTask.participantIds, false, true,
                );
              }
            } else {
              await this.notifyGeneratedWorkflowTask(nextTask, actor);
            }
          }
        } catch {
          // The task completion itself remains valid. A five-minute recovery
          // sweep advances any workflow left between steps after a transient
          // database/Telegram failure.
          console.warn(JSON.stringify({ event: "workflow_advance_deferred", taskId }));
        }
      }
    } else if (action.action === "REQUEST_REVISION") {
      await this.dispatchWorkflowNotification(
        { event: "REVISION_REQUESTED", task: transitionedTask, actor, comment: action.reason },
        [task.assigneeId, ...(options.deferNotifications ? [actor.id] : [])],
        false,
        options.deferNotifications,
      );
    } else if (action.action === "BLOCK") {
      await this.dispatchWorkflowNotification(
        { event: "TASK_BLOCKED", task: transitionedTask, actor, comment: action.reason },
        [task.creatorId, ...(options.deferNotifications ? [actor.id] : [])],
        true,
        options.deferNotifications,
      );
    } else if (options.deferNotifications) {
      await this.dispatchWorkflowNotification(
        { event: "TASK_STATUS_UPDATED", task: transitionedTask, actor },
        [task.creatorId, task.assigneeId, actor.id], false, true,
      );
    }

    return transitionedTask;
  }

  async togglePostingChecklistItem(actor: User, itemId: string) {
    const checklist = await this.repository.getPostingChecklistByItemId(itemId);
    if (!checklist) throw new ApplicationError("NOT_FOUND", "Joylash ro‘yxati bandi topilmadi.");
    const task = await this.requireVisibleTask(actor, checklist.taskId);
    if (task.assigneeId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Joylash ro‘yxatini faqat vazifa mas’uli yangilay oladi.");
    }
    await this.repository.togglePostingChecklistItem({ itemId, actorId: actor.id });
    return this.repository.getPostingChecklist(checklist.taskId);
  }

  async togglePostingChecklistItemFast(actor: User, itemId: string) {
    if (!actor.isActive) throw new ApplicationError("UNAUTHENTICATED", "Aktiv jamoa a’zosi bo‘lishingiz kerak.");
    // The atomic RPC verifies the active assignee, task status, and item ID.
    // Returning its updated row avoids six extra database reads for one tap.
    return this.repository.togglePostingChecklistItem({ itemId, actorId: actor.id });
  }

  listWorkflowTemplates(actor: User) {
    if (!actor.isActive) throw new ApplicationError("UNAUTHENTICATED", "Aktiv jamoa a’zosi bo‘lishingiz kerak.");
    return this.repository.listWorkflowTemplates();
  }

  listTaskTemplates(actor: User) {
    if (!actor.isActive) throw new ApplicationError("UNAUTHENTICATED", "Aktiv jamoa a’zosi bo‘lishingiz kerak.");
    return this.repository.listTaskTemplates();
  }

  async saveTaskTemplate(actor: User, input: unknown) {
    if (!actor.isActive || !isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Shablonni faqat Marketing rahbari sozlay oladi.");
    }
    const parsed = SaveTaskTemplateSchema.parse(input);
    return { id: await this.repository.saveTaskTemplateVersion({ actorId: actor.id, ...parsed }) };
  }

  async archiveTaskTemplate(actor: User, id: string) {
    if (!actor.isActive || !isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Shablonni faqat Marketing rahbari arxivlay oladi.");
    }
    if (!await this.repository.archiveTaskTemplate({ actorId: actor.id, templateId: z.string().uuid().parse(id) })) {
      throw new ApplicationError("NOT_FOUND", "Faol shablon topilmadi.");
    }
    return { ok: true };
  }

  async rebaseTaskTemplateEvent(actor: User, taskId: string, input: unknown) {
    const { eventOn } = z.object({ eventOn: z.iso.date() }).strict().parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    if (actor.role !== "HEAD_OF_MARKETING" && task.creatorId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Tadbir sanasini faqat yaratuvchi yoki rahbar o‘zgartiradi.");
    }
    await this.repository.rebaseTaskTemplateEvent({ taskId, actorId: actor.id, eventOn });
    return this.getTaskDetails(actor, taskId);
  }

  async archiveWorkflowTemplate(actor: User, id: string) {
    if (!actor.isActive || !isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Shablonni faqat Marketing rahbari arxivlay oladi.");
    }
    const templateId = z.string().uuid().parse(id);
    if (!await this.repository.archiveWorkflowTemplate(templateId)) {
      throw new ApplicationError("NOT_FOUND", "Faol shablon topilmadi.");
    }
    return { ok: true };
  }

  async saveWorkflowTemplate(actor: User, input: unknown) {
    if (!actor.isActive || !isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Shablonni faqat Marketing rahbari sozlay oladi.");
    }
    const parsed = SaveWorkflowTemplateInputSchema.parse(input);
    const id = await this.repository.saveWorkflowTemplateVersion({ actorId: actor.id, ...parsed });
    return { id };
  }

  async startWorkflow(actor: User, input: unknown) {
    if (!isHead(actorFromUser(actor))) {
      throw new ApplicationError("FORBIDDEN", "Workflow’ni faqat Marketing rahbari boshlashi mumkin.");
    }
    const parsed = StartWorkflowInputSchema.parse(input);
    if (Date.parse(parsed.firstDeadline) <= Date.now()) {
      throw new ApplicationError("INVALID_INPUT", "Birinchi bosqich muddati kelajakda bo‘lishi kerak.");
    }
    const template = (await this.repository.listWorkflowTemplates()).find((item) => item.id === parsed.templateId);
    if (!template || template.steps.length !== Object.keys(parsed.stepAssignments).length ||
      template.steps.some((step) => !parsed.stepAssignments[step.id]?.ownerId)) {
      throw new ApplicationError("INVALID_INPUT", "Har bir bosqich uchun mas’ulni tanlang.");
    }
    const involvedIds = [...new Set(Object.values(parsed.stepAssignments).flatMap((step) => [step.ownerId, ...step.participantIds]))];
    const involved = await Promise.all(involvedIds.map((id) => this.repository.getUserById(id)));
    if (involved.some((user) => !user?.isActive)) {
      throw new ApplicationError("INVALID_INPUT", "Bosqich mas’uli va ishtirokchilari faol bo‘lishi kerak.");
    }
    const involvedById = new Map(involved.filter((user): user is User => Boolean(user)).map((user) => [user.id, user]));
    if (template.steps.some((step) => step.videoKind &&
      involvedById.get(parsed.stepAssignments[step.id].ownerId)?.role !== "OPERATOR_VIDEO_EDITOR")) {
      throw new ApplicationError("INVALID_INPUT", "Syomka va montaj bosqichi mas’uli video operator bo‘lishi kerak.");
    }
    const task = await this.repository.startWorkflowRun({
      templateId: parsed.templateId,
      actorId: actor.id,
      subject: parsed.subject,
      firstDeadline: parsed.firstDeadline,
      stepAssignments: parsed.stepAssignments,
    });
    const notification = await this.notifyGeneratedWorkflowTask(task, actor);
    const summary = template.steps.map((step) => `${step.position}. ${step.title}`).join("\n").slice(0, 3000);
    await this.dispatchWorkflowNotification(
      { event: "WORKFLOW_PLAN_SHARED", task, actor, comment: summary }, involvedIds, false, Boolean(this.notificationQueue),
    );
    return { task, notification };
  }

  listWorkflowPlans(actor: User) {
    return this.repository.listWorkflowPlans(actor.id, actor.role === "HEAD_OF_MARKETING");
  }

  async recoverWorkflowRuns() {
    const tasks = await this.repository.recoverWorkflowRuns();
    for (const task of tasks) await this.notifyGeneratedWorkflowTask(task);
    return { advanced: tasks.length, taskIds: tasks.map((task) => task.id) };
  }

  private async notifyGeneratedWorkflowTask(task: Task, fallbackCreator?: User) {
    const [creator, assignee] = await Promise.all([
      this.repository.getUserById(task.creatorId),
      this.repository.getUserById(task.assigneeId),
    ]);
    if (!assignee?.isActive) return { status: "FAILED" as const, reason: "ASSIGNEE_NOT_ONBOARDED" as const };
    const result = await this.notificationDispatcher.notifyAssignment({
      task,
      creator: creator ?? fallbackCreator ?? assignee,
      assignee,
    });
    if (task.participantIds?.length) {
      await this.dispatchWorkflowNotification(
        { event: "WORKFLOW_STEP_ACTIVATED", task, actor: creator ?? fallbackCreator ?? assignee },
        task.participantIds, false, Boolean(this.notificationQueue),
      );
    }
    return result;
  }

  async createRecurrence(actor: User, taskId: string, input: unknown, now = new Date()) {
    const parsed = RecurrenceInputSchema.parse(input);
    const task = await this.requireVisibleTask(actor, taskId);
    if (!isHead(actorFromUser(actor)) && task.creatorId !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Vazifani faqat yaratuvchi yoki Marketing rahbari takroriy qila oladi.");
    }
    if (await this.repository.getRecurringDefinitionForTask(taskId)) {
      throw new ApplicationError("CONFLICT", "Bu vazifa uchun takrorlanish allaqachon sozlangan.");
    }
    const assignee = await this.repository.getUserById(task.assigneeId);
    if (!assignee?.isActive) {
      throw new ApplicationError("INVALID_INPUT", "Hozirgi mas’ul faol jamoa a’zosi emas; avval vazifani boshqa mas’ulga o‘tkazing.");
    }
    const next = nextOccurrence(parsed, now);
    if (!next) throw new ApplicationError("INVALID_INPUT", "Takrorlanishning tugash sanasidan keyin kelgusi takror qolmaydi.");
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
    if (!definition) throw new ApplicationError("NOT_FOUND", "Takrorlanish sozlamasi topilmadi.");
    if (!isHead(actorFromUser(actor)) && definition.createdBy !== actor.id) {
      throw new ApplicationError("FORBIDDEN", "Takrorlanishni faqat yaratuvchi yoki Marketing rahbari boshqara oladi.");
    }
    if (definition.status === "STOPPED") {
      throw new ApplicationError("CONFLICT", "To‘xtatilgan takrorlanishni o‘zgartirib yoki davom ettirib bo‘lmaydi.");
    }

    const frequency = parsed.frequency ?? definition.frequency;
    const weekday = frequency === "WEEKLY" ? parsed.weekday ?? definition.weekday : null;
    const dayOfMonth = frequency === "MONTHLY" ? parsed.dayOfMonth ?? definition.dayOfMonth : null;
    const localTime = parsed.localTime ?? definition.localTime;
    const endsOn = parsed.endsOn !== undefined ? parsed.endsOn : definition.endsOn;
    if (frequency === "WEEKLY" && weekday == null) {
      throw new ApplicationError("INVALID_INPUT", "Haftalik takrorlanish uchun hafta kuni kerak.");
    }
    if (frequency === "MONTHLY" && dayOfMonth == null) {
      throw new ApplicationError("INVALID_INPUT", "Oylik takrorlanish uchun oy kuni kerak.");
    }

    let assigneeId = definition.assigneeId;
    if (parsed.assigneeId !== undefined && parsed.assigneeId !== definition.assigneeId) {
      const newAssignee = await this.repository.getUserById(parsed.assigneeId);
      if (!newAssignee?.isActive) {
        throw new ApplicationError("INVALID_INPUT", "Yangi mas’ul faol jamoa a’zosi bo‘lishi kerak.");
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
      throw new ApplicationError("FORBIDDEN", "Muddatni o‘zgartirishni faqat vazifa mas’uli so‘rashi mumkin.");
    }
    if (["DONE", "CANCELLED"].includes(task.status)) {
      throw new ApplicationError("CONFLICT", "Yakunlangan vazifa uchun yangi muddat so‘rab bo‘lmaydi.");
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
      throw new ApplicationError("NOT_FOUND", "Muddatni o‘zgartirish so‘rovi topilmadi.");
    }
    const task = await this.repository.getTask(request.taskId);
    if (!task) {
      throw new ApplicationError("NOT_FOUND", "Vazifa topilmadi.");
    }
    if (!canApproveDeadlineRequest(actorFromUser(actor), taskAccess(task))) {
      throw new ApplicationError("FORBIDDEN", "Bu so‘rovni faqat vazifa yaratuvchisi yoki Marketing rahbari hal qila oladi.");
    }
    if (request.status !== "PENDING") {
      throw new ApplicationError("CONFLICT", "Muddat so‘rovi allaqachon hal qilingan.");
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
    defer = false,
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

      if (defer && this.notificationQueue) {
        await this.notificationQueue.queueWorkflow({ ...notification, recipients });
        console.info(JSON.stringify({ event: "workflow_notification_queued", taskId: notification.task.id }));
        return;
      }

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
      throw new ApplicationError("NOT_FOUND", "Vazifa topilmadi.");
    }
    if (!isHead(actorFromUser(actor)) && task.creatorId !== actor.id && task.assigneeId !== actor.id && !task.participantIds?.includes(actor.id)) {
      throw new ApplicationError("FORBIDDEN", "Bu vazifaga kirish huquqingiz yo‘q.");
    }
    return task;
  }
}
