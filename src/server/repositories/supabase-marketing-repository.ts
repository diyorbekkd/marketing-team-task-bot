import "server-only";

import { z } from "zod";
import type {
  CreateTaskRecord,
  MarketingRepository,
  NotificationOutboxRecord,
  NotificationPreferences,
  ReminderClaim,
  TaskPageQuery,
  TelegramIdentityInput,
} from "@/application/ports/marketing-repository";
import { ApplicationError } from "@/application/errors";
import type { TeamRole } from "@/domain/permissions";
import type { TaskStatus } from "@/domain/task";
import type { ReminderType } from "@/domain/reminders";
import { canonicalTelegramUsername } from "@/domain/telegram-username";
import type {
  DeadlineChangeRequest,
  PostingChecklist,
  PostingChecklistItem,
  RecurringDefinition,
  Task,
  TaskComment,
  TaskCheckpoint,
  TaskEvent,
  User,
  UserTaskPlan,
  WorkflowTemplate,
} from "@/domain/models";
import { getSupabaseAdminClient } from "@/server/db/supabase";

const bigintValue = z.union([z.string(), z.number().int().safe()]).transform(String);

const UserRowSchema = z.object({
  id: z.string().uuid(),
  telegram_user_id: bigintValue,
  telegram_username: z.string().nullable(),
  display_name: z.string(),
  role: z.enum([
    "OPERATOR_VIDEO_EDITOR",
    "CONTENT_MARKETER",
    "DIGITAL_MARKETER",
    "SMM_MANAGER",
    "HEAD_OF_MARKETING",
  ]),
  is_active: z.boolean(),
  deactivated_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

const TaskRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(["high", "normal", "low"]),
  status: z.enum(["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION", "DONE", "CANCELLED"]),
  creator_id: z.string().uuid(),
  assignee_id: z.string().uuid(),
  deadline: z.string(),
  publication_at: z.string().nullable().default(null),
  blocked_reason: z.string().nullable(),
  completed_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  recurring_definition_id: z.string().uuid().nullable().default(null),
  scheduled_occurrence_at: z.string().nullable().default(null),
  workflow_run_id: z.string().uuid().nullable().default(null),
  workflow_step_id: z.string().uuid().nullable().default(null),
});

const TaskCommentRowSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  author_id: z.string().uuid(),
  kind: z.enum(["COMMENT", "RESULT"]),
  body: z.string().nullable(),
  attachment_url: z.string().url().nullable(),
  created_at: z.string(),
});

const UserTaskPlanRowSchema = z.object({
  user_id: z.string().uuid(), task_id: z.string().uuid(),
  is_important: z.boolean().nullable(), urgent_override: z.boolean().nullable(),
  planned_on: z.string().nullable(), estimated_minutes: z.number().int().nullable(),
  created_at: z.string(), updated_at: z.string(),
});

const TaskCheckpointRowSchema = z.object({
  id: z.string().uuid(), task_id: z.string().uuid(), title: z.string(),
  due_at: z.string().nullable(), position: z.number().int(), created_by: z.string().uuid(),
  completed_by: z.string().uuid().nullable(), completed_at: z.string().nullable(), created_at: z.string(),
});

const NotificationOutboxRowSchema = z.object({
  id: z.string().uuid(),
  dedupe_key: z.string(),
  notification_type: z.enum(["ASSIGNMENT", "BULK_ASSIGNMENT", "WORKFLOW", "REPORT"]),
  recipient_user_id: z.string().uuid(),
  task_id: z.string().uuid().nullable(),
  payload: z.unknown(),
  status: z.enum(["PENDING", "CLAIMED", "SENT", "FAILED"]),
  attempt_count: z.number().int().nonnegative(),
});

const ReminderClaimSchema = z.object({
  claimed: z.boolean(),
  deliveries: z.array(z.object({
    recipientUserId: z.string().uuid(),
    status: z.enum(["SENT", "FAILED"]),
    reason: z.string().optional(),
  })).default([]),
});

const NotificationPreferencesRowSchema = z.object({
  assignments: z.boolean(),
  workflow: z.boolean(),
  reminders: z.boolean(),
  daily_check: z.boolean(),
  reports: z.boolean(),
});

const WorkflowTemplateRowSchema = z.object({
  id: z.string().uuid(), slug: z.string(), name: z.string(), description: z.string().nullable(),
  is_active: z.boolean(), is_system: z.boolean(),
});

const WorkflowTemplateStepRowSchema = z.object({
  id: z.string().uuid(), template_id: z.string().uuid(), position: z.number().int(),
  title: z.string(), description: z.string().nullable(),
  assignee_role: z.enum(["OPERATOR_VIDEO_EDITOR", "CONTENT_MARKETER", "DIGITAL_MARKETER", "SMM_MANAGER", "HEAD_OF_MARKETING"]),
  priority: z.enum(["high", "normal", "low"]), due_after_hours: z.number().int(),
});

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  assignments: true,
  workflow: true,
  reminders: true,
  dailyCheck: true,
  reports: true,
};

const EventRowSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  actor_kind: z.enum(["USER", "SYSTEM"]),
  event_type: z.enum([
    "TASK_CREATED", "TASK_ACCEPTED", "STATUS_CHANGED", "TITLE_CHANGED", "DESCRIPTION_CHANGED",
    "PRIORITY_CHANGED", "DEADLINE_CHANGE_REQUESTED", "DEADLINE_CHANGE_APPROVED",
    "DEADLINE_CHANGE_REJECTED", "DEADLINE_CHANGED", "REASSIGN_REQUESTED", "REASSIGN_APPROVED",
    "REASSIGN_REJECTED", "ASSIGNEE_CHANGED", "TASK_BLOCKED", "TASK_UNBLOCKED", "REVIEW_REQUESTED",
    "REVISION_REQUESTED", "TASK_COMPLETED", "TASK_CANCELLED", "TASK_REOPENED",
    "POSTING_CHECKLIST_CREATED", "POSTING_CHECKLIST_ITEM_TOGGLED", "RECURRING_TASK_GENERATED",
    "PUBLICATION_DATE_CHANGED", "COMMENT_ADDED", "RESULT_SUBMITTED", "WORKFLOW_STARTED",
    "WORKFLOW_STEP_ACTIVATED", "WORKFLOW_COMPLETED",
    "CHECKPOINT_ADDED", "CHECKPOINT_COMPLETED", "CHECKPOINT_REOPENED", "CHECKPOINT_REMOVED",
  ]),
  old_value: z.unknown(),
  new_value: z.unknown(),
  metadata: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

const DeadlineRequestRowSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  requested_by: z.string().uuid(),
  current_deadline: z.string(),
  requested_deadline: z.string(),
  reason: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]),
  resolved_by: z.string().uuid().nullable(),
  resolved_at: z.string().nullable(),
  resolution_note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const ChecklistRowSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  kind: z.literal("POSTING"),
  created_at: z.string(),
});

const ChecklistItemRowSchema = z.object({
  id: z.string().uuid(),
  checklist_id: z.string().uuid(),
  label: z.string(),
  position: z.number().int(),
  is_completed: z.boolean(),
  completed_by: z.string().uuid().nullable(),
  completed_at: z.string().nullable(),
});

const RecurringDefinitionRowSchema = z.object({
  id: z.string().uuid(), source_task_id: z.string().uuid(), created_by: z.string().uuid(),
  title: z.string(), description: z.string().nullable(), priority: z.enum(["high", "normal", "low"]),
  assignee_id: z.string().uuid(), frequency: z.enum(["WEEKDAYS", "WEEKLY", "MONTHLY"]),
  weekday: z.number().int().nullable(), day_of_month: z.number().int().nullable(), local_time: z.string(),
  timezone: z.literal("Asia/Tashkent"), ends_on: z.string().nullable(),
  status: z.enum(["ACTIVE", "PAUSED", "STOPPED"]), next_occurrence_at: z.string().nullable(),
  pause_reason: z.string().nullable().default(null),
  created_at: z.string(), updated_at: z.string(),
});

function mapUser(input: unknown): User {
  const row = UserRowSchema.parse(input);
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChecklistItem(input: unknown): PostingChecklistItem {
  const row = ChecklistItemRowSchema.parse(input);
  return {
    id: row.id, checklistId: row.checklist_id, label: row.label, position: row.position,
    isCompleted: row.is_completed, completedBy: row.completed_by, completedAt: row.completed_at,
  };
}

function mapRecurringDefinition(input: unknown): RecurringDefinition {
  const row = RecurringDefinitionRowSchema.parse(input);
  return {
    id: row.id, sourceTaskId: row.source_task_id, createdBy: row.created_by,
    title: row.title, description: row.description, priority: row.priority, assigneeId: row.assignee_id,
    frequency: row.frequency, weekday: row.weekday, dayOfMonth: row.day_of_month,
    localTime: row.local_time.slice(0, 5), timezone: row.timezone, endsOn: row.ends_on,
    status: row.status, nextOccurrenceAt: row.next_occurrence_at, pauseReason: row.pause_reason,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapTask(input: unknown): Task {
  const row = TaskRowSchema.parse(input);
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    creatorId: row.creator_id,
    assigneeId: row.assignee_id,
    deadline: row.deadline,
    publicationAt: row.publication_at,
    blockedReason: row.blocked_reason,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recurringDefinitionId: row.recurring_definition_id,
    scheduledOccurrenceAt: row.scheduled_occurrence_at,
    workflowRunId: row.workflow_run_id,
    workflowStepId: row.workflow_step_id,
  };
}

function mapTaskComment(input: unknown): TaskComment {
  const row = TaskCommentRowSchema.parse(input);
  return {
    id: row.id,
    taskId: row.task_id,
    authorId: row.author_id,
    kind: row.kind,
    body: row.body,
    attachmentUrl: row.attachment_url,
    createdAt: row.created_at,
  };
}

function mapUserTaskPlan(input: unknown): UserTaskPlan {
  const row = UserTaskPlanRowSchema.parse(input);
  return {
    userId: row.user_id, taskId: row.task_id, isImportant: row.is_important,
    urgentOverride: row.urgent_override, plannedOn: row.planned_on,
    estimatedMinutes: row.estimated_minutes, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapTaskCheckpoint(input: unknown): TaskCheckpoint {
  const row = TaskCheckpointRowSchema.parse(input);
  return {
    id: row.id, taskId: row.task_id, title: row.title, dueAt: row.due_at,
    position: row.position, createdBy: row.created_by, completedBy: row.completed_by,
    completedAt: row.completed_at, createdAt: row.created_at,
  };
}

function mapNotificationOutbox(input: unknown): NotificationOutboxRecord {
  const row = NotificationOutboxRowSchema.parse(input);
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    notificationType: row.notification_type,
    recipientUserId: row.recipient_user_id,
    taskId: row.task_id,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
  };
}

function mapNotificationPreferences(input: unknown): NotificationPreferences {
  const row = NotificationPreferencesRowSchema.parse(input);
  return {
    assignments: row.assignments,
    workflow: row.workflow,
    reminders: row.reminders,
    dailyCheck: row.daily_check,
    reports: row.reports,
  };
}

function mapWorkflowTemplate(input: unknown, rawSteps: unknown[]): WorkflowTemplate {
  const row = WorkflowTemplateRowSchema.parse(input);
  const steps = rawSteps.map((value) => WorkflowTemplateStepRowSchema.parse(value))
    .filter((step) => step.template_id === row.id)
    .sort((left, right) => left.position - right.position)
    .map((step) => ({
      id: step.id,
      templateId: step.template_id,
      position: step.position,
      title: step.title,
      description: step.description,
      assigneeRole: step.assignee_role,
      priority: step.priority,
      dueAfterHours: step.due_after_hours,
    }));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    isSystem: row.is_system,
    steps,
  };
}

function mapEvent(input: unknown): TaskEvent {
  const row = EventRowSchema.parse(input);
  return {
    id: row.id,
    taskId: row.task_id,
    actorId: row.actor_id,
    actorKind: row.actor_kind,
    eventType: row.event_type,
    oldValue: row.old_value,
    newValue: row.new_value,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function mapDeadlineRequest(input: unknown): DeadlineChangeRequest {
  const row = DeadlineRequestRowSchema.parse(input);
  return {
    id: row.id,
    taskId: row.task_id,
    requestedBy: row.requested_by,
    currentDeadline: row.current_deadline,
    requestedDeadline: row.requested_deadline,
    reason: row.reason,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rpcRecord(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

function throwDataError(error: Readonly<{ code?: string; message: string }> | null, fallback: string): never {
  if (error?.code === "23505" || error?.code === "40001") {
    throw new ApplicationError("CONFLICT", "Bu amal yangi yoki mavjud yozuv bilan ziddiyatga keldi.");
  }
  if (error?.code === "PGRST116" || error?.code === "P0002") {
    throw new ApplicationError("NOT_FOUND", fallback);
  }
  if (error?.code === "42501") {
    throw new ApplicationError("FORBIDDEN", "Ma’lumotlar bazasi bu amalni rad etdi.");
  }
  if (error?.code === "22023" || error?.code === "23514") {
    throw new ApplicationError("INVALID_INPUT", "Ma’lumotlar bazasi noto‘g‘ri ma’lumotni rad etdi.");
  }
  throw new ApplicationError("INTEGRATION_UNAVAILABLE", fallback);
}

const DATA_API_PAGE_SIZE = 500;

function compareIsoThenId(
  left: Readonly<{ createdAt: string; id: string }>,
  right: Readonly<{ createdAt: string; id: string }>,
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export class SupabaseMarketingRepository implements MarketingRepository {
  private get client() {
    return getSupabaseAdminClient();
  }

  async registerTelegramUser(identity: TelegramIdentityInput, expectedHeadTelegramUserId: string): Promise<User> {
    const { data, error } = await this.client.rpc("register_telegram_user", {
      p_telegram_user_id: identity.telegramUserId,
      p_telegram_username: identity.telegramUsername ?? "",
      p_display_name: identity.displayName,
      p_expected_head_telegram_user_id: expectedHeadTelegramUserId,
    });
    if (error || !data) throwDataError(error, "Telegram foydalanuvchisini ro‘yxatdan o‘tkazib bo‘lmadi.");
    return mapUser(rpcRecord(data));
  }

  async getUserById(id: string): Promise<User | null> {
    const { data, error } = await this.client.from("users").select("*").eq("id", id).maybeSingle();
    if (error) throwDataError(error, "Foydalanuvchini yuklab bo‘lmadi.");
    return data ? mapUser(data) : null;
  }

  async getUserByTelegramId(telegramUserId: string): Promise<User | null> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) throwDataError(error, "Telegram foydalanuvchisini aniqlab bo‘lmadi.");
    return data ? mapUser(data) : null;
  }

  async findUserByUsername(username: string): Promise<User | null> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("telegram_username", canonicalTelegramUsername(username))
      .maybeSingle();
    if (error) throwDataError(error, "Mas’ulni aniqlab bo‘lmadi.");
    return data ? mapUser(data) : null;
  }

  async listUsers(): Promise<User[]> {
    const { data, error } = await this.client.from("users").select("*").order("display_name");
    if (error) throwDataError(error, "Foydalanuvchilar ro‘yxatini yuklab bo‘lmadi.");
    return (data ?? []).map(mapUser);
  }

  async activateUser(input: { userId: string; actorId: string; role: TeamRole }): Promise<User> {
    const { data, error } = await this.client.rpc("activate_user_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId, p_role: input.role,
    });
    if (error || !data) throwDataError(error, "Foydalanuvchini faollashtirib bo‘lmadi.");
    return mapUser(rpcRecord(data));
  }

  async updateUserRole(input: { userId: string; actorId: string; role: TeamRole }): Promise<User> {
    const { data, error } = await this.client.rpc("update_user_role_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId, p_role: input.role,
    });
    if (error || !data) throwDataError(error, "Rolni yangilab bo‘lmadi.");
    return mapUser(rpcRecord(data));
  }

  async deactivateUser(input: { userId: string; actorId: string }): Promise<User> {
    const { data, error } = await this.client.rpc("deactivate_user_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Jamoa a’zosini chiqarib bo‘lmadi.");
    return mapUser(rpcRecord(data));
  }

  async reactivateUser(input: { userId: string; actorId: string }): Promise<User> {
    const { data, error } = await this.client.rpc("reactivate_user_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Jamoa a’zosini qayta faollashtirib bo‘lmadi.");
    return mapUser(rpcRecord(data));
  }

  async createTask(input: CreateTaskRecord): Promise<Task> {
    const { data, error } = await this.client.rpc("create_task_with_event_v2", {
      p_creator_id: input.creatorId,
      p_assignee_id: input.assigneeId,
      p_title: input.title,
      p_description: input.description ?? "",
      p_priority: input.priority,
      p_deadline: input.deadline,
      p_source_telegram_update_id: input.sourceTelegramUpdateId ?? null,
      p_recurring_definition_id: input.recurringDefinitionId ?? null,
      p_scheduled_occurrence_at: input.scheduledOccurrenceAt ?? null,
    });
    if (error || !data) throwDataError(error, "Vazifani yaratib bo‘lmadi.");
    return mapTask(rpcRecord(data));
  }

  async updateTask(input: Parameters<MarketingRepository["updateTask"]>[0]): Promise<Task> {
    const { data, error } = await this.client.rpc("update_task_with_events", {
      p_task_id: input.taskId,
      p_actor_id: input.actorId,
      p_patch: input.patch,
    });
    if (error || !data) throwDataError(error, "Vazifani yangilab bo‘lmadi.");
    return mapTask(rpcRecord(data));
  }

  async getTask(taskId: string): Promise<Task | null> {
    const { data, error } = await this.client.from("tasks").select("*").eq("id", taskId).maybeSingle();
    if (error) throwDataError(error, "Vazifani yuklab bo‘lmadi.");
    return data ? mapTask(data) : null;
  }

  async listTaskPage(input: TaskPageQuery): Promise<{ tasks: Task[]; hasMore: boolean }> {
    const sortColumn = input.sort === "created_desc" ? "created_at" : "deadline";
    const ascending = input.sort === "deadline_asc";
    let query = this.client.from("tasks").select("*");

    if (input.visibleToUserId) {
      query = query.or(`assignee_id.eq.${input.visibleToUserId},creator_id.eq.${input.visibleToUserId}`);
    }
    if (input.status) query = query.eq("status", input.status);
    if (input.priority) query = query.eq("priority", input.priority);
    if (input.assigneeId) query = query.eq("assignee_id", input.assigneeId);
    if (input.creatorId) query = query.eq("creator_id", input.creatorId);
    if (input.deadlineFrom) query = query.gte("deadline", input.deadlineFrom);
    if (input.deadlineBefore) query = query.lt("deadline", input.deadlineBefore);
    if (input.createdBefore) query = query.lt("created_at", input.createdBefore);
    if (input.completedFrom) query = query.gte("completed_at", input.completedFrom);
    if (input.completedBefore) query = query.lt("completed_at", input.completedBefore);
    if (input.excludeTerminal) query = query.not("status", "in", "(DONE,CANCELLED)");
    if (input.search) query = query.ilike("title", `%${input.search}%`);
    if (input.cursor) {
      const operator = ascending ? "gt" : "lt";
      query = query.or(
        `${sortColumn}.${operator}.${input.cursor.value},and(${sortColumn}.eq.${input.cursor.value},id.${operator}.${input.cursor.id})`,
      );
    }

    const { data, error } = await query
      .order(sortColumn, { ascending })
      .order("id", { ascending })
      .limit(input.limit + 1);
    if (error) throwDataError(error, "Vazifalar ro‘yxatini yuklab bo‘lmadi.");
    const rows = data ?? [];
    return { tasks: rows.slice(0, input.limit).map(mapTask), hasMore: rows.length > input.limit };
  }

  async listTasks(): Promise<Task[]> {
    const tasks: Task[] = [];
    let afterId: string | undefined;
    do {
      let query = this.client.from("tasks").select("*").order("id").limit(DATA_API_PAGE_SIZE);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throwDataError(error, "Vazifalar ro‘yxatini yuklab bo‘lmadi.");
      const page = (data ?? []).map(mapTask);
      tasks.push(...page);
      afterId = page.length === DATA_API_PAGE_SIZE ? page.at(-1)?.id : undefined;
    } while (afterId);
    return tasks.sort((left, right) => left.deadline.localeCompare(right.deadline) || left.id.localeCompare(right.id));
  }

  async listHomeTasks(visibleToUserId?: string): Promise<Task[]> {
    const tasks: Task[] = [];
    let afterId: string | undefined;
    do {
      let query = this.client.from("tasks").select("*")
        .not("status", "in", "(DONE,CANCELLED)")
        .order("id")
        .limit(DATA_API_PAGE_SIZE);
      if (visibleToUserId) query = query.or(`assignee_id.eq.${visibleToUserId},creator_id.eq.${visibleToUserId}`);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throwDataError(error, "Bosh sahifa vazifalarini yuklab bo‘lmadi.");
      const page = (data ?? []).map(mapTask);
      tasks.push(...page);
      afterId = page.length === DATA_API_PAGE_SIZE ? page.at(-1)?.id : undefined;
    } while (afterId);
    return tasks.sort((left, right) => left.deadline.localeCompare(right.deadline) || left.id.localeCompare(right.id));
  }

  async listReminderCandidates(input: { deadlineFrom: string; deadlineTo: string }): Promise<Task[]> {
    const tasks: Task[] = [];
    let afterId: string | undefined;
    do {
      let query = this.client.from("tasks").select("*")
        .not("status", "in", "(DONE,CANCELLED)")
        .gte("deadline", input.deadlineFrom)
        .lte("deadline", input.deadlineTo)
        .order("id")
        .limit(DATA_API_PAGE_SIZE);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throwDataError(error, "Eslatma nomzodlarini yuklab bo‘lmadi.");
      const page = (data ?? []).map(mapTask);
      tasks.push(...page);
      afterId = page.length === DATA_API_PAGE_SIZE ? page.at(-1)?.id : undefined;
    } while (afterId);
    return tasks.sort((left, right) => left.deadline.localeCompare(right.deadline) || left.id.localeCompare(right.id));
  }

  async transitionTask(input: {
    taskId: string;
    actorId: string;
    newStatus: TaskStatus;
    reason?: string;
  }): Promise<Task> {
    const { data, error } = await this.client.rpc("transition_task_with_events", {
      p_task_id: input.taskId,
      p_actor_id: input.actorId,
      p_new_status: input.newStatus,
      p_reason: input.reason ?? null,
    });
    if (error || !data) throwDataError(error, "Vazifani yangilab bo‘lmadi.");
    return mapTask(rpcRecord(data));
  }

  async reassignTask(input: { taskId: string; newAssigneeId: string; actorId: string }): Promise<Task> {
    const { data, error } = await this.client.rpc("reassign_task_with_event", {
      p_task_id: input.taskId, p_new_assignee_id: input.newAssigneeId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Vazifani boshqa mas’ulga o‘tkazib bo‘lmadi.");
    return mapTask(rpcRecord(data));
  }

  async listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    const events: TaskEvent[] = [];
    let afterId: string | undefined;
    do {
      let query = this.client.from("task_events").select("*")
        .eq("task_id", taskId)
        .order("id")
        .limit(DATA_API_PAGE_SIZE);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throwDataError(error, "Vazifa tarixini yuklab bo‘lmadi.");
      const page = (data ?? []).map(mapEvent);
      events.push(...page);
      afterId = page.length === DATA_API_PAGE_SIZE ? page.at(-1)?.id : undefined;
    } while (afterId);
    return events.sort(compareIsoThenId);
  }

  async listAllTaskEvents(): Promise<TaskEvent[]> {
    const events: TaskEvent[] = [];
    let afterId: string | undefined;
    do {
      let query = this.client.from("task_events").select("*").order("id").limit(DATA_API_PAGE_SIZE);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throwDataError(error, "Vazifa tarixini yuklab bo‘lmadi.");
      const page = (data ?? []).map(mapEvent);
      events.push(...page);
      afterId = page.length === DATA_API_PAGE_SIZE ? page.at(-1)?.id : undefined;
    } while (afterId);
    return events.sort(compareIsoThenId);
  }

  async listTaskComments(taskId: string): Promise<TaskComment[]> {
    const comments: TaskComment[] = [];
    let afterId: string | undefined;
    do {
      let query = this.client.from("task_comments").select("*")
        .eq("task_id", taskId)
        .order("id")
        .limit(DATA_API_PAGE_SIZE);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throwDataError(error, "Vazifa muhokamasini yuklab bo‘lmadi.");
      const page = (data ?? []).map(mapTaskComment);
      comments.push(...page);
      afterId = page.length === DATA_API_PAGE_SIZE ? page.at(-1)?.id : undefined;
    } while (afterId);
    return comments.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  async addTaskComment(input: Parameters<MarketingRepository["addTaskComment"]>[0]): Promise<TaskComment> {
    const { data, error } = await this.client.rpc("add_task_comment_with_event", {
      p_task_id: input.taskId,
      p_author_id: input.authorId,
      p_kind: input.kind,
      p_body: input.body ?? null,
      p_attachment_url: input.attachmentUrl ?? null,
    });
    if (error || !data) throwDataError(error, "Vazifaga izoh qo‘shib bo‘lmadi.");
    return mapTaskComment(rpcRecord(data));
  }

  async getPostingChecklist(taskId: string): Promise<PostingChecklist | null> {
    const { data, error } = await this.client.from("task_checklists").select("*").eq("task_id", taskId).maybeSingle();
    if (error) throwDataError(error, "Joylash ro‘yxatini yuklab bo‘lmadi.");
    if (!data) return null;
    const row = ChecklistRowSchema.parse(data);
    const { data: items, error: itemsError } = await this.client
      .from("task_checklist_items").select("*").eq("checklist_id", row.id).order("position");
    if (itemsError) throwDataError(itemsError, "Joylash ro‘yxati bandlarini yuklab bo‘lmadi.");
    return { id: row.id, taskId: row.task_id, kind: row.kind, createdAt: row.created_at, items: (items ?? []).map(mapChecklistItem) };
  }

  async getPostingChecklistByItemId(itemId: string): Promise<PostingChecklist | null> {
    const { data, error } = await this.client.from("task_checklist_items").select("checklist_id").eq("id", itemId).maybeSingle();
    if (error) throwDataError(error, "Joylash ro‘yxati bandini yuklab bo‘lmadi.");
    if (!data) return null;
    const { data: checklist, error: checklistError } = await this.client
      .from("task_checklists").select("task_id").eq("id", data.checklist_id).single();
    if (checklistError || !checklist) throwDataError(checklistError, "Joylash ro‘yxatini yuklab bo‘lmadi.");
    return this.getPostingChecklist(checklist.task_id);
  }

  async togglePostingChecklistItem(input: { itemId: string; actorId: string }): Promise<PostingChecklistItem> {
    const { data, error } = await this.client.rpc("toggle_posting_checklist_item", {
      p_item_id: input.itemId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Joylash ro‘yxatini yangilab bo‘lmadi.");
    return mapChecklistItem(rpcRecord(data));
  }

  async getUserTaskPlan(userId: string, taskId: string): Promise<UserTaskPlan | null> {
    const { data, error } = await this.client.from("user_task_plans").select("*")
      .eq("user_id", userId).eq("task_id", taskId).maybeSingle();
    if (error) throwDataError(error, "Shaxsiy reja yuklanmadi.");
    return data ? mapUserTaskPlan(data) : null;
  }

  async listUserTaskPlans(userId: string): Promise<UserTaskPlan[]> {
    const { data, error } = await this.client.from("user_task_plans").select("*").eq("user_id", userId);
    if (error) throwDataError(error, "Shaxsiy rejalar yuklanmadi.");
    return (data ?? []).map(mapUserTaskPlan);
  }

  async saveUserTaskPlan(input: Parameters<MarketingRepository["saveUserTaskPlan"]>[0]): Promise<UserTaskPlan> {
    const { data, error } = await this.client.from("user_task_plans").upsert({
      user_id: input.userId, task_id: input.taskId, is_important: input.isImportant,
      urgent_override: input.urgentOverride, planned_on: input.plannedOn,
      estimated_minutes: input.estimatedMinutes,
    }, { onConflict: "user_id,task_id" }).select("*").single();
    if (error || !data) throwDataError(error, "Shaxsiy rejani saqlab bo‘lmadi.");
    return mapUserTaskPlan(data);
  }

  async listTaskCheckpoints(taskId: string): Promise<TaskCheckpoint[]> {
    const { data, error } = await this.client.from("task_checkpoints").select("*")
      .eq("task_id", taskId).order("position");
    if (error) throwDataError(error, "Checkpointlar yuklanmadi.");
    return (data ?? []).map(mapTaskCheckpoint);
  }

  async listUserCheckpointsDueBetween(userId: string, from: string, before: string): Promise<TaskCheckpoint[]> {
    const { data, error } = await this.client.from("task_checkpoints")
      .select("*,tasks!inner(assignee_id,status)")
      .eq("tasks.assignee_id", userId)
      .not("tasks.status", "in", "(DONE,CANCELLED)")
      .gte("due_at", from).lt("due_at", before)
      .order("due_at");
    if (error) throwDataError(error, "Bugungi checkpointlar yuklanmadi.");
    return (data ?? []).map(mapTaskCheckpoint);
  }

  async getTaskCheckpoint(id: string): Promise<TaskCheckpoint | null> {
    const { data, error } = await this.client.from("task_checkpoints").select("*").eq("id", id).maybeSingle();
    if (error) throwDataError(error, "Checkpoint yuklanmadi.");
    return data ? mapTaskCheckpoint(data) : null;
  }

  async addTaskCheckpoint(input: Parameters<MarketingRepository["addTaskCheckpoint"]>[0]): Promise<TaskCheckpoint> {
    const { data, error } = await this.client.rpc("add_task_checkpoint_with_event", {
      p_task_id: input.taskId, p_actor_id: input.actorId, p_title: input.title, p_due_at: input.dueAt,
    });
    if (error || !data) throwDataError(error, "Checkpoint qo‘shilmadi.");
    return mapTaskCheckpoint(rpcRecord(data));
  }

  async toggleTaskCheckpoint(input: Parameters<MarketingRepository["toggleTaskCheckpoint"]>[0]): Promise<TaskCheckpoint> {
    const { data, error } = await this.client.rpc("toggle_task_checkpoint_with_event", {
      p_checkpoint_id: input.id, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Checkpoint yangilanmadi.");
    return mapTaskCheckpoint(rpcRecord(data));
  }

  async removeTaskCheckpoint(input: Parameters<MarketingRepository["removeTaskCheckpoint"]>[0]): Promise<void> {
    const { error } = await this.client.rpc("remove_task_checkpoint_with_event", {
      p_checkpoint_id: input.id, p_actor_id: input.actorId,
    });
    if (error) throwDataError(error, "Checkpoint o‘chirilmadi.");
  }

  async createDeadlineChangeRequest(input: {
    taskId: string;
    requestedBy: string;
    requestedDeadline: string;
    reason: string;
  }): Promise<DeadlineChangeRequest> {
    const { data, error } = await this.client.rpc("create_deadline_change_request_with_event", {
      p_task_id: input.taskId,
      p_requested_by: input.requestedBy,
      p_requested_deadline: input.requestedDeadline,
      p_reason: input.reason,
    });
    if (error || !data) throwDataError(error, "Muddatni o‘zgartirish so‘rovini yaratib bo‘lmadi.");
    return mapDeadlineRequest(rpcRecord(data));
  }

  async getDeadlineChangeRequest(requestId: string): Promise<DeadlineChangeRequest | null> {
    const { data, error } = await this.client
      .from("deadline_change_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throwDataError(error, "Muddat so‘rovini yuklab bo‘lmadi.");
    return data ? mapDeadlineRequest(data) : null;
  }

  async listDeadlineChangeRequests(input: { taskId?: string } = {}): Promise<DeadlineChangeRequest[]> {
    const requests: DeadlineChangeRequest[] = [];
    let afterId: string | undefined;
    do {
      let query = this.client.from("deadline_change_requests").select("*").order("id").limit(DATA_API_PAGE_SIZE);
      if (input.taskId) query = query.eq("task_id", input.taskId);
      if (afterId) query = query.gt("id", afterId);
      const { data, error } = await query;
      if (error) throwDataError(error, "Muddat so‘rovlari ro‘yxatini yuklab bo‘lmadi.");
      const page = (data ?? []).map(mapDeadlineRequest);
      requests.push(...page);
      afterId = page.length === DATA_API_PAGE_SIZE ? page.at(-1)?.id : undefined;
    } while (afterId);
    return requests.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  }

  async resolveDeadlineChangeRequest(input: {
    requestId: string;
    resolvedBy: string;
    approve: boolean;
    resolutionNote?: string;
  }): Promise<DeadlineChangeRequest> {
    const { data, error } = await this.client.rpc("resolve_deadline_change_request_with_events", {
      p_request_id: input.requestId,
      p_resolved_by: input.resolvedBy,
      p_approve: input.approve,
      p_resolution_note: input.resolutionNote ?? null,
    });
    if (error || !data) throwDataError(error, "Muddat so‘rovini hal qilib bo‘lmadi.");
    return mapDeadlineRequest(rpcRecord(data));
  }

  async getRecurringDefinitionForTask(taskId: string): Promise<RecurringDefinition | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;
    const query = this.client.from("recurring_definitions").select("*");
    const { data, error } = task.recurringDefinitionId
      ? await query.eq("id", task.recurringDefinitionId).maybeSingle()
      : await query.eq("source_task_id", taskId).maybeSingle();
    if (error) throwDataError(error, "Takroriy vazifani yuklab bo‘lmadi.");
    return data ? mapRecurringDefinition(data) : null;
  }

  async getRecurringDefinition(id: string): Promise<RecurringDefinition | null> {
    const { data, error } = await this.client.from("recurring_definitions").select("*").eq("id", id).maybeSingle();
    if (error) throwDataError(error, "Takroriy vazifani yuklab bo‘lmadi.");
    return data ? mapRecurringDefinition(data) : null;
  }

  async listDueRecurringDefinitions(now: string): Promise<RecurringDefinition[]> {
    const { data, error } = await this.client.from("recurring_definitions").select("*")
      .eq("status", "ACTIVE").not("next_occurrence_at", "is", null).lte("next_occurrence_at", now)
      .order("next_occurrence_at");
    if (error) throwDataError(error, "Takroriy vazifalar ro‘yxatini yuklab bo‘lmadi.");
    return (data ?? []).map(mapRecurringDefinition);
  }

  async listRecurringDefinitionsByAssignee(assigneeId: string): Promise<RecurringDefinition[]> {
    const { data, error } = await this.client.from("recurring_definitions").select("*").eq("assignee_id", assigneeId);
    if (error) throwDataError(error, "Takroriy vazifalar ro‘yxatini yuklab bo‘lmadi.");
    return (data ?? []).map(mapRecurringDefinition);
  }

  async createRecurringDefinition(input: Parameters<MarketingRepository["createRecurringDefinition"]>[0]): Promise<RecurringDefinition> {
    const { data, error } = await this.client.from("recurring_definitions").insert({
      source_task_id: input.sourceTaskId, created_by: input.createdBy, title: input.title,
      description: input.description, priority: input.priority, assignee_id: input.assigneeId,
      frequency: input.frequency, weekday: input.weekday, day_of_month: input.dayOfMonth,
      local_time: input.localTime, ends_on: input.endsOn, next_occurrence_at: input.nextOccurrenceAt,
    }).select("*").single();
    if (error || !data) throwDataError(error, "Takroriy vazifani yaratib bo‘lmadi.");
    return mapRecurringDefinition(data);
  }

  async updateRecurringDefinition(input: Parameters<MarketingRepository["updateRecurringDefinition"]>[0]): Promise<RecurringDefinition> {
    const changes: {
      frequency?: "WEEKDAYS" | "WEEKLY" | "MONTHLY";
      weekday?: number | null;
      day_of_month?: number | null;
      local_time?: string;
      ends_on?: string | null;
      status?: "ACTIVE" | "PAUSED" | "STOPPED";
      next_occurrence_at?: string | null;
      pause_reason?: string | null;
      assignee_id?: string;
    } = {};
    if (input.frequency !== undefined) changes.frequency = input.frequency;
    if (input.weekday !== undefined) changes.weekday = input.weekday;
    if (input.dayOfMonth !== undefined) changes.day_of_month = input.dayOfMonth;
    if (input.localTime !== undefined) changes.local_time = input.localTime;
    if (input.endsOn !== undefined) changes.ends_on = input.endsOn;
    if (input.status !== undefined) changes.status = input.status;
    if (input.nextOccurrenceAt !== undefined) changes.next_occurrence_at = input.nextOccurrenceAt;
    if (input.pauseReason !== undefined) changes.pause_reason = input.pauseReason;
    if (input.assigneeId !== undefined) changes.assignee_id = input.assigneeId;
    const { data, error } = await this.client.from("recurring_definitions").update(changes).eq("id", input.id).select("*").single();
    if (error || !data) throwDataError(error, "Takroriy vazifani yangilab bo‘lmadi.");
    return mapRecurringDefinition(data);
  }

  async generateRecurringOccurrence(input: Parameters<MarketingRepository["generateRecurringOccurrence"]>[0]): Promise<Task | null> {
    const { data, error } = await this.client.rpc("generate_recurring_task", {
      p_definition_id: input.definitionId,
      p_scheduled_occurrence_at: input.scheduledOccurrenceAt,
      p_next_occurrence_at: input.nextOccurrenceAt,
    });
    if (error) throwDataError(error, "Takroriy vazifani hosil qilib bo‘lmadi.");
    const record = data ? rpcRecord(data) : null;
    return record ? mapTask(record) : null;
  }

  async listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
    const { data: templates, error: templatesError } = await this.client.from("workflow_templates")
      .select("*").eq("is_active", true).order("name");
    if (templatesError) throwDataError(templatesError, "Ish jarayoni shablonlarini yuklab bo‘lmadi.");
    if (!templates?.length) return [];
    const { data: steps, error: stepsError } = await this.client.from("workflow_template_steps")
      .select("*").in("template_id", templates.map((template) => template.id)).order("position");
    if (stepsError) throwDataError(stepsError, "Ish jarayoni bosqichlarini yuklab bo‘lmadi.");
    return (templates ?? []).map((template) => mapWorkflowTemplate(template, steps ?? []));
  }

  async saveWorkflowTemplateVersion(input: Parameters<MarketingRepository["saveWorkflowTemplateVersion"]>[0]): Promise<string> {
    const { data, error } = await this.client.rpc("save_workflow_template_version", {
      p_actor_id: input.actorId,
      p_source_template_id: input.sourceTemplateId,
      p_name: input.name,
      p_description: input.description,
      p_steps: input.steps.map((step) => ({
        title: step.title, description: step.description, assigneeRole: step.assigneeRole,
        priority: step.priority, dueAfterHours: step.dueAfterHours,
      })),
    });
    if (error || !data) throwDataError(error, "Shablonni saqlab bo‘lmadi.");
    return z.string().uuid().parse(data);
  }

  async startWorkflowRun(input: Parameters<MarketingRepository["startWorkflowRun"]>[0]): Promise<Task> {
    const { data, error } = await this.client.rpc("start_workflow_run", {
      p_template_id: input.templateId,
      p_actor_id: input.actorId,
      p_subject: input.subject,
      p_assignee_map: input.assigneeMap,
    });
    if (error || !data) throwDataError(error, "Ish jarayonini boshlab bo‘lmadi.");
    return mapTask(rpcRecord(data));
  }

  async advanceWorkflowRun(input: Parameters<MarketingRepository["advanceWorkflowRun"]>[0]): Promise<Task | null> {
    const { data, error } = await this.client.rpc("advance_workflow_run", {
      p_completed_task_id: input.completedTaskId,
      p_actor_id: input.actorId,
    });
    if (error) throwDataError(error, "Ish jarayonini keyingi bosqichga o‘tkazib bo‘lmadi.");
    const record = data ? rpcRecord(data) : null;
    return record ? mapTask(record) : null;
  }

  async recoverWorkflowRuns(): Promise<Task[]> {
    const { data, error } = await this.client.rpc("recover_workflow_runs");
    if (error) throwDataError(error, "Ish jarayonlarini tiklab bo‘lmadi.");
    return (data ?? []).map(mapTask);
  }

  async enqueueNotification(input: Parameters<MarketingRepository["enqueueNotification"]>[0]): Promise<NotificationOutboxRecord> {
    const { data, error } = await this.client.rpc("enqueue_notification_outbox", {
      p_dedupe_key: input.dedupeKey,
      p_notification_type: input.notificationType,
      p_recipient_user_id: input.recipientUserId,
      p_task_id: input.taskId ?? null,
      p_payload: input.payload as Record<string, string>,
    });
    if (error || !data) throwDataError(error, "Bildirishnomani navbatga qo‘shib bo‘lmadi.");
    return mapNotificationOutbox(rpcRecord(data));
  }

  async claimNotification(id: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_notification_outbox", { p_id: id });
    if (error) throwDataError(error, "Bildirishnomani yuborish uchun band qilib bo‘lmadi.");
    return data === true;
  }

  async claimDueNotifications(limit: number): Promise<NotificationOutboxRecord[]> {
    const { data, error } = await this.client.rpc("claim_due_notification_outbox", { p_limit: limit });
    if (error) throwDataError(error, "Yuborilishi kerak bo‘lgan bildirishnomalarni band qilib bo‘lmadi.");
    return (data ?? []).map(mapNotificationOutbox);
  }

  async completeNotification(input: Parameters<MarketingRepository["completeNotification"]>[0]): Promise<void> {
    const { error } = await this.client.rpc("complete_notification_outbox", {
      p_id: input.id,
      p_sent: input.sent,
      p_error: input.error ?? null,
    });
    if (error) throwDataError(error, "Bildirishnoma yetkazilishini yakunlab bo‘lmadi.");
  }

  async getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
    const { data, error } = await this.client.from("user_notification_preferences")
      .select("*").eq("user_id", userId).maybeSingle();
    if (error) throwDataError(error, "Bildirishnoma sozlamalarini yuklab bo‘lmadi.");
    return data ? mapNotificationPreferences(data) : DEFAULT_NOTIFICATION_PREFERENCES;
  }

  async updateNotificationPreferences(userId: string, preferences: NotificationPreferences): Promise<NotificationPreferences> {
    const { data, error } = await this.client.rpc("update_user_notification_preferences", {
      p_user_id: userId,
      p_assignments: preferences.assignments,
      p_workflow: preferences.workflow,
      p_reminders: preferences.reminders,
      p_daily_check: preferences.dailyCheck,
      p_reports: preferences.reports,
    });
    if (error || !data) throwDataError(error, "Bildirishnoma sozlamalarini saqlab bo‘lmadi.");
    return mapNotificationPreferences(rpcRecord(data));
  }

  async claimReportDelivery(input: Parameters<MarketingRepository["claimReportDelivery"]>[0]): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_report_delivery", {
      p_report_type: input.reportType,
      p_interval_key: input.intervalKey,
      p_recipient_user_id: input.recipientUserId,
    });
    if (error) throwDataError(error, "Hisobot yetkazilishini band qilib bo‘lmadi.");
    return data === true;
  }

  async completeReportDelivery(input: Parameters<MarketingRepository["completeReportDelivery"]>[0]): Promise<void> {
    const { error } = await this.client.rpc("complete_report_delivery", {
      p_report_type: input.reportType,
      p_interval_key: input.intervalKey,
      p_recipient_user_id: input.recipientUserId,
      p_status: input.status,
      p_failure_reason: input.failureReason ?? null,
    });
    if (error) throwDataError(error, "Hisobot yetkazilishini yakunlab bo‘lmadi.");
  }

  async claimReminderDelivery(input: { taskId: string; deadline: string; reminderType: ReminderType }): Promise<ReminderClaim> {
    const { data, error } = await this.client.rpc("claim_task_reminder_delivery", {
      p_task_id: input.taskId,
      p_deadline: input.deadline,
      p_reminder_type: input.reminderType,
    });
    if (error) throwDataError(error, "Eslatma yetkazilishini band qilib bo‘lmadi.");
    return ReminderClaimSchema.parse(data);
  }

  async completeReminderDelivery(input: {
    taskId: string;
    deadline: string;
    reminderType: ReminderType;
    status: "SENT" | "FAILED";
    failureReason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await this.client.rpc("complete_task_reminder_delivery", {
      p_task_id: input.taskId,
      p_deadline: input.deadline,
      p_reminder_type: input.reminderType,
      p_status: input.status,
      p_failure_reason: input.failureReason ?? null,
      p_metadata: (input.metadata ?? {}) as Record<string, string>,
    });
    if (error) throwDataError(error, "Eslatma yetkazilishini yakunlab bo‘lmadi.");
  }
}
