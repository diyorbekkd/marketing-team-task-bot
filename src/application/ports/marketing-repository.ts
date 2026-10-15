import type { TeamRole } from "@/domain/permissions";
import type { TaskPriority, TaskStatus } from "@/domain/task";
import type { ReminderType } from "@/domain/reminders";
import type {
  DeadlineChangeRequest,
  PostingChecklist,
  PostingChecklistItem,
  RecurrenceFrequency,
  RecurrenceStatus,
  RecurringDefinition,
  ReassignRequest,
  Task,
  TaskArchive,
  TaskEvent,
  User,
} from "@/domain/models";
import type { WorkflowNotificationEvent } from "./notification-dispatcher";

export interface TelegramIdentityInput {
  readonly telegramUserId: string;
  readonly telegramUsername?: string;
  readonly displayName: string;
}

export type ContentOsLoginChallengeStatus =
  | "PENDING"
  | "APPROVED"
  | "CONSUMED"
  | "CANCELLED"
  | "EXPIRED"
  | "UNAVAILABLE";

export interface ContentOsLoginChallenge {
  readonly status: ContentOsLoginChallengeStatus;
  readonly displayCode: string | null;
}

export interface TaskNotificationOutboxEntry {
  readonly id: string;
  readonly taskEventId: string;
  readonly eventType: WorkflowNotificationEvent;
  readonly recipientUserId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly attempts: number;
}

export type ContentOsLoginDecision =
  | "APPROVED"
  | "CANCELLED"
  | "DENIED"
  | "EXPIRED"
  | "UNAVAILABLE";

export interface CreateTaskRecord {
  readonly creatorId: string;
  readonly assigneeId: string;
  readonly title: string;
  readonly description?: string;
  readonly priority: TaskPriority;
  readonly deadline: string;
  readonly sourceTelegramUpdateId?: number;
  readonly recurringDefinitionId?: string;
  readonly scheduledOccurrenceAt?: string;
}

export interface MarketingRepository {
  registerTelegramUser(identity: TelegramIdentityInput, expectedHeadTelegramUserId: string): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByTelegramId(telegramUserId: string): Promise<User | null>;
  /** Looks up by canonical Telegram username regardless of active state, so
   * callers can distinguish "no such username" from "exists but inactive". */
  findUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  activateUser(input: { userId: string; actorId: string; role: TeamRole }): Promise<User>;
  updateUserRole(input: { userId: string; actorId: string; role: TeamRole }): Promise<User>;
  deactivateUser(input: { userId: string; actorId: string }): Promise<User>;
  reactivateUser(input: { userId: string; actorId: string }): Promise<User>;

  getContentOsLoginChallengeStatus(challengeId: string): Promise<ContentOsLoginChallenge>;
  approveContentOsLoginChallenge(input: {
    challengeId: string;
    telegramUserId: string;
  }): Promise<ContentOsLoginDecision>;
  cancelContentOsLoginChallenge(input: {
    challengeId: string;
    telegramUserId: string;
  }): Promise<ContentOsLoginDecision>;

  createTask(input: CreateTaskRecord): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  /** Stable pinned Content OS Task Type code, or null for a manual task. */
  getContentTaskTypeCode?(taskId: string): Promise<string | null>;
  listTasks(): Promise<Task[]>;
  getTaskArchive(taskId: string): Promise<TaskArchive | null>;
  listTaskArchives(): Promise<TaskArchive[]>;
  updateTaskContent(input: {
    taskId: string;
    actorId: string;
    title: string;
    description: string | null;
    priority: TaskPriority;
  }): Promise<Task>;
  transitionTask(input: {
    taskId: string;
    actorId: string;
    newStatus: TaskStatus;
    reason?: string;
  }): Promise<Task>;
  reassignTask(input: { taskId: string; newAssigneeId: string; actorId: string }): Promise<Task>;
  changeTaskDeadline(input: { taskId: string; newDeadline: string; actorId: string }): Promise<Task>;
  archiveTask(input: { taskId: string; actorId: string; reason?: string }): Promise<TaskArchive>;
  restoreTask(input: { taskId: string; actorId: string }): Promise<Task>;
  listTaskEvents(taskId: string): Promise<TaskEvent[]>;
  getTaskEvent?(eventId: string): Promise<TaskEvent | null>;
  listAllTaskEvents(): Promise<TaskEvent[]>;
  getPostingChecklist(taskId: string): Promise<PostingChecklist | null>;
  getPostingChecklistByItemId(itemId: string): Promise<PostingChecklist | null>;
  togglePostingChecklistItem(input: { itemId: string; actorId: string }): Promise<PostingChecklistItem>;

  createDeadlineChangeRequest(input: {
    taskId: string;
    requestedBy: string;
    requestedDeadline: string;
    reason: string;
  }): Promise<DeadlineChangeRequest>;
  getDeadlineChangeRequest(requestId: string): Promise<DeadlineChangeRequest | null>;
  listDeadlineChangeRequests(): Promise<DeadlineChangeRequest[]>;
  resolveDeadlineChangeRequest(input: {
    requestId: string;
    resolvedBy: string;
    approve: boolean;
    resolutionNote?: string;
  }): Promise<DeadlineChangeRequest>;

  createReassignRequest(input: {
    taskId: string;
    requestedBy: string;
    requestedAssigneeId: string;
    reason: string;
  }): Promise<ReassignRequest>;
  getReassignRequest(requestId: string): Promise<ReassignRequest | null>;
  listReassignRequests(): Promise<ReassignRequest[]>;
  resolveReassignRequest(input: {
    requestId: string;
    resolvedBy: string;
    approve: boolean;
    resolutionNote?: string;
  }): Promise<ReassignRequest>;

  claimTaskNotification(input: { dedupeKey: string; recipientUserId: string }): Promise<boolean>;
  completeTaskNotification(input: {
    dedupeKey: string;
    recipientUserId: string;
    status: "SENT" | "FAILED";
    failureReason?: string;
  }): Promise<void>;

  claimTaskNotificationOutbox?(input: {
    workerId: string;
    limit: number;
  }): Promise<readonly TaskNotificationOutboxEntry[]>;
  completeTaskNotificationOutbox?(input: {
    deliveryId: string;
    workerId: string;
    succeeded: boolean;
    error?: string;
  }): Promise<void>;

  getRecurringDefinitionForTask(taskId: string): Promise<RecurringDefinition | null>;
  getRecurringDefinition(id: string): Promise<RecurringDefinition | null>;
  listDueRecurringDefinitions(now: string): Promise<RecurringDefinition[]>;
  listRecurringDefinitionsByAssignee(assigneeId: string): Promise<RecurringDefinition[]>;
  createRecurringDefinition(input: {
    sourceTaskId: string;
    createdBy: string;
    title: string;
    description: string | null;
    priority: TaskPriority;
    assigneeId: string;
    frequency: RecurrenceFrequency;
    weekday: number | null;
    dayOfMonth: number | null;
    localTime: string;
    endsOn: string | null;
    nextOccurrenceAt: string | null;
  }): Promise<RecurringDefinition>;
  updateRecurringDefinition(input: {
    id: string;
    frequency?: RecurrenceFrequency;
    weekday?: number | null;
    dayOfMonth?: number | null;
    localTime?: string;
    endsOn?: string | null;
    status?: RecurrenceStatus;
    nextOccurrenceAt?: string | null;
    pauseReason?: string | null;
    assigneeId?: string;
  }): Promise<RecurringDefinition>;
  generateRecurringOccurrence(input: {
    definitionId: string;
    scheduledOccurrenceAt: string;
    nextOccurrenceAt: string | null;
  }): Promise<Task | null>;

  claimReportDelivery(input: {
    reportType: "DAILY_MORNING" | "DAILY_EVENING" | "WEEKLY";
    intervalKey: string;
    recipientUserId: string;
  }): Promise<boolean>;
  completeReportDelivery(input: {
    reportType: "DAILY_MORNING" | "DAILY_EVENING" | "WEEKLY";
    intervalKey: string;
    recipientUserId: string;
    status: "SENT" | "FAILED" | "SKIPPED";
    failureReason?: string;
  }): Promise<void>;

  claimReminderDelivery(input: {
    taskId: string;
    deadline: string;
    reminderType: ReminderType;
  }): Promise<boolean>;
  completeReminderDelivery(input: {
    taskId: string;
    deadline: string;
    reminderType: ReminderType;
    status: "SENT" | "FAILED";
    failureReason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
