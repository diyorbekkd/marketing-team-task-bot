import "server-only";

import { z } from "zod";
import type {
  CreateTaskRecord,
  MarketingRepository,
  TelegramIdentityInput,
} from "@/application/ports/marketing-repository";
import { ApplicationError } from "@/application/errors";
import type { TeamRole } from "@/domain/permissions";
import type { TaskStatus } from "@/domain/task";
import type { ReminderType } from "@/domain/reminders";
import type {
  DeadlineChangeRequest,
  PostingChecklist,
  PostingChecklistItem,
  RecurringDefinition,
  Task,
  TaskEvent,
  User,
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
  blocked_reason: z.string().nullable(),
  completed_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  recurring_definition_id: z.string().uuid().nullable().default(null),
  scheduled_occurrence_at: z.string().nullable().default(null),
});

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
    blockedReason: row.blocked_reason,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recurringDefinitionId: row.recurring_definition_id,
    scheduledOccurrenceAt: row.scheduled_occurrence_at,
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
    throw new ApplicationError("CONFLICT", "This operation conflicts with a newer or existing record.");
  }
  if (error?.code === "PGRST116" || error?.code === "P0002") {
    throw new ApplicationError("NOT_FOUND", fallback);
  }
  if (error?.code === "42501") {
    throw new ApplicationError("FORBIDDEN", "The database rejected this operation.");
  }
  if (error?.code === "22023" || error?.code === "23514") {
    throw new ApplicationError("INVALID_INPUT", "The database rejected invalid input.");
  }
  throw new ApplicationError("INTEGRATION_UNAVAILABLE", fallback);
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
    if (error || !data) throwDataError(error, "Unable to register Telegram user.");
    return mapUser(rpcRecord(data));
  }

  async getUserById(id: string): Promise<User | null> {
    const { data, error } = await this.client.from("users").select("*").eq("id", id).maybeSingle();
    if (error) throwDataError(error, "Unable to load user.");
    return data ? mapUser(data) : null;
  }

  async getUserByTelegramId(telegramUserId: string): Promise<User | null> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("telegram_user_id", telegramUserId)
      .maybeSingle();
    if (error) throwDataError(error, "Unable to resolve Telegram user.");
    return data ? mapUser(data) : null;
  }

  async findActiveUserByUsername(username: string): Promise<User | null> {
    const { data, error } = await this.client
      .from("users")
      .select("*")
      .eq("telegram_username", username.replace(/^@/, "").toLowerCase())
      .eq("is_active", true)
      .maybeSingle();
    if (error) throwDataError(error, "Unable to resolve assignee.");
    return data ? mapUser(data) : null;
  }

  async listUsers(): Promise<User[]> {
    const { data, error } = await this.client.from("users").select("*").order("display_name");
    if (error) throwDataError(error, "Unable to list users.");
    return (data ?? []).map(mapUser);
  }

  async activateUser(input: { userId: string; actorId: string; role: TeamRole }): Promise<User> {
    const { data, error } = await this.client.rpc("activate_user_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId, p_role: input.role,
    });
    if (error || !data) throwDataError(error, "Unable to activate user.");
    return mapUser(rpcRecord(data));
  }

  async updateUserRole(input: { userId: string; actorId: string; role: TeamRole }): Promise<User> {
    const { data, error } = await this.client.rpc("update_user_role_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId, p_role: input.role,
    });
    if (error || !data) throwDataError(error, "Unable to update role.");
    return mapUser(rpcRecord(data));
  }

  async deactivateUser(input: { userId: string; actorId: string }): Promise<User> {
    const { data, error } = await this.client.rpc("deactivate_user_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Unable to remove team member.");
    return mapUser(rpcRecord(data));
  }

  async reactivateUser(input: { userId: string; actorId: string }): Promise<User> {
    const { data, error } = await this.client.rpc("reactivate_user_with_event", {
      p_user_id: input.userId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Unable to reactivate team member.");
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
    if (error || !data) throwDataError(error, "Unable to create task.");
    return mapTask(rpcRecord(data));
  }

  async getTask(taskId: string): Promise<Task | null> {
    const { data, error } = await this.client.from("tasks").select("*").eq("id", taskId).maybeSingle();
    if (error) throwDataError(error, "Unable to load task.");
    return data ? mapTask(data) : null;
  }

  async listTasks(): Promise<Task[]> {
    const { data, error } = await this.client.from("tasks").select("*").order("deadline");
    if (error) throwDataError(error, "Unable to list tasks.");
    return (data ?? []).map(mapTask);
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
    if (error || !data) throwDataError(error, "Unable to update task.");
    return mapTask(rpcRecord(data));
  }

  async reassignTask(input: { taskId: string; newAssigneeId: string; actorId: string }): Promise<Task> {
    const { data, error } = await this.client.rpc("reassign_task_with_event", {
      p_task_id: input.taskId, p_new_assignee_id: input.newAssigneeId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Unable to reassign task.");
    return mapTask(rpcRecord(data));
  }

  async listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    const { data, error } = await this.client
      .from("task_events")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at");
    if (error) throwDataError(error, "Unable to load task history.");
    return (data ?? []).map(mapEvent);
  }

  async listAllTaskEvents(): Promise<TaskEvent[]> {
    const { data, error } = await this.client.from("task_events").select("*").order("created_at");
    if (error) throwDataError(error, "Unable to load task history.");
    return (data ?? []).map(mapEvent);
  }

  async getPostingChecklist(taskId: string): Promise<PostingChecklist | null> {
    const { data, error } = await this.client.from("task_checklists").select("*").eq("task_id", taskId).maybeSingle();
    if (error) throwDataError(error, "Unable to load posting checklist.");
    if (!data) return null;
    const row = ChecklistRowSchema.parse(data);
    const { data: items, error: itemsError } = await this.client
      .from("task_checklist_items").select("*").eq("checklist_id", row.id).order("position");
    if (itemsError) throwDataError(itemsError, "Unable to load posting checklist items.");
    return { id: row.id, taskId: row.task_id, kind: row.kind, createdAt: row.created_at, items: (items ?? []).map(mapChecklistItem) };
  }

  async getPostingChecklistByItemId(itemId: string): Promise<PostingChecklist | null> {
    const { data, error } = await this.client.from("task_checklist_items").select("checklist_id").eq("id", itemId).maybeSingle();
    if (error) throwDataError(error, "Unable to load posting checklist item.");
    if (!data) return null;
    const { data: checklist, error: checklistError } = await this.client
      .from("task_checklists").select("task_id").eq("id", data.checklist_id).single();
    if (checklistError || !checklist) throwDataError(checklistError, "Unable to load posting checklist.");
    return this.getPostingChecklist(checklist.task_id);
  }

  async togglePostingChecklistItem(input: { itemId: string; actorId: string }): Promise<PostingChecklistItem> {
    const { data, error } = await this.client.rpc("toggle_posting_checklist_item", {
      p_item_id: input.itemId, p_actor_id: input.actorId,
    });
    if (error || !data) throwDataError(error, "Unable to update posting checklist.");
    return mapChecklistItem(rpcRecord(data));
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
    if (error || !data) throwDataError(error, "Unable to request a deadline change.");
    return mapDeadlineRequest(rpcRecord(data));
  }

  async getDeadlineChangeRequest(requestId: string): Promise<DeadlineChangeRequest | null> {
    const { data, error } = await this.client
      .from("deadline_change_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (error) throwDataError(error, "Unable to load deadline request.");
    return data ? mapDeadlineRequest(data) : null;
  }

  async listDeadlineChangeRequests(): Promise<DeadlineChangeRequest[]> {
    const { data, error } = await this.client
      .from("deadline_change_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throwDataError(error, "Unable to list deadline requests.");
    return (data ?? []).map(mapDeadlineRequest);
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
    if (error || !data) throwDataError(error, "Unable to resolve deadline request.");
    return mapDeadlineRequest(rpcRecord(data));
  }

  async getRecurringDefinitionForTask(taskId: string): Promise<RecurringDefinition | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;
    const query = this.client.from("recurring_definitions").select("*");
    const { data, error } = task.recurringDefinitionId
      ? await query.eq("id", task.recurringDefinitionId).maybeSingle()
      : await query.eq("source_task_id", taskId).maybeSingle();
    if (error) throwDataError(error, "Unable to load recurring task.");
    return data ? mapRecurringDefinition(data) : null;
  }

  async getRecurringDefinition(id: string): Promise<RecurringDefinition | null> {
    const { data, error } = await this.client.from("recurring_definitions").select("*").eq("id", id).maybeSingle();
    if (error) throwDataError(error, "Unable to load recurring task.");
    return data ? mapRecurringDefinition(data) : null;
  }

  async listDueRecurringDefinitions(now: string): Promise<RecurringDefinition[]> {
    const { data, error } = await this.client.from("recurring_definitions").select("*")
      .eq("status", "ACTIVE").not("next_occurrence_at", "is", null).lte("next_occurrence_at", now)
      .order("next_occurrence_at");
    if (error) throwDataError(error, "Unable to list recurring tasks.");
    return (data ?? []).map(mapRecurringDefinition);
  }

  async listRecurringDefinitionsByAssignee(assigneeId: string): Promise<RecurringDefinition[]> {
    const { data, error } = await this.client.from("recurring_definitions").select("*").eq("assignee_id", assigneeId);
    if (error) throwDataError(error, "Unable to list recurring tasks.");
    return (data ?? []).map(mapRecurringDefinition);
  }

  async createRecurringDefinition(input: Parameters<MarketingRepository["createRecurringDefinition"]>[0]): Promise<RecurringDefinition> {
    const { data, error } = await this.client.from("recurring_definitions").insert({
      source_task_id: input.sourceTaskId, created_by: input.createdBy, title: input.title,
      description: input.description, priority: input.priority, assignee_id: input.assigneeId,
      frequency: input.frequency, weekday: input.weekday, day_of_month: input.dayOfMonth,
      local_time: input.localTime, ends_on: input.endsOn, next_occurrence_at: input.nextOccurrenceAt,
    }).select("*").single();
    if (error || !data) throwDataError(error, "Unable to create recurring task.");
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
    if (error || !data) throwDataError(error, "Unable to update recurring task.");
    return mapRecurringDefinition(data);
  }

  async generateRecurringOccurrence(input: Parameters<MarketingRepository["generateRecurringOccurrence"]>[0]): Promise<Task | null> {
    const { data, error } = await this.client.rpc("generate_recurring_task", {
      p_definition_id: input.definitionId,
      p_scheduled_occurrence_at: input.scheduledOccurrenceAt,
      p_next_occurrence_at: input.nextOccurrenceAt,
    });
    if (error) throwDataError(error, "Unable to generate recurring task.");
    const record = data ? rpcRecord(data) : null;
    return record ? mapTask(record) : null;
  }

  async claimReportDelivery(input: Parameters<MarketingRepository["claimReportDelivery"]>[0]): Promise<boolean> {
    const { error } = await this.client.from("report_deliveries").insert({
      report_type: input.reportType, interval_key: input.intervalKey, recipient_user_id: input.recipientUserId,
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throwDataError(error, "Unable to claim report delivery.");
  }

  async completeReportDelivery(input: Parameters<MarketingRepository["completeReportDelivery"]>[0]): Promise<void> {
    const { error } = await this.client.from("report_deliveries").update({
      status: input.status, failure_reason: input.failureReason ?? null, completed_at: new Date().toISOString(),
    }).eq("report_type", input.reportType).eq("interval_key", input.intervalKey)
      .eq("recipient_user_id", input.recipientUserId);
    if (error) throwDataError(error, "Unable to complete report delivery.");
  }

  async claimReminderDelivery(input: { taskId: string; deadline: string; reminderType: ReminderType }): Promise<boolean> {
    const { error } = await this.client.from("task_reminder_deliveries").insert({
      task_id: input.taskId, deadline: input.deadline, reminder_type: input.reminderType,
    });
    if (!error) return true;
    if (error.code === "23505") return false;
    throwDataError(error, "Unable to claim reminder delivery.");
  }

  async completeReminderDelivery(input: {
    taskId: string;
    deadline: string;
    reminderType: ReminderType;
    status: "SENT" | "FAILED";
    failureReason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { error } = await this.client.from("task_reminder_deliveries").update({
      status: input.status,
      failure_reason: input.failureReason ?? null,
      metadata: (input.metadata ?? {}) as Record<string, string>,
      completed_at: new Date().toISOString(),
    }).eq("task_id", input.taskId).eq("deadline", input.deadline).eq("reminder_type", input.reminderType);
    if (error) throwDataError(error, "Unable to complete reminder delivery.");
  }
}
