import type { TeamRole } from "@/domain/permissions";
import type { TaskTemplate } from "@/domain/task-template";
import type { TaskPriority, TaskStatus } from "@/domain/task";
import type { ReminderType } from "@/domain/reminders";
import type {
  DeadlineChangeRequest,
  PostingChecklist,
  PostingChecklistItem,
  RecurrenceFrequency,
  RecurrenceStatus,
  RecurringDefinition,
  Task,
  TaskVideoBrief,
  VideoKind,
  TaskComment,
  TaskCheckpoint,
  TaskEvent,
  User,
  UserTaskPlan,
  WorkflowTemplate,
  WorkflowPlan,
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

export interface CreateBrowserTaskRecord extends CreateTaskRecord {
  readonly requestId: string;
  readonly requestHash: string;
  readonly manualCheckpoints: ReadonlyArray<{ title: string; dueAt: string | null }>;
  readonly videoBrief?: { kind: VideoKind; brief: Record<string, string | number | null> };
  readonly taskTemplate?: { templateId: string; eventOn: string; deadlineOverride: boolean };
}

export interface UpdateTaskRecord {
  readonly taskId: string;
  readonly actorId: string;
  readonly patch: Readonly<{
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    deadline?: string;
    assigneeId?: string;
    publicationAt?: string | null;
  }>;
}

export type TaskPageSort = "deadline_asc" | "deadline_desc" | "created_desc";

export interface TaskPageQuery {
  /** When present, keep results to tasks created by or assigned to this user. */
  readonly visibleToUserId?: string;
  readonly status?: TaskStatus;
  readonly priority?: TaskPriority;
  readonly assigneeId?: string;
  readonly creatorId?: string;
  readonly deadlineFrom?: string;
  readonly deadlineBefore?: string;
  readonly createdBefore?: string;
  readonly completedFrom?: string;
  readonly completedBefore?: string;
  readonly excludeTerminal?: boolean;
  readonly search?: string;
  readonly sort: TaskPageSort;
  readonly limit: number;
  readonly cursor?: Readonly<{ value: string; id: string }>;
}

export interface TaskPage {
  readonly tasks: Task[];
  readonly hasMore: boolean;
}

export interface NotificationOutboxRecord {
  readonly id: string;
  readonly dedupeKey: string;
  readonly notificationType: "ASSIGNMENT" | "BULK_ASSIGNMENT" | "WORKFLOW" | "REPORT" | "SHOOT_SCENARIO";
  readonly recipientUserId: string | null;
  readonly taskId: string | null;
  readonly payload: unknown;
  readonly status: "PENDING" | "CLAIMED" | "SENT" | "FAILED";
  readonly attemptCount: number;
}

export interface ReminderClaim {
  readonly claimed: boolean;
  readonly deliveries: Array<{
    readonly recipientUserId: string;
    readonly status: "SENT" | "FAILED";
    readonly reason?: string;
  }>;
}

export interface NotificationPreferences {
  readonly assignments: boolean;
  readonly workflow: boolean;
  readonly reminders: boolean;
  readonly dailyCheck: boolean;
  readonly reports: boolean;
}

export interface MarketingRepository {
  registerTelegramUser(identity: TelegramIdentityInput, expectedHeadTelegramUserId: string): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByTelegramId(telegramUserId: string): Promise<User | null>;
  createWebLoginChallenge(input: { browserHash: string; codeHash: string; expiresAt: string }): Promise<void>;
  approveWebLoginChallenge(input: { codeHash: string; userId: string; now: string }): Promise<boolean>;
  consumeWebLoginChallenge(input: { browserHash: string; now: string }): Promise<string | null>;
  /** Looks up by canonical Telegram username regardless of active state, so
   * callers can distinguish "no such username" from "exists but inactive". */
  findUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  activateUser(input: { userId: string; actorId: string; role: TeamRole }): Promise<User>;
  updateUserRole(input: { userId: string; actorId: string; role: TeamRole }): Promise<User>;
  deactivateUser(input: { userId: string; actorId: string }): Promise<User>;
  reactivateUser(input: { userId: string; actorId: string }): Promise<User>;

  createTask(input: CreateTaskRecord): Promise<Task>;
  createBrowserTask(input: CreateBrowserTaskRecord): Promise<Task>;
  listBrowserTasksAwaitingNotifications(limit: number): Promise<Array<{
    requestId: string; taskId: string; actorId: string;
  }>>;
  markBrowserTaskNotificationsQueued(requestId: string): Promise<void>;
  createTaskFromTemplate(input: CreateTaskRecord & { templateId: string; eventOn: string; deadlineOverride: boolean }): Promise<Task>;
  listTaskTemplates(): Promise<TaskTemplate[]>;
  saveTaskTemplateVersion(input: { actorId: string; sourceTemplateId: string | null; name: string;
    deadlineOffsetDays: number; deadlineLocalTime: string; checkpoints: TaskTemplate["checkpoints"] }): Promise<string>;
  archiveTaskTemplate(input: { actorId: string; templateId: string }): Promise<boolean>;
  getTaskTemplateInstance(taskId: string): Promise<{ eventOn: string; templateName: string; deadlineIsAuto: boolean } | null>;
  rebaseTaskTemplateEvent(input: { taskId: string; actorId: string; eventOn: string }): Promise<void>;
  createTaskWithVideoBrief(input: CreateTaskRecord & { videoBrief: {
    kind: VideoKind; brief: Record<string, string | number | null>;
  } }): Promise<Task>;
  getTaskVideoBrief(taskId: string): Promise<TaskVideoBrief | null>;
  saveTaskVideoBrief(input: { taskId: string; actorId: string; kind: VideoKind;
    brief: Record<string, string | number | null>; confirm: boolean }): Promise<TaskVideoBrief>;
  updateTask(input: UpdateTaskRecord): Promise<Task>;
  getTask(taskId: string): Promise<Task | null>;
  listTaskPage(input: TaskPageQuery): Promise<TaskPage>;
  listTasks(): Promise<Task[]>;
  listHomeTasks(visibleToUserId?: string): Promise<Task[]>;
  listReminderCandidates(input: { deadlineFrom: string; deadlineTo: string }): Promise<Task[]>;
  transitionTask(input: {
    taskId: string;
    actorId: string;
    newStatus: TaskStatus;
    reason?: string;
  }): Promise<Task>;
  reassignTask(input: { taskId: string; newAssigneeId: string; actorId: string }): Promise<Task>;
  listTaskEvents(taskId: string): Promise<TaskEvent[]>;
  listAllTaskEvents(): Promise<TaskEvent[]>;
  listTaskComments(taskId: string): Promise<TaskComment[]>;
  addTaskComment(input: {
    taskId: string;
    authorId: string;
    kind: "COMMENT" | "RESULT";
    body?: string;
    attachmentUrl?: string;
  }): Promise<TaskComment>;
  getPostingChecklist(taskId: string): Promise<PostingChecklist | null>;
  getPostingChecklistByItemId(itemId: string): Promise<PostingChecklist | null>;
  togglePostingChecklistItem(input: { itemId: string; actorId: string }): Promise<PostingChecklistItem>;
  getUserTaskPlan(userId: string, taskId: string): Promise<UserTaskPlan | null>;
  listUserTaskPlans(userId: string): Promise<UserTaskPlan[]>;
  saveUserTaskPlan(input: {
    userId: string; taskId: string; isImportant: boolean | null;
    urgentOverride: boolean | null; plannedOn: string | null; estimatedMinutes: number | null;
  }): Promise<UserTaskPlan>;
  listTaskCheckpoints(taskId: string): Promise<TaskCheckpoint[]>;
  listUserCheckpointsDueBetween(userId: string, from: string, before: string): Promise<TaskCheckpoint[]>;
  getTaskCheckpoint(id: string): Promise<TaskCheckpoint | null>;
  addTaskCheckpoint(input: { taskId: string; actorId: string; title: string; dueAt: string | null }): Promise<TaskCheckpoint>;
  toggleTaskCheckpoint(input: { id: string; actorId: string }): Promise<TaskCheckpoint>;
  completeTaskCheckpoint(input: { id: string; actorId: string }): Promise<TaskCheckpoint>;
  setTaskCheckpointDue(input: { id: string; actorId: string; dueAt: string | null }): Promise<TaskCheckpoint>;
  removeTaskCheckpoint(input: { id: string; actorId: string }): Promise<void>;

  createDeadlineChangeRequest(input: {
    taskId: string;
    requestedBy: string;
    requestedDeadline: string;
    reason: string;
  }): Promise<DeadlineChangeRequest>;
  getDeadlineChangeRequest(requestId: string): Promise<DeadlineChangeRequest | null>;
  listDeadlineChangeRequests(input?: { taskId?: string }): Promise<DeadlineChangeRequest[]>;
  resolveDeadlineChangeRequest(input: {
    requestId: string;
    resolvedBy: string;
    approve: boolean;
    resolutionNote?: string;
  }): Promise<DeadlineChangeRequest>;

  getRecurringDefinitionForTask(taskId: string, recurringDefinitionId?: string | null): Promise<RecurringDefinition | null>;
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
  listWorkflowTemplates(): Promise<WorkflowTemplate[]>;
  archiveWorkflowTemplate(id: string): Promise<boolean>;
  saveWorkflowTemplateVersion(input: {
    actorId: string;
    sourceTemplateId: string | null;
    name: string;
    description: string | null;
    steps: Array<{
      title: string; description: string | null; assigneeRole: TeamRole;
      priority: TaskPriority; estimatedMinutes: number | null; checkpointTitles: string[];
      videoKind: VideoKind | null;
    }>;
  }): Promise<string>;
  startWorkflowRun(input: {
    templateId: string;
    actorId: string;
    subject: string;
    firstDeadline: string;
    stepAssignments: Record<string, { ownerId: string; participantIds: string[] }>;
  }): Promise<Task>;
  getWorkflowPlan(runId: string): Promise<WorkflowPlan | null>;
  listWorkflowPlans(userId: string, isHead: boolean): Promise<WorkflowPlan[]>;
  submitWorkflowStepForReview(input: { taskId: string; actorId: string; nextDeadline: string | null }): Promise<Task>;
  completeSelfOwnedTask(input: { taskId: string; actorId: string; nextDeadline: string | null }): Promise<Task>;
  advanceWorkflowRun(input: { completedTaskId: string; actorId: string }): Promise<Task | null>;
  recoverWorkflowRuns(): Promise<Task[]>;

  enqueueNotification(input: {
    dedupeKey: string;
    notificationType: NotificationOutboxRecord["notificationType"];
    recipientUserId: string;
    taskId?: string;
    payload: unknown;
  }): Promise<NotificationOutboxRecord>;
  enqueueShootScenarioNotification(input: {
    dedupeKey: string; taskId: string; payload: unknown;
  }): Promise<NotificationOutboxRecord>;
  claimNotification(id: string): Promise<boolean>;
  claimDueNotifications(limit: number): Promise<NotificationOutboxRecord[]>;
  completeNotification(input: { id: string; sent: boolean; error?: string }): Promise<void>;
  getNotificationPreferences(userId: string): Promise<NotificationPreferences>;
  updateNotificationPreferences(userId: string, preferences: NotificationPreferences): Promise<NotificationPreferences>;

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
  }): Promise<ReminderClaim>;
  completeReminderDelivery(input: {
    taskId: string;
    deadline: string;
    reminderType: ReminderType;
    status: "SENT" | "FAILED";
    failureReason?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
