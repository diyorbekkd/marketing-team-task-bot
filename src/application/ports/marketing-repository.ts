import type { TeamRole } from "@/domain/permissions";
import type { TaskPriority, TaskStatus } from "@/domain/task";
import type { DeadlineChangeRequest, Task, TaskEvent, User } from "@/domain/models";

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
}

export interface MarketingRepository {
  registerTelegramUser(identity: TelegramIdentityInput): Promise<User>;
  getUserById(id: string): Promise<User | null>;
  getUserByTelegramId(telegramUserId: string): Promise<User | null>;
  findActiveUserByUsername(username: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  activateUser(userId: string, role: TeamRole): Promise<User>;

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
}
