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
import type { DeadlineChangeRequest, Task, TaskEvent, User } from "@/domain/models";
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

function mapUser(input: unknown): User {
  const row = UserRowSchema.parse(input);
  return {
    id: row.id,
    telegramUserId: row.telegram_user_id,
    telegramUsername: row.telegram_username,
    displayName: row.display_name,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

  async activateUser(userId: string, role: TeamRole): Promise<User> {
    const { data, error } = await this.client
      .from("users")
      .update({ role, is_active: true })
      .eq("id", userId)
      .eq("is_active", false)
      .select("*")
      .single();
    if (error || !data) throwDataError(error, "Unable to activate user.");
    return mapUser(data);
  }

  async updateUserRole(userId: string, role: TeamRole): Promise<User> {
    const { data, error } = await this.client
      .from("users")
      .update({ role })
      .eq("id", userId)
      .eq("is_active", true)
      .neq("role", "HEAD_OF_MARKETING")
      .select("*")
      .single();
    if (error || !data) throwDataError(error, "Unable to update role.");
    return mapUser(data);
  }

  async createTask(input: CreateTaskRecord): Promise<Task> {
    const { data, error } = await this.client.rpc("create_task_with_event", {
      p_creator_id: input.creatorId,
      p_assignee_id: input.assigneeId,
      p_title: input.title,
      p_description: input.description ?? "",
      p_priority: input.priority,
      p_deadline: input.deadline,
      p_source_telegram_update_id: input.sourceTelegramUpdateId ?? null,
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

  async listTaskEvents(taskId: string): Promise<TaskEvent[]> {
    const { data, error } = await this.client
      .from("task_events")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at");
    if (error) throwDataError(error, "Unable to load task history.");
    return (data ?? []).map(mapEvent);
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
}
