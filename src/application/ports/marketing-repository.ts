import type { TeamRole } from "@/domain/permissions";
import type { TaskPriority, TaskStatus } from "@/domain/task";
import type {
  DeadlineChangeRequest,
  PostingChecklist,
  PostingChecklistItem,
  RecurrenceFrequency,
  RecurrenceStatus,
  RecurringDefinition,
  Task,
  TaskEvent,
  User,
} from "@/domain/models";

export interface TelegramIdentityInput {
  readonly telegramUserId: string;
  readonly telegramUsername?: string;
  readonly displayName: string;
}

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
  findActiveUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  activateUser(userId: string, role: TeamRole): Promise<User>;
  updateUserRole(userId: string, role: TeamRole): Promise<User>;

  createTask(input: CreateTaskRecord): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  listTasks(): Promise<Task[]>;
  transitionTask(input: {
    taskId: string;
    actorId: string;
    newStatus: TaskStatus;
    reason?: string;
  }): Promise<Task>;
  listTaskEvents(taskId: string): Promise<TaskEvent[]>;
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

  getRecurringDefinitionForTask(taskId: string): Promise<RecurringDefinition | null>;
  getRecurringDefinition(id: string): Promise<RecurringDefinition | null>;
  listDueRecurringDefinitions(now: string): Promise<RecurringDefinition[]>;
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
}
