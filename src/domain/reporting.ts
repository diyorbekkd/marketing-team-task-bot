import type { DeadlineChangeRequest, Task, TaskEvent, User } from "./models";
import { containsPostingTag } from "./recurrence";

const DAY_MS = 86_400_000;
const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION"]);
const TIMED_STATUSES = ["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION"] as const;

export function isOpenTask(task: Task): boolean { return OPEN_STATUSES.has(task.status); }

export function tashkentDayRange(now: Date) {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TASHKENT_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

export function tashkentWeekRange(now: Date) {
  const day = tashkentDayRange(now);
  const local = new Date(day.start.getTime() + TASHKENT_OFFSET_MS);
  const weekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  return { start: new Date(day.start.getTime() - (weekday - 1) * DAY_MS), end: now };
}

export function tashkentDateKey(now: Date): string {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

function inRange(value: string | null, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function assignedTo(tasks: readonly Task[], userId?: string) {
  return userId ? tasks.filter((task) => task.assigneeId === userId) : [...tasks];
}

export interface WorkloadMetrics {
  open: number;
  inProgress: number;
  highPriority: number;
  dueToday: number;
  dueNext48h: number;
  overdue: number;
  blocked: number;
  review: number;
}

export function workloadMetrics(tasks: readonly Task[], now: Date, userId?: string): WorkloadMetrics {
  const scoped = assignedTo(tasks, userId).filter(isOpenTask);
  const today = tashkentDayRange(now);
  const in48h = now.getTime() + 48 * 60 * 60 * 1000;
  return {
    open: scoped.length,
    inProgress: scoped.filter((task) => task.status === "IN_PROGRESS").length,
    highPriority: scoped.filter((task) => task.priority === "high").length,
    dueToday: scoped.filter((task) => inRange(task.deadline, today.start, today.end)).length,
    dueNext48h: scoped.filter((task) => {
      const deadline = new Date(task.deadline).getTime();
      return deadline >= now.getTime() && deadline <= in48h;
    }).length,
    overdue: scoped.filter((task) => new Date(task.deadline).getTime() < now.getTime()).length,
    blocked: scoped.filter((task) => task.status === "BLOCKED").length,
    review: scoped.filter((task) => task.status === "REVIEW").length,
  };
}

export interface AnalyticsMetrics {
  windowDays: number;
  created: number;
  completed: number;
  onTimeCompleted: number;
  onTimeCompletionRate: number | null;
  carryOver: number;
  currentOverdue: number;
  revisionCount: number;
  revisionRate: number | null;
  deadlineChangeRequests: number;
  averageCycleHours: number | null;
  averageStatusHours: Partial<Record<(typeof TIMED_STATUSES)[number], number>>;
  averageBlockedHours: number | null;
  averageReviewHours: number | null;
  workload: WorkloadMetrics;
  posting: { created: number; completed: number; currentOpen: number };
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function durationSegments(task: Task, events: readonly TaskEvent[], start: Date, end: Date) {
  const changes = events.filter((event) => event.taskId === task.id && event.eventType === "STATUS_CHANGED")
    .slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  let status = "ASSIGNED";
  let segmentStart = new Date(task.createdAt).getTime();
  const result: Array<{ status: string; hours: number }> = [];
  for (const event of changes) {
    const at = new Date(event.createdAt).getTime();
    const overlapStart = Math.max(segmentStart, start.getTime());
    const overlapEnd = Math.min(at, end.getTime());
    if (overlapEnd > overlapStart) result.push({ status, hours: (overlapEnd - overlapStart) / 3_600_000 });
    status = typeof event.newValue === "string" ? event.newValue : status;
    segmentStart = at;
  }
  const terminal = task.completedAt ?? task.cancelledAt;
  const finalEnd = Math.min(terminal ? new Date(terminal).getTime() : end.getTime(), end.getTime());
  const overlapStart = Math.max(segmentStart, start.getTime());
  if (finalEnd > overlapStart) result.push({ status, hours: (finalEnd - overlapStart) / 3_600_000 });
  return result;
}

export function calculateAnalytics(input: {
  tasks: readonly Task[];
  events: readonly TaskEvent[];
  deadlineRequests: readonly DeadlineChangeRequest[];
  now: Date;
  windowDays?: number;
  userId?: string;
}): AnalyticsMetrics {
  const windowDays = input.windowDays ?? 30;
  const end = input.now;
  const start = new Date(end.getTime() - windowDays * DAY_MS);
  const tasks = assignedTo(input.tasks, input.userId);
  const taskIds = new Set(tasks.map((task) => task.id));
  const events = input.events.filter((event) => taskIds.has(event.taskId));
  const requests = input.deadlineRequests.filter((request) => taskIds.has(request.taskId));
  const completed = tasks.filter((task) => inRange(task.completedAt, start, end));
  const revisions = events.filter((event) => event.eventType === "REVISION_REQUESTED" && inRange(event.createdAt, start, end));
  const completedWithRevision = new Set(revisions.map((event) => event.taskId));
  const segments = tasks.flatMap((task) => durationSegments(task, events, start, end));
  const averageStatusHours: AnalyticsMetrics["averageStatusHours"] = {};
  for (const status of TIMED_STATUSES) {
    const values = segments.filter((segment) => segment.status === status).map((segment) => segment.hours);
    const value = average(values);
    if (value !== null) averageStatusHours[status] = value;
  }
  const cycleHours = completed.map((task) =>
    (new Date(task.completedAt!).getTime() - new Date(task.createdAt).getTime()) / 3_600_000);
  return {
    windowDays,
    created: tasks.filter((task) => inRange(task.createdAt, start, end)).length,
    completed: completed.length,
    onTimeCompleted: completed.filter((task) => new Date(task.completedAt!).getTime() <= new Date(task.deadline).getTime()).length,
    onTimeCompletionRate: completed.length
      ? completed.filter((task) => new Date(task.completedAt!).getTime() <= new Date(task.deadline).getTime()).length / completed.length
      : null,
    carryOver: tasks.filter((task) => new Date(task.createdAt).getTime() < end.getTime() && isOpenTask(task)).length,
    currentOverdue: tasks.filter((task) => isOpenTask(task) && new Date(task.deadline).getTime() < end.getTime()).length,
    revisionCount: revisions.length,
    revisionRate: completed.length
      ? completed.filter((task) => completedWithRevision.has(task.id)).length / completed.length
      : null,
    deadlineChangeRequests: requests.filter((request) => inRange(request.createdAt, start, end)).length,
    averageCycleHours: average(cycleHours),
    averageStatusHours,
    averageBlockedHours: average(segments.filter((segment) => segment.status === "BLOCKED").map((segment) => segment.hours)),
    averageReviewHours: average(segments.filter((segment) => segment.status === "REVIEW").map((segment) => segment.hours)),
    workload: workloadMetrics(tasks, end),
    posting: {
      created: tasks.filter((task) => containsPostingTag(task.title, task.description) && inRange(task.createdAt, start, end)).length,
      completed: completed.filter((task) => containsPostingTag(task.title, task.description)).length,
      currentOpen: tasks.filter((task) => containsPostingTag(task.title, task.description) && isOpenTask(task)).length,
    },
  };
}

export interface WeeklyMetrics {
  created: number;
  completed: number;
  onTimeCompleted: number;
  overdue: number;
  currentOverdue: number;
  blocked: number;
  revisions: number;
  deadlineChanges: number;
  carryOver: number;
}

export function weeklyMetrics(input: {
  tasks: readonly Task[];
  events: readonly TaskEvent[];
  requests: readonly DeadlineChangeRequest[];
  start: Date;
  end: Date;
  userId?: string;
}): WeeklyMetrics {
  const tasks = assignedTo(input.tasks, input.userId);
  const taskIds = new Set(tasks.map((task) => task.id));
  const completed = tasks.filter((task) => inRange(task.completedAt, input.start, input.end));
  return {
    created: tasks.filter((task) => inRange(task.createdAt, input.start, input.end)).length,
    completed: completed.length,
    onTimeCompleted: completed.filter((task) => new Date(task.completedAt!).getTime() <= new Date(task.deadline).getTime()).length,
    overdue: tasks.filter((task) => inRange(task.deadline, input.start, input.end)
      && (!task.completedAt || new Date(task.completedAt).getTime() > new Date(task.deadline).getTime())).length,
    currentOverdue: tasks.filter((task) => isOpenTask(task) && new Date(task.deadline).getTime() < input.end.getTime()).length,
    blocked: input.events.filter((event) => taskIds.has(event.taskId) && event.eventType === "TASK_BLOCKED"
      && inRange(event.createdAt, input.start, input.end)).length,
    revisions: input.events.filter((event) => taskIds.has(event.taskId) && event.eventType === "REVISION_REQUESTED"
      && inRange(event.createdAt, input.start, input.end)).length,
    deadlineChanges: input.requests.filter((request) => taskIds.has(request.taskId) && request.status === "APPROVED"
      && inRange(request.resolvedAt, input.start, input.end)).length,
    carryOver: tasks.filter((task) => new Date(task.createdAt).getTime() < input.end.getTime() && isOpenTask(task)).length,
  };
}

export function formatTaskTime(deadline: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(new Date(deadline));
}

export function activeUsers(users: readonly User[]): User[] {
  return users.filter((user) => user.isActive && /^\d+$/.test(user.telegramUserId));
}
