"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { t } from "@/i18n";
import { CalendarView } from "./CalendarView";
import { MyDayPanel } from "./MyDayPanel";
import { TaskPlanningPanel, type Checkpoint, type PersonalPlan } from "./TaskPlanningPanel";
import { WebBotLogin } from "./WebBotLogin";
import type { DayPlanGroup } from "@/domain/planning";
import "./mini-app.css";

// ─── Types ────────────────────────────────────────────────────────────────────

type Role =
  | "OPERATOR_VIDEO_EDITOR"
  | "CONTENT_MARKETER"
  | "DIGITAL_MARKETER"
  | "SMM_MANAGER"
  | "HEAD_OF_MARKETING";

type TaskStatus =
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "REVIEW"
  | "REVISION"
  | "DONE"
  | "CANCELLED";

type Priority = "low" | "normal" | "high";
type ThemePreference = "light" | "dark" | "system";

interface User {
  id: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  deactivatedAt?: string | null;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
}

interface Task {
  id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  assigneeId: string;
  creatorId: string;
  deadline: string;
  publicationAt?: string | null;
  blockedReason?: string | null;
  createdAt: string;
  updatedAt: string;
  recurringDefinitionId?: string | null;
  scheduledOccurrenceAt?: string | null;
}

interface TaskEvent {
  id: string;
  eventType: string;
  actorId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
  oldValue?: unknown;
  newValue?: unknown;
}

interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  kind: "COMMENT" | "RESULT";
  body: string | null;
  attachmentUrl: string | null;
  createdAt: string;
}

interface DeadlineRequest {
  id: string;
  taskId: string;
  requestedBy: string;
  currentDeadline: string;
  requestedDeadline: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  resolutionNote?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

interface TaskDetail {
  task: Task;
  events: TaskEvent[];
  comments: TaskComment[];
  deadlineRequests: DeadlineRequest[];
  postingChecklist: PostingChecklist | null;
  recurringDefinition: RecurringDefinition | null;
  personalPlan?: PersonalPlan | null;
  checkpoints?: Checkpoint[];
}

interface PostingChecklistItem {
  id: string;
  label: string;
  position: number;
  isCompleted: boolean;
}

interface PostingChecklist {
  id: string;
  taskId: string;
  kind: "POSTING";
  items: PostingChecklistItem[];
}

interface RecurringDefinition {
  id: string;
  sourceTaskId: string;
  createdBy: string;
  frequency: "WEEKDAYS" | "WEEKLY" | "MONTHLY";
  weekday: number | null;
  dayOfMonth: number | null;
  localTime: string;
  endsOn: string | null;
  status: "ACTIVE" | "PAUSED" | "STOPPED";
  nextOccurrenceAt: string | null;
  pauseReason?: string | null;
  assigneeId?: string;
}

interface WorkloadMetrics {
  open: number; inProgress: number; highPriority: number; dueToday: number;
  dueNext48h: number; overdue: number; blocked: number; review: number;
}

interface AnalyticsMetrics {
  windowDays: number; created: number; completed: number; onTimeCompleted: number;
  onTimeCompletionRate: number | null; carryOver: number; currentOverdue: number;
  revisionCount: number; revisionRate: number | null; deadlineChangeRequests: number;
  averageCycleHours: number | null; averageStatusHours: Partial<Record<TaskStatus, number>>;
  averageBlockedHours: number | null; averageReviewHours: number | null; workload: WorkloadMetrics;
  posting: { created: number; completed: number; currentOpen: number };
}

interface AnalyticsResponse {
  generatedAt: string;
  metrics: AnalyticsMetrics;
  team: Array<{ user: User; metrics: AnalyticsMetrics; workload: WorkloadMetrics }>;
}

interface TaskPagination {
  pageSize: number;
  hasMore: boolean;
  nextCursor: string | null;
}

interface TaskQueryOptions {
  search: string;
  status: "" | TaskStatus;
  priority: "" | Priority;
  assigneeId: string;
  deadlineRange: "" | "today" | "next_7_days" | "overdue";
  sort: "deadline_asc" | "deadline_desc" | "created_desc";
  reportView?: "open" | "completed" | "carry_over" | "overdue";
}

interface NotificationPreferences {
  assignments: boolean;
  workflow: boolean;
  reminders: boolean;
  dailyCheck: boolean;
  reports: boolean;
}

interface WorkflowTemplateStep {
  id: string;
  position: number;
  title: string;
  description: string | null;
  assigneeRole: Role;
  priority: Priority;
  dueAfterHours: number;
}

interface WorkflowTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  steps: WorkflowTemplateStep[];
}

type AssignmentNotificationResult =
  | { status: "SENT" }
  | { status: "QUEUED" | "SKIPPED" }
  | { status: "FAILED"; reason: "ASSIGNEE_NOT_ONBOARDED" | "DELIVERY_FAILED" };

type Filter = "my" | "created" | "today" | "overdue" | "team" | "review" | "blocked";
type BackendScope = "my" | "created" | "today" | "overdue" | "team" | "review";
type ViewMode = "list" | "kanban";
type Nav = "home" | "tasks" | "calendar" | "team" | "reports";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  ...t.taskStatus,
};

const STATUS_ORDER: TaskStatus[] = [
  "ASSIGNED",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "REVISION",
  "DONE",
  "CANCELLED",
];

const PRIORITY_LABELS: Record<Priority, string> = {
  ...t.priority,
};

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

const RECURRENCE_STATUS_LABELS: Record<RecurringDefinition["status"], string> = {
  ACTIVE: "Faol",
  PAUSED: "Vaqtincha to‘xtatilgan",
  STOPPED: "To‘xtatilgan",
};

const ROLE_LABELS: Record<Role, string> = {
  ...t.role,
};

const EVENT_LABELS: Record<string, string> = {
  TASK_CREATED: "Vazifa yaratildi",
  TASK_ACCEPTED: "Vazifa qabul qilindi",
  STATUS_CHANGED: "Holat o‘zgardi",
  TITLE_CHANGED: "Nomi o‘zgardi",
  DESCRIPTION_CHANGED: "Tavsifi o‘zgardi",
  PRIORITY_CHANGED: "Ustuvorligi o‘zgardi",
  DEADLINE_CHANGE_REQUESTED: "Muddat o‘zgarishi so‘raldi",
  DEADLINE_CHANGE_APPROVED: "Muddat so‘rovi tasdiqlandi",
  DEADLINE_CHANGE_REJECTED: "Muddat so‘rovi rad etildi",
  DEADLINE_CHANGED: "Muddat o‘zgardi",
  ASSIGNEE_CHANGED: "Mas’ul o‘zgardi",
  TASK_BLOCKED: "Vazifa bloklandi",
  TASK_UNBLOCKED: "Blok olib tashlandi",
  REVIEW_REQUESTED: "Tekshiruvga yuborildi",
  REVISION_REQUESTED: "Tuzatishga qaytarildi",
  TASK_COMPLETED: "Vazifa bajarildi",
  TASK_CANCELLED: "Vazifa bekor qilindi",
  TASK_REOPENED: "Vazifa qayta ochildi",
  POSTING_CHECKLIST_CREATED: "Joylash ro‘yxati yaratildi",
  POSTING_CHECKLIST_ITEM_TOGGLED: "Joylash bandi yangilandi",
  RECURRING_TASK_GENERATED: "Takroriy vazifa yaratildi",
  PUBLICATION_DATE_CHANGED: "Publikatsiya sanasi o‘zgardi",
  COMMENT_ADDED: "Izoh qo‘shildi",
  RESULT_SUBMITTED: "Natija topshirildi",
  WORKFLOW_STARTED: "Ish jarayoni boshlandi",
  WORKFLOW_STEP_ACTIVATED: "Keyingi bosqich faollashdi",
  WORKFLOW_COMPLETED: "Ish jarayoni yakunlandi",
};

const ACTIVATION_ROLES: Role[] = [
  "OPERATOR_VIDEO_EDITOR",
  "CONTENT_MARKETER",
  "DIGITAL_MARKETER",
  "SMM_MANAGER",
];

const FILTER_LABELS: Record<Filter, string> = {
  ...t.taskFilter,
};

const EMPTY_COPY: Record<Filter, string> = {
  my: "Sizga hali vazifa biriktirilmagan.",
  created: "Siz hali vazifa yaratmagansiz.",
  today: "Bugun vazifa yo‘q.",
  overdue: "Kechikkan vazifa yo‘q.",
  team: "Jamoada hali vazifa yo‘q.",
  review: "Tekshiruv kutayotgan vazifa yo‘q.",
  blocked: "Bloklangan vazifa yo‘q.",
};

function isTerminal(status: TaskStatus): boolean {
  return status === "DONE" || status === "CANCELLED";
}

function scopeForFilter(filter: Filter, isHead: boolean): BackendScope {
  return filter === "blocked" ? (isHead ? "team" : "my") : filter;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const TZ = "Asia/Tashkent";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("uz-UZ", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("uz-UZ", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTZDateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { year: map.year, month: map.month, day: map.day };
}

function isToday(iso: string | null | undefined) {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const dp = getTZDateParts(d);
  const np = getTZDateParts(new Date());
  return dp.year === np.year && dp.month === np.month && dp.day === np.day;
}

function isOverdue(iso: string | null | undefined) {
  if (!iso) return false;
  return new Date(iso) < new Date();
}

function tashkentGreeting(): string {
  const hour = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours();
  if (hour < 12) return "Xayrli tong";
  if (hour < 18) return "Xayrli kun";
  return "Xayrli kech";
}

/** Convert a datetime-local string to Asia/Tashkent offset-bearing ISO string (+05:00) */
function localDatetimeToISO(local: string): string {
  if (!local) return "";
  // local is "YYYY-MM-DDTHH:mm" — append seconds and +05:00 offset
  const withSeconds = local.length === 16 ? local + ":00" : local;
  return withSeconds + "+05:00";
}

function isoToTashkentLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "";
  const dateParts = getTZDateParts(date);
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}T${timeParts}`;
}

/** Sparing haptic feedback for a handful of meaningful moments (task
 * created, a checklist item toggled, a workflow action completing) — never
 * wired to every tap. Silently does nothing outside Telegram or on older
 * clients without HapticFeedback. */
function haptic(kind: "success" | "warning" | "error" | "selection" | "impact") {
  const feedback = window.Telegram?.WebApp?.HapticFeedback;
  if (!feedback) return;
  if (kind === "selection") feedback.selectionChanged();
  else if (kind === "impact") feedback.impactOccurred("light");
  else feedback.notificationOccurred(kind);
}

/** Recognizably technical failures get a human message; validation messages
 * from the API are already human-authored and are shown as-is. */
function friendlyError(message: string | null): string | null {
  if (!message) return message;
  const technical = /fetch|network|unexpected token|http 5\d\d|internal server error|typeerror/i;
  return technical.test(message) ? "Xatolik yuz berdi. Qayta urinib ko‘ring." : message;
}

async function apiFetch<T>(
  url: string,
  opts?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(url, { credentials: "same-origin", ...opts });
    const json = await res.json();
    if (!res.ok) {
      return { data: null, error: json.error ?? `HTTP ${res.status}` };
    }
    return { data: json as T, error: null };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

// ─── Derived view helpers ───────────────────────────────────────────────────

function countsFor(tasks: Task[]) {
  const open = tasks.filter((t) => !isTerminal(t.status));
  return {
    today: open.filter((t) => isToday(t.deadline)).length,
    overdue: open.filter((t) => isOverdue(t.deadline)).length,
    blocked: open.filter((t) => t.status === "BLOCKED").length,
    review: open.filter((t) => t.status === "REVIEW").length,
  };
}

function workloadFor(tasks: Task[], users: User[]) {
  return users
    .filter((u) => u.isActive)
    .map((u) => {
      const mine = tasks.filter((t) => t.assigneeId === u.id && !isTerminal(t.status));
      return {
        user: u,
        open: mine.length,
        today: mine.filter((t) => isToday(t.deadline)).length,
        overdue: mine.filter((t) => isOverdue(t.deadline)).length,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.today - a.today || b.open - a.open);
}

function priorityTasks(tasks: Task[], limit = 5) {
  return tasks
    .filter((t) => !isTerminal(t.status))
    .slice()
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        new Date(a.deadline).getTime() - new Date(b.deadline).getTime()
    )
    .slice(0, limit);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MiniApp() {
  const [authState, setAuthState] = useState<
    "loading" | "no-telegram" | "authed"
  >("loading");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [nav, setNav] = useState<Nav>("home");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<Filter>("my");
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [tasksNextCursor, setTasksNextCursor] = useState<string | null>(null);
  const [taskQuery, setTaskQuery] = useState<TaskQueryOptions>({
    search: "",
    status: "",
    priority: "",
    assigneeId: "",
    deadlineRange: "",
    sort: "deadline_asc",
  });
  const [homeTasks, setHomeTasks] = useState<Task[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPendingUsers, setShowPendingUsers] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [roleEditUser, setRoleEditUser] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [themePreference, setThemePreference] = useState<ThemePreference>("light");
  const [taskNotice, setTaskNotice] = useState<{ kind: "success" | "warning"; text: string } | null>(null);
  const [planningRefreshKey, setPlanningRefreshKey] = useState(0);
  // Tracks whether the active team list has ever loaded successfully, so the
  // assignee picker can block submission with a loading/retry state instead
  // of a false "not found" while the first fetch is still in flight.
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const isHead = currentUser?.role === "HEAD_OF_MARKETING";

  // AbortControllers so a slow, superseded request can never overwrite state
  // written by a newer one (e.g. rapidly switching Tasks-tab filters).
  const bootstrapAbortRef = useRef<AbortController | null>(null);
  const usersAbortRef = useRef<AbortController | null>(null);
  const tasksAbortRef = useRef<AbortController | null>(null);
  const homeAbortRef = useRef<AbortController | null>(null);

  // Auth on mount
  useEffect(() => {
    (async () => {
      const initData = window.Telegram?.WebApp?.initData ?? "";

      if (initData) {
        const { data, error } = await apiFetch<{ user: User }>(
          "/api/auth/telegram",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ initData }),
          }
        );
        if (data?.user) {
          setCurrentUser(data.user);
          setAuthState("authed");
          window.Telegram?.WebApp?.ready();
          window.Telegram?.WebApp?.expand();
          return;
        }
        if (error) {
          setAuthError(error);
          setAuthState("no-telegram");
          return;
        }
      }

      // Fallback: existing session
      const { data } = await apiFetch<{ user: User }>("/api/auth/me");
      if (data?.user) {
        setCurrentUser(data.user);
        setAuthState("authed");
        return;
      }

      const webLoginError = new URLSearchParams(window.location.search).get("web_login");
      if (webLoginError) {
        setAuthError(webLoginError === "inactive"
          ? "Bu Telegram hisobi aktiv jamoa a’zosi emas. Rahbar bilan bog‘laning."
          : webLoginError === "invalid"
            ? "Telegram kirish so‘rovi eskirgan. Qayta urinib ko‘ring."
            : "Telegram tasdig‘i saytga qaytmadi. Bot orqali kirib ko‘ring.");
      }
      setAuthState("no-telegram");
    })();
  }, []);

  // A quiet light palette is the default. The member can choose dark or
  // follow Telegram/device in Profile; the choice stays on this device.
  useEffect(() => {
    const saved = window.localStorage.getItem("marketing-theme");
    const choice: ThemePreference = saved === "dark" || saved === "system" ? saved : "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemePreference(choice);
  }, []);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = webApp ? webApp.colorScheme === "dark" : systemDark.matches;
      document.documentElement.dataset.theme = themePreference === "system"
        ? (dark ? "dark" : "light") : themePreference;
    };
    applyTheme();
    webApp?.onEvent("themeChanged", applyTheme);
    systemDark.addEventListener("change", applyTheme);
    return () => {
      webApp?.offEvent("themeChanged", applyTheme);
      systemDark.removeEventListener("change", applyTheme);
    };
  }, [themePreference]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.documentElement;
        const keyboardCovered = window.innerHeight - viewport.height - viewport.offsetTop > 120;
        if (keyboardCovered) {
          root.style.setProperty("--ma-keyboard-height", `${viewport.height}px`);
          root.style.setProperty("--ma-keyboard-top", `${viewport.offsetTop}px`);
        } else {
          root.style.removeProperty("--ma-keyboard-height");
          root.style.removeProperty("--ma-keyboard-top");
        }
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) return;
        const panel = active.closest<HTMLElement>(".ma-panel");
        if (!panel) return;
        const field = active.getBoundingClientRect();
        const visible = panel.getBoundingClientRect();
        if (field.bottom > visible.bottom - 20) panel.scrollTop += field.bottom - visible.bottom + 28;
        else if (field.top < visible.top + 68) panel.scrollTop -= visible.top + 76 - field.top;
      });
    };
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("input", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("input", update);
      window.cancelAnimationFrame(frame);
      document.documentElement.style.removeProperty("--ma-keyboard-height");
      document.documentElement.style.removeProperty("--ma-keyboard-top");
    };
  }, []);

  // Load users (used for later targeted refreshes, e.g. after activating a
  // pending user — the initial load goes through loadBootstrap instead).
  const loadUsers = useCallback(async () => {
    usersAbortRef.current?.abort();
    const controller = new AbortController();
    usersAbortRef.current = controller;
    const { data, error } = await apiFetch<{ users: User[] }>("/api/users", { signal: controller.signal });
    if (controller.signal.aborted) return;
    if (data?.users) {
      setUsers(data.users);
      setUsersLoaded(true);
      setUsersError(null);
    } else {
      setUsersError(friendlyError(error) ?? "Jamoani yuklab bo‘lmadi");
    }
  }, []);

  // Load the Tasks-tab list for the active filter. Only called while the
  // Tasks tab is actually open (see the effect below) — not on every mount.
  const loadTasks = useCallback(
    async (f: Filter, cursor?: string, silent = false) => {
      tasksAbortRef.current?.abort();
      const controller = new AbortController();
      tasksAbortRef.current = controller;
      if (!silent) {
        if (cursor) setLoadingMoreTasks(true);
        else setLoadingTasks(true);
      }
      setTasksError(null);
      const scope = scopeForFilter(f, isHead);
      const params = new URLSearchParams({ scope, pageSize: "50", sort: taskQuery.sort });
      if (cursor) params.set("cursor", cursor);
      if (taskQuery.search) params.set("search", taskQuery.search);
      if (taskQuery.priority) params.set("priority", taskQuery.priority);
      if (f === "blocked") params.set("status", "BLOCKED");
      else if (taskQuery.status) params.set("status", taskQuery.status);
      const assigneeId = memberFilter || taskQuery.assigneeId;
      if (assigneeId) params.set("assigneeId", assigneeId);
      if (taskQuery.deadlineRange) params.set("deadlineRange", taskQuery.deadlineRange);
      if (taskQuery.reportView) params.set("reportView", taskQuery.reportView);
      const { data, error } = await apiFetch<{ tasks: Task[]; pagination: TaskPagination }>(
        `/api/tasks?${params.toString()}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (cursor) setLoadingMoreTasks(false);
      else setLoadingTasks(false);
      if (data?.tasks) {
        setTasks((current) => cursor
          ? [...new Map([...current, ...data.tasks].map((task) => [task.id, task])).values()]
          : data.tasks);
        setTasksNextCursor(data.pagination.nextCursor);
      } else {
        setTasksError(friendlyError(error) ?? "Vazifalarni yuklab bo‘lmadi");
      }
    },
    [isHead, memberFilter, taskQuery]
  );

  // Load the Home/Team overview dataset (team-wide for Head, personal otherwise)
  const loadHome = useCallback(async (silent = false) => {
    homeAbortRef.current?.abort();
    const controller = new AbortController();
    homeAbortRef.current = controller;
    if (!silent) setHomeLoading(true);
    setHomeError(null);
    const { data, error } = await apiFetch<{ users: User[]; tasks: Task[] }>(
      "/api/bootstrap",
      { signal: controller.signal }
    );
    if (controller.signal.aborted) return;
    setHomeLoading(false);
    if (data?.tasks) {
      setHomeTasks(data.tasks);
      setUsers(data.users);
      setUsersLoaded(true);
      setUsersError(null);
    }
    else setHomeError(friendlyError(error) ?? "Umumiy ma’lumotni yuklab bo‘lmadi");
  }, []);

  // First-paint load: one round trip for the active team list plus the Home
  // task summary, instead of three separate sequential/parallel fetches.
  // Runs once per authed session — the Tasks-tab list is deliberately NOT
  // included here; it loads lazily when the Tasks tab is opened.
  const loadBootstrap = useCallback(async () => {
    bootstrapAbortRef.current?.abort();
    const controller = new AbortController();
    bootstrapAbortRef.current = controller;
    setHomeLoading(true);
    setHomeError(null);
    const { data, error } = await apiFetch<{ users: User[]; tasks: Task[] }>(
      "/api/bootstrap",
      { signal: controller.signal }
    );
    if (controller.signal.aborted) return;
    setHomeLoading(false);
    if (data) {
      setUsers(data.users);
      setUsersLoaded(true);
      setUsersError(null);
      setHomeTasks(data.tasks);
    } else {
      const message = friendlyError(error) ?? "Umumiy ma’lumotni yuklab bo‘lmadi";
      setHomeError(message);
      setUsersError(message);
    }
  }, []);

  useEffect(() => {
    if (authState !== "authed") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadBootstrap();
    // Deliberately run once per authed session, not on every render of
    // loadBootstrap (which is stable/[]) — this is the one-time first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Lazy-load the Tasks-tab list only once that tab is actually opened, and
  // whenever its filter changes while it stays open.
  useEffect(() => {
    if (authState !== "authed" || nav !== "tasks") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks(filter);
  }, [authState, nav, filter, memberFilter, taskQuery, loadTasks]);

  const refreshAll = useCallback(() => {
    void loadHome(true);
    if (nav === "tasks") void loadTasks(filter, undefined, true);
  }, [loadHome, nav, loadTasks, filter]);

  // Home/Team retry: if the team list never loaded, re-run the combined
  // bootstrap fetch (it also failed); otherwise just retry the task summary.
  const retryHome = useCallback(() => {
    if (!usersLoaded) void loadBootstrap();
    else void loadHome();
  }, [usersLoaded, loadBootstrap, loadHome]);

  const goToFilter = useCallback((f: Filter) => {
    setMemberFilter(null);
    setTaskQuery((current) => ({ ...current, reportView: undefined }));
    setFilter(f);
    setNav("tasks");
  }, []);

  const changeFilter = useCallback((f: Filter) => {
    setMemberFilter(null);
    setTaskQuery((current) => ({ ...current, reportView: undefined }));
    setFilter(f);
  }, []);

  const openReportTasks = useCallback((reportView: NonNullable<TaskQueryOptions["reportView"]>) => {
    setMemberFilter(null);
    setFilter(isHead ? "team" : "my");
    setTaskQuery({ search: "", status: "", priority: "", assigneeId: "", deadlineRange: "", sort: "deadline_asc", reportView });
    setNav("tasks");
  }, [isHead]);

  const selectMember = useCallback((userId: string) => {
    setMemberFilter(userId);
    setFilter("team");
    setNav("tasks");
  }, []);

  const handleRoleSaved = useCallback((updated: User) => {
    setRoleEditUser(null);
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, role: updated.role } : u)));
    setCurrentUser((prev) => (prev && prev.id === updated.id ? { ...prev, role: updated.role } : prev));
    setTaskNotice({ kind: "success", text: `Rol yangilandi: ${ROLE_LABELS[updated.role]}.` });
  }, []);

  if (authState === "loading") {
    return (
      <div className="ma-center">
        <div className="ma-spinner" aria-label="Yuklanmoqda" />
      </div>
    );
  }

  if (authState === "no-telegram") {
    const inactiveMessage = authError && /aktiv|no longer active/i.test(authError) ? authError : null;
    return (
      <div className="ma-center">
        <div className="ma-no-tg">
          <div className="ma-no-tg-icon" aria-hidden="true">M</div>
          <p>{inactiveMessage ? "Siz faol jamoa tarkibida emassiz." : "Marketing ish maydoniga kiring"}</p>
          <span className="ma-muted">
            {inactiveMessage ?? authError ?? "Botdagi ulangan hisobingiz bilan webda kiring."}
          </span>
          {!inactiveMessage && <WebBotLogin />}
        </div>
      </div>
    );
  }

  const pendingUsers = users.filter((u) => !u.isActive && !u.deactivatedAt);
  const inactiveMembers = users.filter((u) => !u.isActive && u.deactivatedAt);
  const visibleTasks = memberFilter && filter === "team"
    ? tasks.filter((t) => t.assigneeId === memberFilter)
    : tasks;
  const memberFilterUser = memberFilter ? users.find((u) => u.id === memberFilter) ?? null : null;

  return (
    <div className="ma-shell">
      <header className="ma-topbar">
        <div className="ma-brand" aria-hidden="true">M</div>
        <button className="ma-topbar-text ma-topbar-identity" onClick={() => setShowProfile(true)}>
          <span className="ma-eyebrow">{currentUser ? ROLE_LABELS[currentUser.role] : "Marketing workspace"}</span>
          <span className="ma-username">{currentUser?.displayName}</span>
        </button>
        <div className="ma-topbar-actions">
          {isHead && pendingUsers.length > 0 && (
            <button
              className="ma-badge-btn"
              onClick={() => setShowPendingUsers(true)}
              aria-label={`${pendingUsers.length} ta kutilayotgan foydalanuvchi`}
            >
              {pendingUsers.length}
            </button>
          )}
          <button
            className="ma-icon-btn"
            onClick={() => setShowQuickAdd(true)}
            aria-label="Vazifa qo‘shish"
          >
            +
          </button>
          {isHead && <button className="ma-icon-btn" onClick={() => setShowWorkflow(true)} aria-label="Ish jarayonini boshlash">⚡</button>}
        </div>
      </header>

      <main className="ma-main">
        {taskNotice && (
          <div className={`ma-notice ${taskNotice.kind}`} role="status">
            <span>{taskNotice.text}</span>
            <button onClick={() => setTaskNotice(null)} aria-label="Xabarni yopish">×</button>
          </div>
        )}

        {nav === "home" && (
          <HomeView
            isHead={isHead}
            currentUserId={currentUser!.id}
            planningRefreshKey={planningRefreshKey}
            displayName={currentUser?.displayName ?? ""}
            tasks={homeTasks}
            users={users}
            loading={homeLoading}
            error={homeError}
            onRetry={retryHome}
            onSelectTask={setSelectedTaskId}
            onGoToFilter={goToFilter}
            onSelectMember={selectMember}
          />
        )}

        {nav === "tasks" && (
          <TasksView
            isHead={isHead}
            filter={filter}
            onFilterChange={changeFilter}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            tasks={visibleTasks}
            users={users}
            loading={loadingTasks}
            error={tasksError}
            onRetry={() => loadTasks(filter)}
            onSelect={setSelectedTaskId}
            query={taskQuery}
            onQueryChange={(query) => setTaskQuery({ ...query, reportView: undefined })}
            hasMore={Boolean(tasksNextCursor)}
            loadingMore={loadingMoreTasks}
            onLoadMore={() => { if (tasksNextCursor) void loadTasks(filter, tasksNextCursor); }}
            memberFilterUser={memberFilterUser}
            onClearMember={() => setMemberFilter(null)}
          />
        )}

        {nav === "calendar" && (
          <CalendarView
            tasks={homeTasks}
            users={users}
            loading={homeLoading}
            error={homeError}
            onRetry={retryHome}
            onSelect={setSelectedTaskId}
          />
        )}

        {nav === "team" && isHead && (
          <TeamView
            tasks={homeTasks}
            users={users}
            inactiveMembers={inactiveMembers}
            loading={homeLoading}
            error={homeError}
            onRetry={retryHome}
            onSelectMember={selectMember}
            onEditRole={setRoleEditUser}
            onDeactivate={setDeactivateTarget}
            onReactivated={(updated) => {
              setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
              setTaskNotice({ kind: "success", text: `${updated.displayName} yana faol jamoa a’zosi.` });
            }}
          />
        )}

        {nav === "reports" && <ReportsView isHead={isHead} onOpenTasks={openReportTasks} />}
      </main>

      <BottomNav nav={nav} onChange={setNav} showTeam={isHead} />

      {selectedTaskId && (
        <TaskDetailPanel
          key={selectedTaskId}
          taskId={selectedTaskId}
          currentUser={currentUser!}
          users={users}
          onClose={() => setSelectedTaskId(null)}
          onRefresh={refreshAll}
          onPlanSaved={() => setPlanningRefreshKey((value) => value + 1)}
        />
      )}

      {showQuickAdd && (
        <QuickAddPanel
          currentUser={currentUser!}
          users={users}
          usersLoaded={usersLoaded}
          usersError={usersError}
          onRetryTeam={retryHome}
          onClose={() => setShowQuickAdd(false)}
          onCreated={({ notification }) => {
            setShowQuickAdd(false);
            haptic("success");
            setTaskNotice(notification.status === "FAILED"
              ? { kind: "warning", text: "Vazifa yaratildi, lekin xabar navbatga qo‘shilmadi. Administratorga xabar bering." }
              : notification.status === "SKIPPED"
                ? { kind: "success", text: "Vazifa yaratildi." }
                : { kind: "success", text: "Vazifa yaratildi. Mas’ulga xabar yuborilmoqda." });
            refreshAll();
          }}
        />
      )}

      {showWorkflow && currentUser && (
        <WorkflowStartPanel
          users={users}
          onClose={() => setShowWorkflow(false)}
          onStarted={(task) => {
            setShowWorkflow(false);
            setTaskNotice({ kind: "success", text: `Ish jarayoni boshlandi: ${task.title}` });
            refreshAll();
            setSelectedTaskId(task.id);
          }}
        />
      )}

      {showPendingUsers && (
        <PendingUsersPanel
          users={pendingUsers}
          onClose={() => setShowPendingUsers(false)}
          onActivated={loadUsers}
        />
      )}

      {showProfile && currentUser && (
        <ProfilePanel
          user={currentUser}
          themePreference={themePreference}
          onThemePreference={(choice) => {
            window.localStorage.setItem("marketing-theme", choice);
            setThemePreference(choice);
          }}
          onClose={() => setShowProfile(false)}
        />
      )}

      {roleEditUser && (
        <RoleEditSheet
          user={roleEditUser}
          onClose={() => setRoleEditUser(null)}
          onSaved={handleRoleSaved}
        />
      )}

      {deactivateTarget && (
        <DeactivateMemberSheet
          user={deactivateTarget}
          users={users}
          onClose={() => setDeactivateTarget(null)}
          onDeactivated={(updated) => {
            setDeactivateTarget(null);
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            setTaskNotice({ kind: "success", text: `${updated.displayName} faol jamoadan chiqarildi.` });
            refreshAll();
          }}
        />
      )}
    </div>
  );
}

// ─── Bottom navigation ────────────────────────────────────────────────────────

const NAV_ICONS: Record<Nav, string> = {
  home: "⌂",
  tasks: "≡",
  calendar: "▦",
  team: "◉",
  reports: "▥",
};

function BottomNav({
  nav,
  onChange,
  showTeam,
}: {
  nav: Nav;
  onChange: (n: Nav) => void;
  showTeam: boolean;
}) {
  const items: { key: Nav; label: string }[] = [
    { key: "home", label: t.navigation.home },
    { key: "tasks", label: t.navigation.tasks },
    { key: "calendar", label: t.navigation.calendar },
    ...(showTeam ? [{ key: "team" as Nav, label: t.navigation.team }] : []),
    { key: "reports", label: t.navigation.reports },
  ];
  return (
    <nav className="ma-bottom-nav" aria-label="Asosiy navigatsiya">
      {items.map((item) => (
        <button
          key={item.key}
          className={`ma-nav-btn${nav === item.key ? " active" : ""}`}
          onClick={() => onChange(item.key)}
          aria-current={nav === item.key ? "page" : undefined}
        >
          <span className="ma-nav-icon" aria-hidden="true">{NAV_ICONS[item.key]}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

const STAT_TILES: { key: Filter; label: string; tone: string }[] = [
  { key: "today", label: "Bugun", tone: "primary" },
  { key: "overdue", label: "Kechikkan", tone: "danger" },
  { key: "blocked", label: "Bloklangan", tone: "warning" },
  { key: "review", label: "Tekshiruvda", tone: "violet" },
];

// Head opens Home to triage the team, not to admire a personal to-do list:
// Overdue/Blocked need to register first, Today/Review are secondary.
const HEAD_CRITICAL_TILES = new Set<Filter>(["overdue", "blocked"]);

function HomeView({
  isHead,
  currentUserId,
  planningRefreshKey,
  displayName,
  tasks,
  users,
  loading,
  error,
  onRetry,
  onSelectTask,
  onGoToFilter,
  onSelectMember,
}: {
  isHead: boolean;
  currentUserId: string;
  planningRefreshKey: number;
  displayName: string;
  tasks: Task[];
  users: User[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectTask: (id: string) => void;
  onGoToFilter: (f: Filter) => void;
  onSelectMember: (userId: string) => void;
}) {
  const [planningView, setPlanningView] = useState<DayPlanGroup | null>(null);
  if (planningView) {
    return <MyDayPanel tasks={tasks} userId={currentUserId} refreshKey={planningRefreshKey}
      view={planningView} onOpen={setPlanningView} onBack={() => setPlanningView(null)} onSelectTask={onSelectTask} />;
  }
  if (loading && tasks.length === 0) {
    return <div className="ma-center-inline"><div className="ma-spinner" aria-label="Yuklanmoqda" /></div>;
  }
  if (error) {
    return <div className="ma-error" role="alert">{error} <button onClick={onRetry}>Qayta urinish</button></div>;
  }

  const counts = countsFor(tasks);
  const firstName = displayName.split(" ")[0] || displayName;
  const todayTasks = tasks.filter((t) => !isTerminal(t.status) && isToday(t.deadline));
  // "Upcoming" excludes what Today already showed, so the two sections stay
  // complementary instead of repeating the same one or two tasks.
  const upcoming = priorityTasks(tasks.filter((t) => !isToday(t.deadline)));

  return (
    <div className="ma-home">
      <div className="ma-greeting">
        <h1>{tashkentGreeting()}, {firstName}</h1>
        <p className="ma-muted">{isHead ? "Jamoaning bugungi holati." : "Sizning bugungi vazifalaringiz."}</p>
      </div>

      <div className="ma-stat-grid">
        {STAT_TILES.map((tile) => {
          const value = counts[tile.key as keyof typeof counts];
          const critical = isHead && HEAD_CRITICAL_TILES.has(tile.key);
          return (
            <button
              key={tile.key}
              className={`ma-stat-tile${value > 0 ? ` tone-${tile.tone}` : ""}${critical ? " critical" : ""}`}
              onClick={() => onGoToFilter(tile.key)}
            >
              <span className="ma-stat-value">{value}</span>
              <span className="ma-stat-label">{tile.label}</span>
            </button>
          );
        })}
      </div>

      <MyDayPanel tasks={tasks} userId={currentUserId} refreshKey={planningRefreshKey}
        view={null} onOpen={setPlanningView} onBack={() => setPlanningView(null)} onSelectTask={onSelectTask} />

      {isHead && (
        <section className="ma-section">
          <div className="ma-section-head">
            <h3>Jamoa bandligi</h3>
            <button className="ma-link-btn" onClick={() => onGoToFilter("team")}>Barchasini ko‘rish</button>
          </div>
          <WorkloadList tasks={tasks} users={users} onSelectMember={onSelectMember} limit={4} />
        </section>
      )}

      <section className="ma-section">
        <h3>Bugun</h3>
        {todayTasks.length === 0 ? (
          <div className="ma-empty">Bugun vazifa yo‘q.</div>
        ) : (
          <TaskList tasks={todayTasks} users={users} onSelect={onSelectTask} />
        )}
      </section>

      <section className="ma-section">
        <h3>Yaqin vazifalar</h3>
        {upcoming.length === 0 ? (
          <div className="ma-empty">{isHead ? "Hozir shoshilinch vazifa yo‘q." : "Hozircha barcha ishlar nazoratda."}</div>
        ) : (
          <TaskList tasks={upcoming} users={users} onSelect={onSelectTask} />
        )}
      </section>
    </div>
  );
}

function WorkloadList({
  tasks,
  users,
  onSelectMember,
  onEditRole,
  onDeactivate,
  limit,
}: {
  tasks: Task[];
  users: User[];
  onSelectMember: (userId: string) => void;
  onEditRole?: (user: User) => void;
  onDeactivate?: (user: User) => void;
  limit?: number;
}) {
  const [menuUser, setMenuUser] = useState<User | null>(null);
  const rows = workloadFor(tasks, users).slice(0, limit ?? undefined);
  if (rows.length === 0) {
    return <div className="ma-empty">Hali faol jamoa a’zolari yo‘q.</div>;
  }
  return (
    <>
    <ul className="ma-workload-list">
      {rows.map((row) => (
        <li key={row.user.id} className="ma-workload-item">
          <button className="ma-workload-row" onClick={() => onSelectMember(row.user.id)}>
            <span className="ma-workload-name">
              {row.user.displayName}
              <span className="ma-muted"> · {ROLE_LABELS[row.user.role]}</span>
            </span>
            <span className="ma-workload-counts">
              <span className="ma-workload-count">{row.open} ochiq</span>
              <span className="ma-workload-count">{row.today} bugun</span>
              <span className={`ma-workload-count${row.overdue > 0 ? " danger" : ""}`}>{row.overdue} kechikkan</span>
            </span>
          </button>
          {/* One overflow button instead of two always-visible icons — admin
              actions shouldn't visually compete with the workload numbers
              that matter on every glance at this list. */}
          {row.user.role !== "HEAD_OF_MARKETING" && (onEditRole || onDeactivate) && (
            <button
              className="ma-workload-edit"
              onClick={() => setMenuUser(row.user)}
              aria-label={`${row.user.displayName} uchun amallar`}
              title="Boshqa amallar"
            >
              ⋯
            </button>
          )}
        </li>
      ))}
    </ul>
      {menuUser && (
        <div
          className="ma-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${menuUser.displayName} uchun amallar`}
          onClick={(e) => { if (e.target === e.currentTarget) setMenuUser(null); }}
        >
          <div className="ma-panel">
            <div className="ma-panel-header">
              <button className="ma-back-btn" onClick={() => setMenuUser(null)} aria-label="Yopish">←</button>
              <span className="ma-panel-title">{menuUser.displayName}</span>
            </div>
            <div className="ma-panel-body ma-picker-body">
              <ul className="ma-picker-list">
                {onEditRole && (
                  <li>
                    <button className="ma-picker-row" onClick={() => { const u = menuUser; setMenuUser(null); onEditRole(u); }}>
                      <span className="ma-picker-info"><span className="ma-picker-name">Rolni o‘zgartirish</span></span>
                    </button>
                  </li>
                )}
                {onDeactivate && (
                  <li>
                    <button className="ma-picker-row" onClick={() => { const u = menuUser; setMenuUser(null); onDeactivate(u); }}>
                      <span className="ma-picker-info"><span className="ma-picker-name" style={{ color: "var(--danger)" }}>Jamoadan chiqarish</span></span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Team ─────────────────────────────────────────────────────────────────────

function TeamView({
  tasks,
  users,
  inactiveMembers,
  loading,
  error,
  onRetry,
  onSelectMember,
  onEditRole,
  onDeactivate,
  onReactivated,
}: {
  tasks: Task[];
  users: User[];
  inactiveMembers: User[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectMember: (userId: string) => void;
  onEditRole: (user: User) => void;
  onDeactivate: (user: User) => void;
  onReactivated: (user: User) => void;
}) {
  const [showInactive, setShowInactive] = useState(false);
  const [reactivating, setReactivating] = useState<string | null>(null);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  if (loading && tasks.length === 0) {
    return <div className="ma-center-inline"><div className="ma-spinner" aria-label="Yuklanmoqda" /></div>;
  }
  if (error) {
    return <div className="ma-error" role="alert">{error} <button onClick={onRetry}>Qayta urinish</button></div>;
  }

  const reactivate = async (user: User) => {
    setReactivating(user.id);
    setReactivateError(null);
    const { data, error: e } = await apiFetch<{ user: User }>(`/api/users/${user.id}/reactivate`, { method: "POST" });
    setReactivating(null);
    if (e) { setReactivateError(friendlyError(e)); return; }
    if (data?.user) onReactivated(data.user);
  };

  return (
    <div className="ma-home">
      <div className="ma-greeting">
        <h1>Jamoa bandligi</h1>
        <p className="ma-muted">Vazifalarni ko‘rish uchun xodimni, rol va a’zolik amallari uchun ⋯ tugmasini bosing.</p>
      </div>
      <WorkloadList tasks={tasks} users={users} onSelectMember={onSelectMember} onEditRole={onEditRole} onDeactivate={onDeactivate} />

      {inactiveMembers.length > 0 && (
        <section className="ma-section">
          <button className="ma-section-head ma-collapse-toggle" onClick={() => setShowInactive((value) => !value)} aria-expanded={showInactive}>
            <h3>Faol bo‘lmagan a’zolar ({inactiveMembers.length})</h3>
            <span aria-hidden="true">{showInactive ? "▾" : "▸"}</span>
          </button>
          {showInactive && (
            <ul className="ma-workload-list">
              {inactiveMembers.map((member) => (
                <li key={member.id} className="ma-workload-item">
                  <div className="ma-workload-row inactive">
                    <span className="ma-workload-name">
                      {member.displayName}
                      <span className="ma-muted"> · {ROLE_LABELS[member.role]}</span>
                    </span>
                  </div>
                  <button
                    className="ma-btn secondary"
                    disabled={reactivating === member.id}
                    onClick={() => reactivate(member)}
                  >
                    {reactivating === member.id ? "…" : "Qayta faollashtirish"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {reactivateError && <div className="ma-error-inline" role="alert">{reactivateError}</div>}
        </section>
      )}
    </div>
  );
}

// ─── Tasks tab ────────────────────────────────────────────────────────────────

function TasksView({
  isHead,
  filter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  tasks,
  users,
  loading,
  error,
  onRetry,
  onSelect,
  query,
  onQueryChange,
  hasMore,
  loadingMore,
  onLoadMore,
  memberFilterUser,
  onClearMember,
}: {
  isHead: boolean;
  filter: Filter;
  onFilterChange: (f: Filter) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  tasks: Task[];
  users: User[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (id: string) => void;
  query: TaskQueryOptions;
  onQueryChange: (query: TaskQueryOptions) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  memberFilterUser: User | null;
  onClearMember: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query.search);
  const primaryFilters: Filter[] = isHead ? ["my", "created", "today", "overdue", "team"] : ["my", "created", "today", "overdue"];
  const extraActive = filter === "review" || filter === "blocked" ? filter : null;

  return (
    <div className="ma-tasks-view">
      {query.reportView && <div className="ma-report-filter-note">
        Hisobotdan: {({ open: "Ochiq vazifalar", completed: "So‘nggi 30 kunda bajarilgan", carry_over: "Oldingi davrdan qolgan ochiq", overdue: "Kechikkan ochiq vazifalar" } as const)[query.reportView]}
        <button onClick={() => onQueryChange({ ...query, reportView: undefined })}>Filtrni tozalash</button>
      </div>}
      <nav className="ma-filters" aria-label="Vazifa filtrlari">
        {primaryFilters.map((f) => (
          <button
            key={f}
            className={`ma-filter-btn${filter === f ? " active" : ""}`}
            onClick={() => onFilterChange(f)}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
        {extraActive && (
          <button className="ma-filter-btn active" onClick={() => onFilterChange("my")}>
            {FILTER_LABELS[extraActive]} ×
          </button>
        )}
        <div className="ma-more-wrap">
          <button className="ma-filter-btn ghost" onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
            Filtrlar ▾
          </button>
          {moreOpen && (
            <div className="ma-filter-sheet" role="menu">
              <button role="menuitem" onClick={() => { onFilterChange("review"); setMoreOpen(false); }}>Tekshiruvda</button>
              <button role="menuitem" onClick={() => { onFilterChange("blocked"); setMoreOpen(false); }}>Bloklangan</button>
            </div>
          )}
        </div>
        <div className="ma-view-toggle" role="group" aria-label="Ko‘rinish turi">
          <button
            className={`ma-view-btn${viewMode === "list" ? " active" : ""}`}
            onClick={() => onViewModeChange("list")}
            aria-pressed={viewMode === "list"}
            title="Ro‘yxat ko‘rinishi"
          >
            ☰
          </button>
          <button
            className={`ma-view-btn${viewMode === "kanban" ? " active" : ""}`}
            onClick={() => onViewModeChange("kanban")}
            aria-pressed={viewMode === "kanban"}
            title="Kanban ko‘rinishi"
          >
            ⊞
          </button>
        </div>
      </nav>

      <form
        className="ma-task-search"
        onSubmit={(event) => {
          event.preventDefault();
          onQueryChange({ ...query, search: searchDraft.trim() });
        }}
      >
        <input
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Vazifa qidirish"
          aria-label="Vazifa qidirish"
        />
        <button className="ma-btn secondary" type="submit">Qidirish</button>
      </form>

      <div className="ma-task-query-controls">
        <select
          aria-label="Holat bo‘yicha filter"
          value={query.status}
          disabled={filter === "review" || filter === "blocked"}
          onChange={(event) => onQueryChange({ ...query, status: event.target.value as TaskQueryOptions["status"] })}
        >
          <option value="">Barcha holatlar</option>
          {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </select>
        <select
          aria-label="Ustuvorlik bo‘yicha filter"
          value={query.priority}
          onChange={(event) => onQueryChange({ ...query, priority: event.target.value as TaskQueryOptions["priority"] })}
        >
          <option value="">Barcha ustuvorliklar</option>
          <option value="high">Yuqori</option>
          <option value="normal">Oddiy</option>
          <option value="low">Past</option>
        </select>
        {isHead && (
          <select
            aria-label="Mas’ul bo‘yicha filter"
            value={query.assigneeId}
            onChange={(event) => onQueryChange({ ...query, assigneeId: event.target.value })}
          >
            <option value="">Barcha mas’ullar</option>
            {users.filter((user) => user.isActive).map((user) => (
              <option key={user.id} value={user.id}>{user.displayName}</option>
            ))}
          </select>
        )}
        <select
          aria-label="Vazifalarni saralash"
          value={query.sort}
          onChange={(event) => onQueryChange({ ...query, sort: event.target.value as TaskQueryOptions["sort"] })}
        >
          <option value="deadline_asc">Muddat: yaqinlari avval</option>
          <option value="deadline_desc">Muddat: uzoqlari avval</option>
          <option value="created_desc">Yangi vazifalar avval</option>
        </select>
        <select
          aria-label="Muddat bo‘yicha filter"
          value={query.deadlineRange}
          disabled={filter === "today" || filter === "overdue"}
          onChange={(event) => onQueryChange({ ...query, deadlineRange: event.target.value as TaskQueryOptions["deadlineRange"] })}
        >
          <option value="">Barcha muddatlar</option>
          <option value="today">Bugun</option>
          <option value="next_7_days">Keyingi 7 kun</option>
          <option value="overdue">Kechikkan</option>
        </select>
      </div>

      {memberFilterUser && (
        <div className="ma-member-chip">
          <strong>{memberFilterUser.displayName}</strong> vazifalari
          <button onClick={onClearMember} aria-label="Xodim filtrini tozalash">×</button>
        </div>
      )}

      {loading && (
        <div className="ma-center-inline">
          <div className="ma-spinner" aria-label="Vazifalar yuklanmoqda" />
        </div>
      )}
      {!loading && error && (
        <div className="ma-error" role="alert">
          {error}
          <button onClick={onRetry}>Qayta urinish</button>
        </div>
      )}
      {!loading && !error && tasks.length === 0 && (
        <div className="ma-empty">{EMPTY_COPY[filter]}</div>
      )}
      {!loading && !error && tasks.length > 0 && (
        <>
          {viewMode === "list"
            ? <TaskList tasks={tasks} users={users} onSelect={onSelect} />
            : <KanbanBoard tasks={tasks} users={users} onSelect={onSelect} />}
          {hasMore && (
            <button className="ma-btn secondary full ma-load-more" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Yuklanmoqda…" : "Yana ko‘rsatish"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Task List ────────────────────────────────────────────────────────────────

function TaskList({
  tasks,
  users,
  onSelect,
}: {
  tasks: Task[];
  users: User[];
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="ma-task-list" aria-label="Vazifalar">
      {tasks.map((t) => (
        <li key={t.id}>
          <TaskCard task={t} users={users} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

// ─── Kanban Board ─────────────────────────────────────────────────────────────

function KanbanBoard({
  tasks,
  users,
  onSelect,
}: {
  tasks: Task[];
  users: User[];
  onSelect: (id: string) => void;
}) {
  const activeStatuses = STATUS_ORDER.filter((s) =>
    tasks.some((t) => t.status === s)
  );

  return (
    <div className="ma-kanban">
      {activeStatuses.map((status) => {
        const col = tasks.filter((t) => t.status === status);
        return (
          <div key={status} className="ma-kanban-col">
            <div className="ma-kanban-header">
              <span className={`ma-status-dot s-${status.toLowerCase()}`} />
              {STATUS_LABELS[status]}
              <span className="ma-kanban-count">{col.length}</span>
            </div>
            <ul className="ma-kanban-cards" aria-label={STATUS_LABELS[status]}>
              {col.map((t) => (
                <li key={t.id}>
                  <TaskCard task={t} users={users} onSelect={onSelect} compact />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  users,
  onSelect,
  compact,
}: {
  task: Task;
  users: User[];
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const assignee = users.find((u) => u.id === task.assigneeId);
  const overdue = isOverdue(task.deadline) && !isTerminal(task.status);
  const today = isToday(task.deadline);

  return (
    <button
      className={`ma-task-card${compact ? " compact" : ""}${overdue ? " overdue" : ""}`}
      onClick={() => onSelect(task.id)}
      aria-label={`Vazifa: ${task.title}`}
    >
      <div className="ma-task-card-top">
        <span className={`ma-priority p-${task.priority}`}>
          {PRIORITY_LABELS[task.priority]}
        </span>
        <span className={`ma-status-pill s-${task.status.toLowerCase()}`}>
          {STATUS_LABELS[task.status]}
        </span>
      </div>
      <div className="ma-task-title">{task.title}</div>
      {!compact && task.description && (
        <div className="ma-task-desc">{task.description}</div>
      )}
      <div className="ma-task-meta">
        {assignee && <span>{assignee.displayName}</span>}
        <span className={overdue ? "ma-overdue-text" : today ? "ma-today-text" : ""}>
          {overdue ? "Kechikkan · " : today ? "Bugun · " : ""}
          {fmtDate(task.deadline)}
        </span>
      </div>
    </button>
  );
}

// ─── Reports / analytics ─────────────────────────────────────────────────────

function metricDuration(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 24) return `${hours.toFixed(1)} soat`;
  return `${(hours / 24).toFixed(1)} kun`;
}

function metricPercent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function ReportsView({ isHead, onOpenTasks }: {
  isHead: boolean;
  onOpenTasks: (view: NonNullable<TaskQueryOptions["reportView"]>) => void;
}) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiFetch<AnalyticsResponse>("/api/reports?days=30");
    setLoading(false);
    if (result.data) setData(result.data);
    else setError(friendlyError(result.error) ?? "Hisobotlarni yuklab bo‘lmadi");
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="ma-center-inline"><div className="ma-spinner" /></div>;
  if (error) return <div className="ma-error" role="alert">{error}<button onClick={load}>Qayta urinish</button></div>;
  if (!data) return null;
  const metric = data.metrics;
  const maxThroughput = Math.max(metric.workload.open, metric.completed, 1);

  return (
    <div className="ma-reports">
      <div className="ma-section-head">
        <div>
          <span className="ma-eyebrow">Ish jarayoni tahlili</span>
          <h1>{isHead ? "Jamoa hisoboti" : "Mening hisobotim"}</h1>
        </div>
        <span className="ma-window-chip">So‘nggi 30 kun</span>
      </div>

      <section className="ma-report-card">
        <div className="ma-section-head"><h3>Reja va natija</h3><button className="ma-link-btn" onClick={() => onOpenTasks("open")}>Vazifalarni ko‘rish →</button></div>
        <button className="ma-comparison-row ma-metric-link" onClick={() => onOpenTasks("open")}><span>Hozir ochiq</span><strong>{metric.workload.open}</strong></button>
        <div className="ma-bar"><span style={{ width: `${metric.workload.open / maxThroughput * 100}%` }} /></div>
        <button className="ma-comparison-row ma-metric-link" onClick={() => onOpenTasks("completed")}><span>30 kunda bajarilgan</span><strong>{metric.completed}</strong></button>
        <div className="ma-bar success"><span style={{ width: `${metric.completed / maxThroughput * 100}%` }} /></div>
      </section>

      <div className="ma-report-grid">
        <button className="ma-report-stat ma-report-stat-link" onClick={() => onOpenTasks("carry_over")}><span>Oldingi davrdan qolgan ochiq</span><strong>{metric.carryOver}</strong></button>
        <button className="ma-report-stat ma-report-stat-link danger" onClick={() => onOpenTasks("overdue")}><span>Hozir kechikkan</span><strong>{metric.currentOverdue}</strong></button>
        <div className="ma-report-stat"><span>Vaqtida</span><strong>{metricPercent(metric.onTimeCompletionRate)}</strong></div>
        <div className="ma-report-stat"><span>Tuzatish ulushi</span><strong>{metricPercent(metric.revisionRate)}</strong></div>
        <div className="ma-report-stat"><span>Muddat so‘rovlari</span><strong>{metric.deadlineChangeRequests}</strong></div>
        <div className="ma-report-stat"><span>O‘rtacha davomiylik</span><strong>{metricDuration(metric.averageCycleHours)}</strong></div>
      </div>

      <section className="ma-report-card">
        <h3>Joriy bandlik</h3>
        <div className="ma-workload-metrics">
          <span>Ochiq <strong>{metric.workload.open}</strong></span>
          <span>Jarayonda <strong>{metric.workload.inProgress}</strong></span>
          <span>Bugun <strong>{metric.workload.dueToday}</strong></span>
          <span>Keyingi 48 soat <strong>{metric.workload.dueNext48h}</strong></span>
          <span>Yuqori <strong>{metric.workload.highPriority}</strong></span>
          <span className="danger">Kechikkan <strong>{metric.workload.overdue}</strong></span>
          <span>Bloklangan <strong>{metric.workload.blocked}</strong></span>
          <span>Tekshiruvda <strong>{metric.workload.review}</strong></span>
        </div>
      </section>

      {(metric.posting.created > 0 || metric.posting.currentOpen > 0) && (
        <section className="ma-report-card">
          <h3>#posting jarayoni</h3>
          <div className="ma-workload-metrics">
            <span>Yaratilgan <strong>{metric.posting.created}</strong></span>
            <span>Bajarilgan <strong>{metric.posting.completed}</strong></span>
            <span>Hozir ochiq <strong>{metric.posting.currentOpen}</strong></span>
          </div>
        </section>
      )}

      <section className="ma-report-card">
        <h3>Har bir holatdagi o‘rtacha vaqt</h3>
        <div className="ma-status-times">
          {(["ASSIGNED", "IN_PROGRESS", "BLOCKED", "REVIEW", "REVISION"] as TaskStatus[]).map((status) => (
            <div key={status}>
              <span><i className={`ma-status-dot s-${status.toLowerCase()}`} />{STATUS_LABELS[status]}</span>
              <strong>{metricDuration(metric.averageStatusHours[status] ?? null)}</strong>
            </div>
          ))}
        </div>
      </section>

      {isHead && data.team.length > 0 && (
        <section className="ma-section">
          <h3>Xodimlar kesimida</h3>
          <div className="ma-analytics-team">
            {data.team.map((row) => (
              <article className="ma-employee-analytics" key={row.user.id}>
                <div className="ma-section-head"><strong>{row.user.displayName}</strong><span className="ma-muted">{ROLE_LABELS[row.user.role]}</span></div>
                <div className="ma-employee-numbers">
                  <span>Bajarilgan <b>{row.metrics.completed}</b></span>
                  <span>Vaqtida <b>{row.metrics.onTimeCompleted}</b></span>
                  <span>Ochiq <b>{row.workload.open}</b></span>
                  <span className={row.workload.overdue ? "danger" : ""}>Kechikkan <b>{row.workload.overdue}</b></span>
                  <span>Tuzatishlar <b>{row.metrics.revisionCount}</b></span>
                  <span>Muddat o‘zgarishi <b>{row.metrics.deadlineChangeRequests}</b></span>
                  <span>O‘rtacha vaqt <b>{metricDuration(row.metrics.averageCycleHours)}</b></span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Task Detail Panel ────────────────────────────────────────────────────────

function TaskDetailPanel({
  taskId,
  currentUser,
  users,
  onClose,
  onRefresh,
  onPlanSaved,
}: {
  taskId: string;
  currentUser: User;
  users: User[];
  onClose: () => void;
  onRefresh: () => void;
  onPlanSaved: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [showBlockInput, setShowBlockInput] = useState(false);
  const [showRevisionInput, setShowRevisionInput] = useState(false);
  const [confirmReview, setConfirmReview] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [showDLRequest, setShowDLRequest] = useState(false);
  const [dlDate, setDlDate] = useState("");
  const [dlReason, setDlReason] = useState("");
  const [checklistPendingId, setChecklistPendingId] = useState<string | null>(null);
  const [showRecurrenceForm, setShowRecurrenceForm] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurringDefinition["frequency"]>("WEEKDAYS");
  const [recurrenceWeekday, setRecurrenceWeekday] = useState(1);
  const [recurrenceDay, setRecurrenceDay] = useState(1);
  const [recurrenceTime, setRecurrenceTime] = useState("09:00");
  const [recurrenceEnd, setRecurrenceEnd] = useState("");
  const [recurrenceAssigneeId, setRecurrenceAssigneeId] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("normal");
  const [editAssigneeId, setEditAssigneeId] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editPublication, setEditPublication] = useState("");
  const [commentKind, setCommentKind] = useState<TaskComment["kind"]>("COMMENT");
  const [commentBody, setCommentBody] = useState("");
  const [commentUrl, setCommentUrl] = useState("");
  const [commentPending, setCommentPending] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const { data, error: e } = await apiFetch<TaskDetail>(`/api/tasks/${taskId}`);
    setLoading(false);
    if (data) setDetail(data);
    else setError(friendlyError(e) ?? "Vazifani yuklab bo‘lmadi");
  }, [taskId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const el = panelRef.current;
    if (el) el.focus();
  }, []);

  const postAction = async (action: string, extra?: Record<string, unknown>): Promise<boolean> => {
    setActionPending(true);
    setActionError(null);
    const { data, error: e } = await apiFetch<{ task: Task }>(
      `/api/tasks/${taskId}/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      }
    );
    setActionPending(false);
    if (e) { setActionError(friendlyError(e)); return false; }
    haptic("impact");
    if (data?.task) setDetail((previous) => previous ? { ...previous, task: data.task } : previous);
    void load(true);
    onRefresh();
    return true;
  };

  const requestDeadline = async () => {
    if (!dlDate || !dlReason) return;
    setActionPending(true);
    setActionError(null);
    const { error: e } = await apiFetch<unknown>(
      `/api/tasks/${taskId}/deadline-requests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedDeadline: localDatetimeToISO(dlDate),
          reason: dlReason,
        }),
      }
    );
    setActionPending(false);
    if (e) { setActionError(friendlyError(e)); return; }
    setShowDLRequest(false);
    setDlDate("");
    setDlReason("");
    await load();
  };

  const resolveDeadline = async (reqId: string, approve: boolean) => {
    setActionPending(true);
    setActionError(null);
    const { error: e } = await apiFetch<unknown>(
      `/api/deadline-requests/${reqId}/resolve`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      }
    );
    setActionPending(false);
    if (e) { setActionError(friendlyError(e)); return; }
    void load(true);
    onRefresh();
  };

  const toggleChecklist = async (itemId: string) => {
    setChecklistPendingId(itemId);
    setActionError(null);
    const before = detail?.postingChecklist;
    setDetail((previous) => previous?.postingChecklist ? {
      ...previous,
      postingChecklist: {
        ...previous.postingChecklist,
        items: previous.postingChecklist.items.map((item) => item.id === itemId
          ? { ...item, isCompleted: !item.isCompleted } : item),
      },
    } : previous);
    const { data, error: e } = await apiFetch<{ item: PostingChecklistItem }>(
      `/api/checklist-items/${itemId}/toggle`, { method: "POST" }
    );
    setChecklistPendingId(null);
    if (e || !data?.item) {
      setDetail((previous) => previous ? { ...previous, postingChecklist: before ?? previous.postingChecklist } : previous);
      setActionError(friendlyError(e) ?? "Ro‘yxat yangilanmadi.");
      return;
    }
    haptic("selection");
    setDetail((previous) => previous?.postingChecklist ? {
      ...previous,
      postingChecklist: {
        ...previous.postingChecklist,
        items: previous.postingChecklist.items.map((item) => item.id === itemId ? data.item : item),
      },
    } : previous);
  };

  const openEditForm = () => {
    const current = detail?.task;
    if (!current) return;
    setEditTitle(current.title);
    setEditDescription(current.description ?? "");
    setEditPriority(current.priority);
    setEditAssigneeId(current.assigneeId);
    setEditDeadline(isoToTashkentLocalInput(current.deadline));
    setEditPublication(isoToTashkentLocalInput(current.publicationAt));
    setActionError(null);
    setShowEdit(true);
  };

  const saveTaskEdit = async () => {
    const current = detail?.task;
    if (!current || !editTitle.trim()) return;
    const canManage = currentUser.role === "HEAD_OF_MARKETING" || current.creatorId === currentUser.id;
    const payload = {
      title: editTitle.trim(),
      description: editDescription.trim() || null,
      priority: editPriority,
      ...(canManage ? {
        assigneeId: editAssigneeId,
        deadline: localDatetimeToISO(editDeadline),
        publicationAt: editPublication ? localDatetimeToISO(editPublication) : null,
      } : {}),
    };
    setActionPending(true);
    setActionError(null);
    const { data, error: editError } = await apiFetch<Task>(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setActionPending(false);
    if (!data) { setActionError(friendlyError(editError)); return; }
    setDetail((previous) => previous ? { ...previous, task: data } : previous);
    setShowEdit(false);
    haptic("success");
    onRefresh();
  };

  const submitComment = async () => {
    if (!commentBody.trim() && !commentUrl.trim()) return;
    setCommentPending(true);
    setActionError(null);
    const { data, error: commentError } = await apiFetch<TaskComment>(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: commentKind,
        ...(commentBody.trim() ? { body: commentBody.trim() } : {}),
        ...(commentUrl.trim() ? { attachmentUrl: commentUrl.trim() } : {}),
      }),
    });
    setCommentPending(false);
    if (!data) { setActionError(friendlyError(commentError)); return; }
    setDetail((previous) => previous ? { ...previous, comments: [...(previous.comments ?? []), data] } : previous);
    setCommentBody("");
    setCommentUrl("");
    haptic("success");
  };

  const openRecurrenceForm = () => {
    const recurrence = detail?.recurringDefinition;
    if (recurrence) {
      setRecurrenceFrequency(recurrence.frequency);
      setRecurrenceWeekday(recurrence.weekday ?? 1);
      setRecurrenceDay(recurrence.dayOfMonth ?? 1);
      setRecurrenceTime(recurrence.localTime);
      setRecurrenceEnd(recurrence.endsOn ?? "");
      setRecurrenceAssigneeId(recurrence.assigneeId ?? detail?.task.assigneeId ?? "");
    } else {
      setRecurrenceAssigneeId(detail?.task.assigneeId ?? "");
    }
    setShowRecurrenceForm(true);
  };

  const saveRecurrence = async () => {
    if (!task || !recurrenceTime) return;
    setActionPending(true);
    setActionError(null);
    const existing = detail?.recurringDefinition;
    const payload = {
      frequency: recurrenceFrequency,
      weekday: recurrenceFrequency === "WEEKLY" ? recurrenceWeekday : null,
      dayOfMonth: recurrenceFrequency === "MONTHLY" ? recurrenceDay : null,
      localTime: recurrenceTime,
      endsOn: recurrenceEnd || null,
      ...(existing && recurrenceAssigneeId && recurrenceAssigneeId !== existing.assigneeId
        ? { assigneeId: recurrenceAssigneeId }
        : {}),
    };
    const { data, error: e } = await apiFetch<{ recurringDefinition: RecurringDefinition }>(
      `/api/tasks/${existing?.id ?? task.id}/recurrence`, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setActionPending(false);
    if (e) { setActionError(friendlyError(e)); return; }
    if (data?.recurringDefinition) {
      setDetail((previous) => previous ? { ...previous, recurringDefinition: data.recurringDefinition } : previous);
      setShowRecurrenceForm(false);
    }
  };

  const recurrenceAction = async (action: "PAUSE" | "RESUME" | "STOP") => {
    const recurrence = detail?.recurringDefinition;
    if (!recurrence) return;
    setActionPending(true);
    setActionError(null);
    const { data, error: e } = await apiFetch<{ recurringDefinition: RecurringDefinition }>(
      `/api/tasks/${recurrence.id}/recurrence`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      }
    );
    setActionPending(false);
    if (e) { setActionError(friendlyError(e)); return; }
    if (data?.recurringDefinition) {
      setDetail((previous) => previous ? { ...previous, recurringDefinition: data.recurringDefinition } : previous);
    }
  };

  const task = detail?.task;
  const events = detail?.events ?? [];
  const comments = detail?.comments ?? [];
  const dlRequests = detail?.deadlineRequests ?? [];
  const assignee = task ? users.find((u) => u.id === task.assigneeId) : null;
  const creator = task ? users.find((u) => u.id === task.creatorId) : null;
  const isAssignee = task?.assigneeId === currentUser.id;
  const isCreator = task?.creatorId === currentUser.id;
  const isHead = currentUser.role === "HEAD_OF_MARKETING";
  const canEditContent = Boolean(task && (isHead || isCreator || isAssignee));
  const canManageTask = Boolean(task && (isHead || isCreator));
  const pendingDL = dlRequests.filter((r) => r.status === "PENDING");
  const postingChecklist = detail?.postingChecklist;
  const postingComplete = !postingChecklist || postingChecklist.items.every((item) => item.isCompleted);
  const recurringDefinition = detail?.recurringDefinition;
  const canManageRecurrence = Boolean(task && (isHead || task.creatorId === currentUser.id || recurringDefinition?.createdBy === currentUser.id));

  const actions: { label: string; action: string; variant?: string }[] = [];
  if (task) {
    if (task.status === "ASSIGNED" && isAssignee) actions.push({ label: "Qabul qilish", action: "ACCEPT" });
    if (task.status === "IN_PROGRESS" && isAssignee && postingComplete) actions.push({ label: "Tekshiruvga yuborish", action: "SUBMIT_REVIEW", variant: "secondary" });
    if (task.status === "IN_PROGRESS" && isAssignee) actions.push({ label: "Bloklash", action: "_block", variant: "warn" });
    if (task.status === "BLOCKED" && isAssignee) actions.push({ label: "Davom ettirish", action: "RESUME" });
    if (task.status === "REVIEW" && (isCreator || isHead)) actions.push({ label: "Tasdiqlash", action: "APPROVE" });
    if (task.status === "REVIEW" && (isCreator || isHead)) actions.push({ label: "Tuzatishga qaytarish", action: "_revision", variant: "warn" });
    if (task.status === "REVISION" && isAssignee && postingComplete) actions.push({ label: "Tekshiruvga yuborish", action: "SUBMIT_REVIEW", variant: "secondary" });
    if (!isTerminal(task.status) && (isCreator || isHead)) actions.push({ label: "Bekor qilish", action: "CANCEL", variant: "danger" });
    if (isTerminal(task.status) && isHead) actions.push({ label: "Qayta ochish", action: "REOPEN" });
  }

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Vazifa tafsilotlari"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel" ref={panelRef} tabIndex={-1}>
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button>
          <span className="ma-panel-title">Vazifa tafsilotlari</span>
        </div>

        {loading && <div className="ma-center-inline"><div className="ma-spinner" /></div>}
        {error && <div className="ma-error" role="alert">{error} <button onClick={() => { void load(); }}>Qayta urinish</button></div>}

        {task && (
          <div className="ma-panel-body">
            <div className="ma-detail-top">
              <div className="ma-detail-badges">
                <span className={`ma-priority p-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
                <span className={`ma-status-pill s-${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span>
              </div>
              {canEditContent && <button className="ma-btn secondary compact" onClick={openEditForm}>Tahrirlash</button>}
            </div>

            <h2 className="ma-detail-title">{task.title}</h2>
            {task.description && <p className="ma-detail-desc">{task.description}</p>}

            <dl className="ma-detail-meta">
              <dt>Mas’ul</dt><dd>{assignee?.displayName ?? "—"}</dd>
              <dt>Yaratuvchi</dt><dd>{creator?.displayName ?? "—"}</dd>
              <dt>Muddat</dt><dd>{fmtDateTime(task.deadline)}</dd>
              <dt>Publikatsiya</dt><dd>{fmtDateTime(task.publicationAt)}</dd>
              {task.blockedReason && <><dt>Blok sababi</dt><dd className="ma-overdue-text">{task.blockedReason}</dd></>}
            </dl>

            {showEdit && (
              <section className="ma-section ma-edit-card" aria-labelledby="edit-task-title">
                <div className="ma-section-head"><h3 id="edit-task-title">Vazifani tahrirlash</h3><button className="ma-back-btn" onClick={() => setShowEdit(false)} aria-label="Tahrirlashni yopish">×</button></div>
                <div className="ma-block-form">
                  <label htmlFor="edit-title">Vazifa nomi</label>
                  <input id="edit-title" value={editTitle} maxLength={200} onChange={(event) => setEditTitle(event.target.value)} />
                  <label htmlFor="edit-description">Tavsif</label>
                  <textarea id="edit-description" value={editDescription} maxLength={5000} rows={4} onChange={(event) => setEditDescription(event.target.value)} />
                  <label htmlFor="edit-priority">Ustuvorlik</label>
                  <select id="edit-priority" value={editPriority} onChange={(event) => setEditPriority(event.target.value as Priority)}>
                    <option value="high">Yuqori</option><option value="normal">Oddiy</option><option value="low">Past</option>
                  </select>
                  {canManageTask && <>
                    <label htmlFor="edit-assignee">Mas’ul</label>
                    <PersonPickerField id="edit-assignee" users={users.filter((user) => user.isActive)} selectedId={editAssigneeId} onSelect={setEditAssigneeId} pickerTitle="Mas’ulni tanlang" placeholder="Mas’ulni tanlang" />
                    <label htmlFor="edit-deadline">Muddat</label>
                    <input id="edit-deadline" type="datetime-local" value={editDeadline} onChange={(event) => setEditDeadline(event.target.value)} />
                    <label htmlFor="edit-publication">Publikatsiya sanasi (ixtiyoriy)</label>
                    <input id="edit-publication" type="datetime-local" value={editPublication} onChange={(event) => setEditPublication(event.target.value)} />
                    <span className="ma-muted">Publikatsiya sanasi ishni tugatish muddatidan alohida saqlanadi.</span>
                  </>}
                  {!canManageTask && <span className="ma-muted">Mas’ul muddat, mas’ul shaxs va publikatsiya sanasini o‘zgartira olmaydi.</span>}
                  <div className="ma-form-row">
                    <button className="ma-btn primary" disabled={actionPending || !editTitle.trim() || (canManageTask && (!editAssigneeId || !editDeadline))} onClick={saveTaskEdit}>{actionPending ? "Saqlanmoqda…" : "Saqlash"}</button>
                    <button className="ma-btn secondary" disabled={actionPending} onClick={() => setShowEdit(false)}>Bekor qilish</button>
                  </div>
                  {actionError && <div className="ma-error-inline" role="alert">{actionError}</div>}
                </div>
              </section>
            )}

            {postingChecklist && (
              <section className="ma-checklist-card" aria-labelledby="posting-checklist-title">
                <div className="ma-section-head">
                  <div>
                    <h3 id="posting-checklist-title">Joylash ro‘yxati</h3>
                    <span className="ma-muted">{postingChecklist.items.filter((item) => item.isCompleted).length} / {postingChecklist.items.length} bajarilgan</span>
                  </div>
                  {postingComplete && <span className="ma-complete-chip">Tayyor</span>}
                </div>
                <div className="ma-checklist-items">
                  {postingChecklist.items.map((item) => (
                    <button
                      key={item.id}
                      className={item.isCompleted ? "complete" : ""}
                      disabled={!isAssignee || !["IN_PROGRESS", "REVISION"].includes(task.status) || checklistPendingId !== null}
                      onClick={() => toggleChecklist(item.id)}
                    >
                      <span aria-hidden="true">{item.isCompleted ? "✓" : "○"}</span>{item.label}
                    </button>
                  ))}
                </div>
                {!postingComplete && isAssignee && (
                  <p className="ma-muted">Tekshiruvga yuborish uchun barcha platformalarni belgilang.</p>
                )}
              </section>
            )}

            <TaskPlanningPanel
              key={`${taskId}:${detail?.personalPlan?.updatedAt ?? "new"}`}
              taskId={taskId}
              terminal={isTerminal(task.status)}
              plan={detail?.personalPlan ?? null}
              checkpoints={detail?.checkpoints ?? []}
              onPlan={(plan) => setDetail((previous) => previous ? { ...previous, personalPlan: plan } : previous)}
              onCheckpoints={(checkpoints) => setDetail((previous) => previous ? { ...previous, checkpoints } : previous)}
              onRefreshPlan={onPlanSaved}
              onRefreshDetail={() => { void load(true); }}
            />

            {/* Deadline requests */}
            {pendingDL.length > 0 && (
              <section className="ma-section" aria-labelledby="dl-req-title">
                <h3 id="dl-req-title">Kutilayotgan muddat so‘rovlari</h3>
                {pendingDL.map((req) => {
                  const requester = users.find((u) => u.id === req.requestedBy);
                  return (
                    <div key={req.id} className="ma-dl-req">
                      <span><strong>{requester?.displayName ?? "Foydalanuvchi"}</strong> → {fmtDateTime(req.requestedDeadline)}</span>
                      <span className="ma-muted">{req.reason}</span>
                      {(isCreator || isHead) && (
                        <div className="ma-dl-actions">
                          <button className="ma-btn primary" disabled={actionPending} onClick={() => resolveDeadline(req.id, true)}>Tasdiqlash</button>
                          <button className="ma-btn warn" disabled={actionPending} onClick={() => resolveDeadline(req.id, false)}>Rad etish</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            )}

            {/* Workflow actions */}
            {actions.length > 0 && (
              <section className="ma-section">
                <h3>Amallar</h3>
                {showBlockInput ? (
                  <div className="ma-block-form">
                    <label htmlFor="block-reason">Bloklash sababi</label>
                    <textarea
                      id="block-reason"
                      value={blockReason}
                      onChange={(e) => setBlockReason(e.target.value)}
                      rows={3}
                      placeholder="Ishga nima to‘sqinlik qilayotganini yozing…"
                    />
                    <div className="ma-form-row">
                      <button
                        className="ma-btn warn"
                        disabled={actionPending || !blockReason.trim()}
                        onClick={async () => {
                          if (await postAction("BLOCK", { reason: blockReason })) {
                            setShowBlockInput(false);
                            setBlockReason("");
                          }
                        }}
                      >
                        Bloklashni tasdiqlash
                      </button>
                      <button className="ma-btn secondary" onClick={() => setShowBlockInput(false)}>Bekor qilish</button>
                    </div>
                  </div>
                ) : confirmReview ? (
                  <div className="ma-block-form">
                    <p>Vazifa tekshiruvchiga yuboriladi. Hali checkpoint qo‘shayotgan bo‘lsangiz, bu amalni bekor qiling.</p>
                    <div className="ma-form-row">
                      <button className="ma-btn primary" disabled={actionPending} onClick={async () => {
                        if (await postAction("SUBMIT_REVIEW")) setConfirmReview(false);
                      }}>Ha, tekshiruvga yuborish</button>
                      <button className="ma-btn secondary" onClick={() => setConfirmReview(false)}>Bekor qilish</button>
                    </div>
                  </div>
                ) : showRevisionInput ? (
                  <div className="ma-block-form">
                    <label htmlFor="revision-reason">Tuzatish izohi (ixtiyoriy)</label>
                    <textarea
                      id="revision-reason"
                      value={revisionReason}
                      onChange={(event) => setRevisionReason(event.target.value)}
                      rows={3}
                      maxLength={5000}
                      placeholder="Nimani o‘zgartirish kerakligini yozing…"
                    />
                    <div className="ma-form-row">
                      <button
                        className="ma-btn warn"
                        disabled={actionPending}
                        onClick={async () => {
                          const succeeded = await postAction("REQUEST_REVISION", revisionReason.trim()
                            ? { reason: revisionReason.trim() }
                            : undefined);
                          if (succeeded) {
                            setShowRevisionInput(false);
                            setRevisionReason("");
                          }
                        }}
                      >
                        Tuzatishga qaytarish
                      </button>
                      <button className="ma-btn secondary" onClick={() => setShowRevisionInput(false)}>Bekor qilish</button>
                    </div>
                  </div>
                ) : (
                  <div className="ma-action-row">
                    {actions.map((a) => (
                      <button
                        key={a.action}
                        className={`ma-btn ${a.variant ?? "primary"}`}
                        disabled={actionPending}
                        onClick={() => {
                          if (a.action === "_block") { setShowBlockInput(true); return; }
                          if (a.action === "_revision") { setShowRevisionInput(true); return; }
                          if (a.action === "SUBMIT_REVIEW") { setConfirmReview(true); return; }
                          postAction(a.action);
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
                {actionError && <div className="ma-error-inline" role="alert">{actionError}</div>}
              </section>
            )}

            {/* Request deadline change (assignee only, non-terminal) */}
            {isAssignee && !isTerminal(task.status) && (
              <section className="ma-section">
                <h3>Muddatni o‘zgartirish</h3>
                {showDLRequest ? (
                  <div className="ma-block-form">
                    <label htmlFor="dl-date">Taklif qilinayotgan muddat</label>
                    <input id="dl-date" type="datetime-local" value={dlDate} onChange={(e) => setDlDate(e.target.value)} />
                    <label htmlFor="dl-reason">Sabab</label>
                    <textarea id="dl-reason" value={dlReason} onChange={(e) => setDlReason(e.target.value)} rows={2} placeholder="Nega qo‘shimcha vaqt kerak?" />
                    <div className="ma-form-row">
                      <button className="ma-btn primary" disabled={actionPending || !dlDate || !dlReason.trim()} onClick={requestDeadline}>So‘rov yuborish</button>
                      <button className="ma-btn secondary" onClick={() => setShowDLRequest(false)}>Bekor qilish</button>
                    </div>
                    {actionError && <div className="ma-error-inline" role="alert">{actionError}</div>}
                  </div>
                ) : (
                  <button className="ma-btn secondary" onClick={() => setShowDLRequest(true)}>Muddat o‘zgarishini so‘rash</button>
                )}
              </section>
            )}

            {canManageRecurrence && (
              <section className="ma-section">
                <h3>Takroriy vazifa</h3>
                {showRecurrenceForm ? (
                  <div className="ma-block-form">
                    <label htmlFor="recurrence-frequency">Jadval</label>
                    <select id="recurrence-frequency" value={recurrenceFrequency} onChange={(event) => setRecurrenceFrequency(event.target.value as RecurringDefinition["frequency"])}>
                      <option value="WEEKDAYS">Har ish kuni — Du–Ju</option>
                      <option value="WEEKLY">Har hafta</option>
                      <option value="MONTHLY">Har oy</option>
                    </select>
                    {recurrenceFrequency === "WEEKLY" && <>
                      <label htmlFor="recurrence-weekday">Hafta kuni</label>
                      <select id="recurrence-weekday" value={recurrenceWeekday} onChange={(event) => setRecurrenceWeekday(Number(event.target.value))}>
                        {["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                      </select>
                    </>}
                    {recurrenceFrequency === "MONTHLY" && <>
                      <label htmlFor="recurrence-day">Oy kuni</label>
                      <input id="recurrence-day" type="number" min="1" max="31" value={recurrenceDay} onChange={(event) => setRecurrenceDay(Number(event.target.value))} />
                      <span className="ma-muted">Qisqa oylarda oyning oxirgi kuni olinadi.</span>
                    </>}
                    <label htmlFor="recurrence-time">Vaqt</label>
                    <input id="recurrence-time" type="time" value={recurrenceTime} onChange={(event) => setRecurrenceTime(event.target.value)} />
                    <label htmlFor="recurrence-end">Tugash sanasi (ixtiyoriy)</label>
                    <input id="recurrence-end" type="date" value={recurrenceEnd} onChange={(event) => setRecurrenceEnd(event.target.value)} />
                    {detail?.recurringDefinition && (
                      <>
                        <label htmlFor="recurrence-assignee">Mas’ul</label>
                        <PersonPickerField
                          id="recurrence-assignee"
                          users={users.filter((u) => u.isActive)}
                          selectedId={recurrenceAssigneeId}
                          onSelect={setRecurrenceAssigneeId}
                          pickerTitle="Mas’ulni tanlang"
                          placeholder="Mas’ulni tanlang"
                        />
                      </>
                    )}
                    <div className="ma-form-row">
                      <button className="ma-btn primary" disabled={actionPending || !recurrenceTime} onClick={saveRecurrence}>Kelgusi jadvalni saqlash</button>
                      <button className="ma-btn secondary" onClick={() => setShowRecurrenceForm(false)}>Bekor qilish</button>
                    </div>
                  </div>
                ) : recurringDefinition ? (
                  <div className="ma-recurrence-card">
                    <div><strong>{recurringDefinition.frequency === "WEEKDAYS" ? "Har ish kuni" : recurringDefinition.frequency === "WEEKLY" ? `Har ${["dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba", "yakshanba"][(recurringDefinition.weekday ?? 1) - 1]}` : `Har oyning ${recurringDefinition.dayOfMonth}-kuni`}</strong><span> soat {recurringDefinition.localTime}</span></div>
                    <span className={`ma-recurrence-status ${recurringDefinition.status.toLowerCase()}`}>{RECURRENCE_STATUS_LABELS[recurringDefinition.status]}</span>
                    {recurringDefinition.status === "PAUSED" && recurringDefinition.pauseReason === "ASSIGNEE_DEACTIVATED" && (
                      <span className="ma-muted">Avtomatik to‘xtatildi: mas’ul jamoadan chiqarilgan. Mas’ulni almashtirib, davom ettiring.</span>
                    )}
                    {recurringDefinition.nextOccurrenceAt && <span className="ma-muted">Keyingisi: {fmtDateTime(recurringDefinition.nextOccurrenceAt)}</span>}
                    {recurringDefinition.status !== "STOPPED" && <div className="ma-action-row">
                      <button className="ma-btn secondary" disabled={actionPending} onClick={openRecurrenceForm}>Kelgusi jadvalni tahrirlash</button>
                      <button className="ma-btn secondary" disabled={actionPending} onClick={() => recurrenceAction(recurringDefinition.status === "PAUSED" ? "RESUME" : "PAUSE")}>{recurringDefinition.status === "PAUSED" ? "Davom ettirish" : "Vaqtincha to‘xtatish"}</button>
                      <button className="ma-btn danger" disabled={actionPending} onClick={() => recurrenceAction("STOP")}>Butunlay to‘xtatish</button>
                    </div>}
                  </div>
                ) : (
                  <button className="ma-btn secondary" onClick={openRecurrenceForm}>Takroriy qilish</button>
                )}
                {actionError && <div className="ma-error-inline" role="alert">{actionError}</div>}
              </section>
            )}

            <section className="ma-section ma-comments" aria-labelledby="task-comments-title">
              <div className="ma-section-head">
                <div><h3 id="task-comments-title">Muhokama va natijalar</h3><span className="ma-muted">{comments.length} ta yozuv</span></div>
              </div>
              {comments.length === 0 ? <div className="ma-empty compact">Hali izoh yoki natija yo‘q.</div> : (
                <ol className="ma-comment-list">
                  {comments.map((comment) => {
                    const author = users.find((user) => user.id === comment.authorId);
                    const imageAttachment = comment.attachmentUrl && /\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(comment.attachmentUrl);
                    return (
                      <li className={`ma-comment ${comment.kind.toLowerCase()}`} key={comment.id}>
                        <div className="ma-comment-head">
                          <strong>{author?.displayName ?? "Jamoa a’zosi"}</strong>
                          <span>{comment.kind === "RESULT" ? "Natija" : "Izoh"} · {fmtDateTime(comment.createdAt)}</span>
                        </div>
                        {comment.body && <p>{comment.body}</p>}
                        {comment.attachmentUrl && <>
                          {/* User-provided result links can come from any HTTPS host, so Next Image cannot safely predeclare every remote domain. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {imageAttachment && <img src={comment.attachmentUrl} alt="Biriktirilgan natija preview" loading="lazy" referrerPolicy="no-referrer" />}
                          <a href={comment.attachmentUrl} target="_blank" rel="noreferrer">Natijani ochish ↗</a>
                        </>}
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="ma-block-form ma-comment-form">
                <label htmlFor="comment-kind">Yozuv turi</label>
                <select id="comment-kind" value={commentKind} onChange={(event) => setCommentKind(event.target.value as TaskComment["kind"])}>
                  <option value="COMMENT">Izoh</option><option value="RESULT">Ish natijasi</option>
                </select>
                <label htmlFor="comment-body">Izoh</label>
                <textarea id="comment-body" rows={3} maxLength={4000} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder={commentKind === "RESULT" ? "Natija haqida qisqacha yozing" : "Fikr yoki savolingizni yozing"} />
                <label htmlFor="comment-url">Google Drive yoki boshqa havola (ixtiyoriy)</label>
                <input id="comment-url" type="url" value={commentUrl} onChange={(event) => setCommentUrl(event.target.value)} placeholder="https://…" />
                <button className="ma-btn primary" disabled={commentPending || (!commentBody.trim() && !commentUrl.trim())} onClick={submitComment}>
                  {commentPending ? "Yuborilmoqda…" : commentKind === "RESULT" ? "Natijani topshirish" : "Izoh yuborish"}
                </button>
                {actionError && <div className="ma-error-inline" role="alert">{actionError}</div>}
              </div>
            </section>

            {/* Events */}
            {events.length > 0 && (
              <section className="ma-section" aria-labelledby="events-title">
                <h3 id="events-title">Faollik tarixi</h3>
                <ol className="ma-events">
                  {events.map((ev) => {
                    const actor = ev.actorId ? users.find((u) => u.id === ev.actorId) : null;
                    return (
                      <li key={ev.id} className="ma-event">
                        <span className="ma-event-type">{EVENT_LABELS[ev.eventType] ?? ev.eventType.replace(/_/g, " ")}</span>
                        <span className="ma-muted"> · {actor?.displayName ?? "Tizim"} · {fmtDateTime(ev.createdAt)}</span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowStartPanel({ users, onClose, onStarted }: {
  users: User[];
  onClose: () => void;
  onStarted: (task: Task) => void;
}) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [subject, setSubject] = useState("");
  const [assigneeMap, setAssigneeMap] = useState<Partial<Record<Role, string>>>({});
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingTemplates, setEditingTemplates] = useState(false);

  const defaultsFor = useCallback((template: WorkflowTemplate) => {
    const next: Partial<Record<Role, string>> = {};
    for (const role of new Set(template.steps.map((step) => step.assigneeRole))) {
      const candidate = users.find((user) => user.isActive && user.role === role);
      if (candidate) next[role] = candidate.id;
    }
    return next;
  }, [users]);

  const loadTemplates = useCallback(async (preferredId?: string) => {
    const { data, error: loadError } = await apiFetch<{ templates: WorkflowTemplate[] }>("/api/workflow-templates");
    setLoading(false);
    if (!data) { setError(friendlyError(loadError)); return; }
    setError(null);
    setTemplates(data.templates);
    const selected = data.templates.find((template) => template.id === preferredId) ?? data.templates[0];
    if (selected) {
      setSelectedId(selected.id);
      setAssigneeMap(defaultsFor(selected));
    }
  }, [defaultsFor]);

  useEffect(() => { void (async () => { await loadTemplates(); })(); }, [loadTemplates]);

  const selected = templates.find((template) => template.id === selectedId) ?? null;
  const roles = selected ? [...new Set(selected.steps.map((step) => step.assigneeRole))] : [];
  const start = async () => {
    if (!selected || !subject.trim()) return;
    setPending(true);
    setError(null);
    const { data, error: startError } = await apiFetch<{ task: Task }>("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId: selected.id, subject: subject.trim(), assigneeMap }),
    });
    setPending(false);
    if (data?.task) onStarted(data.task);
    else setError(friendlyError(startError));
  };

  return (
    <div className="ma-overlay" role="dialog" aria-modal="true" aria-label="Ish jarayonini boshlash" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ma-panel">
        <div className="ma-panel-header"><button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button><span className="ma-panel-title">Marketing ish jarayoni</span></div>
        <div className="ma-panel-body">
          {editingTemplates && <WorkflowTemplateEditor templates={templates} initialTemplateId={selectedId}
            onCancel={() => setEditingTemplates(false)} onSaved={async (id) => { await loadTemplates(id); setEditingTemplates(false); }} />}
          {!editingTemplates && <>
          {loading && <div className="ma-center-inline"><div className="ma-spinner" /></div>}
          {!loading && templates.length === 0 && !error && <div className="ma-empty">Ish jarayoni shabloni topilmadi.</div>}
          <button className="ma-btn secondary" onClick={() => setEditingTemplates(true)}>⚙ Shablonlarni sozlash</button>
          {templates.length > 0 && <div className="ma-block-form">
            <label htmlFor="workflow-template">Shablon</label>
            <select id="workflow-template" value={selectedId} onChange={(event) => {
              const template = templates.find((item) => item.id === event.target.value);
              setSelectedId(event.target.value);
              if (template) setAssigneeMap(defaultsFor(template));
            }}>
              {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
            </select>
            {selected?.description && <p className="ma-muted">{selected.description}</p>}
            <label htmlFor="workflow-subject">Loyiha yoki kontent nomi</label>
            <input id="workflow-subject" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} placeholder="Masalan: Yangi filial Reels" />
            {selected && <ol className="ma-workflow-steps">
              {selected.steps.map((step) => <li key={step.id}><span>{step.position}</span><div><strong>{step.title}</strong><small>{ROLE_LABELS[step.assigneeRole]} · {step.dueAfterHours} soat</small></div></li>)}
            </ol>}
            {roles.map((role) => <div className="ma-workflow-assignee" key={role}>
              <label htmlFor={`workflow-role-${role}`}>{ROLE_LABELS[role]}</label>
              <PersonPickerField id={`workflow-role-${role}`} users={users.filter((user) => user.isActive && user.role === role)} selectedId={assigneeMap[role] ?? null} onSelect={(userId) => setAssigneeMap((current) => ({ ...current, [role]: userId }))} pickerTitle={ROLE_LABELS[role]} placeholder="Xodimni tanlang" />
            </div>)}
            <button className="ma-btn primary full" disabled={pending || !subject.trim() || roles.some((role) => !assigneeMap[role])} onClick={start}>{pending ? "Boshlanmoqda…" : "Ish jarayonini boshlash"}</button>
          </div>}
          {error && <div className="ma-error-inline" role="alert">{error}</div>}
          </>}
        </div>
      </div>
    </div>
  );
}

interface WorkflowStepDraft {
  key: string;
  title: string;
  description: string;
  assigneeRole: Role;
  priority: Priority;
  dueAfterHours: string;
}

function workflowStepDraft(step?: WorkflowTemplateStep): WorkflowStepDraft {
  return {
    key: crypto.randomUUID(), title: step?.title ?? "", description: step?.description ?? "",
    assigneeRole: step?.assigneeRole ?? "CONTENT_MARKETER", priority: step?.priority ?? "normal",
    dueAfterHours: String(step?.dueAfterHours ?? 24),
  };
}

function WorkflowTemplateEditor({ templates, initialTemplateId, onCancel, onSaved }: {
  templates: WorkflowTemplate[];
  initialTemplateId: string;
  onCancel: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const initial = templates.find((template) => template.id === initialTemplateId) ?? null;
  const [sourceId, setSourceId] = useState<string | null>(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [steps, setSteps] = useState<WorkflowStepDraft[]>(
    () => initial?.steps.map(workflowStepDraft) ?? [workflowStepDraft()],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (template: WorkflowTemplate) => {
    setSourceId(template.id); setName(template.name); setDescription(template.description ?? "");
    setSteps(template.steps.map(workflowStepDraft)); setError(null);
  };
  const updateStep = (key: string, patch: Partial<WorkflowStepDraft>) => {
    setSteps((current) => current.map((step) => step.key === key ? { ...step, ...patch } : step));
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((current) => {
      const next = [...current];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  };
  const canSave = name.trim() && steps.length > 0 && steps.every((step) =>
    step.title.trim() && Number.isInteger(Number(step.dueAfterHours)) && Number(step.dueAfterHours) >= 1 && Number(step.dueAfterHours) <= 720);
  const save = async () => {
    if (!canSave) return;
    setPending(true); setError(null);
    const { data, error: saveError } = await apiFetch<{ id: string }>("/api/workflow-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceTemplateId: sourceId, name: name.trim(), description: description.trim() || null,
        steps: steps.map(({ title, description: stepDescription, assigneeRole, priority, dueAfterHours }) => ({
          title: title.trim(), description: stepDescription.trim() || null, assigneeRole, priority,
          dueAfterHours: Number(dueAfterHours),
        })),
      }),
    });
    if (data?.id) await onSaved(data.id);
    else setError(friendlyError(saveError) ?? "Shablonni saqlab bo‘lmadi.");
    setPending(false);
  };

  return <div className="ma-block-form ma-workflow-editor">
    <button className="ma-link-btn" onClick={onCancel}>← Ish jarayoniga qaytish</button>
    <h3>Shablonlarni sozlash</h3>
    <p className="ma-muted">Faqat yangi ish jarayonlari yangilangan shablondan foydalanadi. Boshlangan jarayonlarning bosqichlari saqlanadi.</p>
    {templates.length > 0 && <><label htmlFor="template-to-edit">Tahrirlash uchun shablon</label>
      <select id="template-to-edit" value={sourceId ?? ""} onChange={(event) => {
        const template = templates.find((item) => item.id === event.target.value);
        if (template) choose(template);
      }}>
        <option value="" disabled>Yangi shablon</option>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select></>}
    <div className="ma-workflow-editor-actions">
      <button className="ma-btn secondary" onClick={() => {
        setSourceId(null); setName(""); setDescription(""); setSteps([workflowStepDraft()]); setError(null);
      }}>+ Yangi shablon</button>
      {sourceId && <button className="ma-btn secondary" onClick={() => {
        setSourceId(null); setName(`${name} nusxa`); setError(null);
      }}>Nusxa olish</button>}
    </div>
    <label htmlFor="template-name">Shablon nomi</label>
    <input id="template-name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Masalan: Yangi kampaniya" />
    <label htmlFor="template-description">Izoh (ixtiyoriy)</label>
    <textarea id="template-description" maxLength={2000} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
    <div className="ma-section-head"><h3>Bosqichlar</h3><span className="ma-muted">{steps.length}/50</span></div>
    {steps.map((step, index) => <div className="ma-workflow-step-editor" key={step.key}>
      <div className="ma-workflow-step-heading"><strong>{index + 1}. bosqich</strong><div>
        <button aria-label="Yuqoriga ko‘chirish" disabled={index === 0} onClick={() => moveStep(index, -1)}>↑</button>
        <button aria-label="Pastga ko‘chirish" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>↓</button>
        <button aria-label="Bosqichni o‘chirish" disabled={steps.length === 1} onClick={() => setSteps((current) => current.filter((item) => item.key !== step.key))}>×</button>
      </div></div>
      <label htmlFor={`step-title-${step.key}`}>Nomi</label>
      <input id={`step-title-${step.key}`} maxLength={200} value={step.title} onChange={(event) => updateStep(step.key, { title: event.target.value })} placeholder="Bosqich natijasi" />
      <label htmlFor={`step-description-${step.key}`}>Izoh (ixtiyoriy)</label>
      <textarea id={`step-description-${step.key}`} maxLength={5000} rows={2} value={step.description} onChange={(event) => updateStep(step.key, { description: event.target.value })} />
      <div className="ma-workflow-step-fields">
        <div><label htmlFor={`step-role-${step.key}`}>Mas’ul roli</label><select id={`step-role-${step.key}`} value={step.assigneeRole} onChange={(event) => updateStep(step.key, { assigneeRole: event.target.value as Role })}>
          {(Object.keys(ROLE_LABELS) as Role[]).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
        </select></div>
        <div><label htmlFor={`step-priority-${step.key}`}>Ustuvorlik</label><select id={`step-priority-${step.key}`} value={step.priority} onChange={(event) => updateStep(step.key, { priority: event.target.value as Priority })}>
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((priority) => <option key={priority} value={priority}>{PRIORITY_LABELS[priority]}</option>)}
        </select></div>
        <div><label htmlFor={`step-hours-${step.key}`}>Muddat (soat)</label><input id={`step-hours-${step.key}`} type="number" min={1} max={720} value={step.dueAfterHours} onChange={(event) => updateStep(step.key, { dueAfterHours: event.target.value })} /></div>
      </div>
    </div>)}
    {steps.length < 50 && <button className="ma-btn secondary" onClick={() => setSteps((current) => [...current, workflowStepDraft()])}>+ Bosqich qo‘shish</button>}
    {error && <div className="ma-error-inline" role="alert">{error}</div>}
    <button className="ma-btn primary full" disabled={pending || !canSave} onClick={save}>{pending ? "Saqlanmoqda…" : sourceId ? "Yangi versiyani saqlash" : "Shablonni yaratish"}</button>
  </div>;
}

// ─── Quick Add Panel ──────────────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Human-readable relative deadline summary ("Bugun, 18:00" / "Ertaga, 12:00"
 * / "16 Sep, 14:00") shown alongside the exact datetime-local control — the
 * stored/submitted timestamp is always the exact value, this is display-only. */
function relativeDeadlineSummary(local: string): string | null {
  if (!local) return null;
  const iso = localDatetimeToISO(local);
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  if (isToday(iso)) return `Bugun, ${time}`;
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (getTZDateParts(date).day === getTZDateParts(tomorrow).day
    && getTZDateParts(date).month === getTZDateParts(tomorrow).month
    && getTZDateParts(date).year === getTZDateParts(tomorrow).year) {
    return `Ertaga, ${time}`;
  }
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(date);
  return `${day}, ${time}`;
}

// ─── Person Picker (assignee bottom sheet) ─────────────────────────────────

function PersonPicker({
  title,
  users,
  selectedId,
  onSelect,
  onClose,
}: {
  title: string;
  users: User[];
  selectedId: string | null;
  onSelect: (userId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button>
          <span className="ma-panel-title">{title}</span>
        </div>
        <div className="ma-panel-body ma-picker-body">
          <ul className="ma-picker-list" aria-label={title}>
            {users.map((u) => (
              <li key={u.id}>
                <button
                  className={`ma-picker-row${u.id === selectedId ? " selected" : ""}`}
                  onClick={() => { onSelect(u.id); onClose(); }}
                >
                  <span className="ma-picker-avatar" aria-hidden="true">{initials(u.displayName)}</span>
                  <span className="ma-picker-info">
                    <span className="ma-picker-name">{u.displayName}</span>
                    <span className="ma-picker-role">{ROLE_LABELS[u.role]}</span>
                  </span>
                  {u.id === selectedId && <span className="ma-picker-check" aria-hidden="true">✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Button that looks like the other form controls but opens a full
 * tappable-row bottom sheet instead of a native <select> — the team is
 * small, so a clean list beats squeezing this into a cramped dropdown. */
function PersonPickerField({
  id,
  users,
  selectedId,
  onSelect,
  pickerTitle,
  placeholder,
}: {
  id: string;
  users: User[];
  selectedId: string | null;
  onSelect: (userId: string) => void;
  pickerTitle: string;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = users.find((u) => u.id === selectedId) ?? null;

  return (
    <>
      <button type="button" id={id} className="ma-picker-trigger" onClick={() => setOpen(true)}>
        {selected ? (
          <>
            <span className="ma-picker-avatar sm" aria-hidden="true">{initials(selected.displayName)}</span>
            <span className="ma-picker-trigger-name">{selected.displayName}</span>
          </>
        ) : (
          <span className="ma-picker-trigger-placeholder">{placeholder}</span>
        )}
        <span className="ma-picker-trigger-chevron" aria-hidden="true">›</span>
      </button>
      {open && (
        <PersonPicker
          title={pickerTitle}
          users={users}
          selectedId={selectedId}
          onSelect={onSelect}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function QuickAddPanel({
  currentUser,
  users,
  usersLoaded,
  usersError,
  onRetryTeam,
  onClose,
  onCreated,
}: {
  currentUser: User;
  users: User[];
  usersLoaded: boolean;
  usersError: string | null;
  onRetryTeam: () => void;
  onClose: () => void;
  onCreated: (result: { task: Task; notification: AssignmentNotificationResult }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeUsers = users.filter((u) => u.isActive);
  // Never allow submission before the team list is ready: an assignee
  // picked while it's still loading would either be missing from the
  // dropdown or silently fall back to self-assignment. This is a loading
  // state, not a "not found" error.
  const teamReady = usersLoaded && activeUsers.length > 0;

  const submit = async () => {
    if (pending || !teamReady || !title.trim() || !assigneeId || !deadline) return;
    setPending(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      priority,
      assigneeId,
      deadline: localDatetimeToISO(deadline),
    };
    if (description.trim()) body.description = description.trim();

    const { data, error: e } = await apiFetch<{ task: Task; notification: AssignmentNotificationResult }>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setPending(false);
    if (e) { setError(friendlyError(e)); return; }
    if (!data) { setError("Vazifa yaratilmadi."); return; }
    onCreated(data);
  };

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Tezkor vazifa qo‘shish"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button>
          <span className="ma-panel-title">Yangi vazifa</span>
        </div>
        <div className="ma-panel-body">
          <div className="ma-form-group">
            <label htmlFor="qa-title">Nomi *</label>
            <input
              id="qa-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Vazifa nomi"
            />
          </div>
          <div className="ma-form-group">
            <label htmlFor="qa-assignee">Mas’ul *</label>
            {!usersLoaded && !usersError && (
              <div className="ma-loading-inline">
                <div className="ma-spinner ma-spinner-sm" aria-label="Jamoa yuklanmoqda" />
                <span>Jamoa yuklanmoqda…</span>
              </div>
            )}
            {usersError && (
              <div className="ma-error-inline" role="alert">
                <span>Jamoa ma&apos;lumotlarini yuklab bo&apos;lmadi. Qayta urinib ko&apos;ring.</span>
                <button type="button" className="ma-link-btn" onClick={onRetryTeam}>Qayta urinish</button>
              </div>
            )}
            {usersLoaded && (
              <PersonPickerField
                id="qa-assignee"
                users={activeUsers}
                selectedId={assigneeId}
                onSelect={setAssigneeId}
                pickerTitle="Mas’ulni tanlang"
                placeholder="Mas’ulni tanlang"
              />
            )}
          </div>
          <div className="ma-form-group">
            <label htmlFor="qa-deadline">Muddat *</label>
            <input id="qa-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            {relativeDeadlineSummary(deadline) && (
              <span className="ma-deadline-summary">{relativeDeadlineSummary(deadline)}</span>
            )}
          </div>
          <details className="ma-more-details">
            <summary>Ustuvorlik va tavsif</summary>
            <div className="ma-form-group">
              <label htmlFor="qa-priority">Ustuvorlik</label>
              <select id="qa-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {(["low", "normal", "high"] as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="ma-form-group">
              <label htmlFor="qa-desc">Tavsif</label>
              <textarea
                id="qa-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Ixtiyoriy tafsilotlar…"
              />
            </div>
          </details>
          {error && <div className="ma-error-inline" role="alert">{error}</div>}
          <button className="ma-btn primary full" disabled={pending || !teamReady || !title.trim() || !deadline || !assigneeId} onClick={submit}>
            {pending ? "Yaratilmoqda…" : !teamReady ? "Jamoa yuklanmoqda…" : "Vazifa yaratish"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pending Users Panel ──────────────────────────────────────────────────────

function PendingUsersPanel({
  users,
  onClose,
  onActivated,
}: {
  users: User[];
  onClose: () => void;
  onActivated: () => void;
}) {
  const [roles, setRoles] = useState<Record<string, Role>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const activate = async (userId: string) => {
    const role = roles[userId] ?? "OPERATOR_VIDEO_EDITOR";
    setPending((p) => ({ ...p, [userId]: true }));
    setErrors((e) => ({ ...e, [userId]: "" }));
    const { error } = await apiFetch<{ user: User }>(`/api/users/${userId}/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setPending((p) => ({ ...p, [userId]: false }));
    if (error) {
      setErrors((e) => ({ ...e, [userId]: friendlyError(error) ?? error }));
      return;
    }
    onActivated();
  };

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Kutilayotgan foydalanuvchilar"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button>
          <span className="ma-panel-title">Kutilayotgan foydalanuvchilar</span>
        </div>
        <div className="ma-panel-body">
          {users.length === 0 && <p className="ma-muted">Kutilayotgan foydalanuvchi yo‘q.</p>}
          {users.map((u) => (
            <div key={u.id} className="ma-pending-user">
              <div className="ma-pending-name">{u.displayName}</div>
              <div className="ma-form-row">
                <select
                  aria-label={`${u.displayName} uchun rol`}
                  value={roles[u.id] ?? "OPERATOR_VIDEO_EDITOR"}
                  onChange={(e) => setRoles((r) => ({ ...r, [u.id]: e.target.value as Role }))}
                >
                  {ACTIVATION_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <button
                  className="ma-btn primary"
                  disabled={pending[u.id]}
                  onClick={() => activate(u.id)}
                >
                  {pending[u.id] ? "…" : "Faollashtirish"}
                </button>
              </div>
              {errors[u.id] && <div className="ma-error-inline" role="alert">{errors[u.id]}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Panel ────────────────────────────────────────────────────────────

function ProfilePanel({
  user,
  themePreference,
  onThemePreference,
  onClose,
}: {
  user: User;
  themePreference: ThemePreference;
  onThemePreference: (choice: ThemePreference) => void;
  onClose: () => void;
}) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [savingPreference, setSavingPreference] = useState<keyof NotificationPreferences | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await apiFetch<NotificationPreferences>("/api/me/notification-preferences");
      if (data) setPreferences(data);
      else setPreferencesError(friendlyError(error));
    })();
  }, []);

  const togglePreference = async (key: keyof NotificationPreferences) => {
    if (!preferences || savingPreference) return;
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSavingPreference(key);
    setPreferencesError(null);
    const { data, error } = await apiFetch<NotificationPreferences>("/api/me/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next[key] }),
    });
    setSavingPreference(null);
    if (data) setPreferences(data);
    else {
      setPreferences(previous);
      setPreferencesError(friendlyError(error));
    }
  };

  const preferenceLabels: Array<[keyof NotificationPreferences, string, string]> = [
    ["assignments", "Yangi vazifalar", "Sizga yangi vazifa biriktirilganda"],
    ["workflow", "Vazifa jarayoni", "Tekshiruv, tasdiq va tuzatishlar"],
    ["reminders", "Muddat eslatmalari", "Yaqinlashgan va kechikkan vazifalar"],
    ["dailyCheck", "17:30 kunlik tekshiruv", "Ish kunlari kun yakuni savoli"],
    ["reports", "Hisobotlar", "Ertalabki va haftalik xulosalar"],
  ];

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Profil"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button>
          <span className="ma-panel-title">Profil</span>
        </div>
        <div className="ma-panel-body">
          <dl className="ma-detail-meta">
            <dt>Ism</dt><dd>{user.displayName}</dd>
            <dt>Rol</dt><dd>{ROLE_LABELS[user.role]}</dd>
            {user.telegramUsername && <><dt>Telegram</dt><dd>@{user.telegramUsername}</dd></>}
          </dl>
          <p className="ma-muted">Tashkiliy rolni faqat Marketing rahbari o&lsquo;zgartirishi mumkin.</p>
          <section className="ma-section ma-theme-setting" aria-label="Ko‘rinish sozlamasi">
            <h3>Ko‘rinish</h3>
            <p className="ma-muted">O‘qishga qulay rangni tanlang.</p>
            <div role="group" aria-label="Rang rejimi">
              {(["light", "dark", "system"] as ThemePreference[]).map((choice) => <button key={choice}
                className={themePreference === choice ? "active" : ""}
                aria-pressed={themePreference === choice}
                onClick={() => onThemePreference(choice)}>
                {choice === "light" ? "Yorug‘" : choice === "dark" ? "Tungi" : "Qurilmaga mos"}
              </button>)}
            </div>
          </section>
          <section className="ma-section ma-preferences" aria-labelledby="notification-settings-title">
            <div><h3 id="notification-settings-title">Bildirishnomalar</h3><span className="ma-muted">Qaysi Telegram xabarlarini olishni tanlang.</span></div>
            {!preferences && !preferencesError && <div className="ma-spinner" aria-label="Sozlamalar yuklanmoqda" />}
            {preferences && preferenceLabels.map(([key, label, description]) => (
              <label className="ma-preference-row" key={key}>
                <span><strong>{label}</strong><small>{description}</small></span>
                <input type="checkbox" checked={preferences[key]} disabled={savingPreference !== null} onChange={() => togglePreference(key)} />
              </label>
            ))}
            {preferencesError && <div className="ma-error-inline" role="alert">{preferencesError}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Role Edit Sheet ──────────────────────────────────────────────────────────

function RoleEditSheet({
  user,
  onClose,
  onSaved,
}: {
  user: User;
  onClose: () => void;
  onSaved: (user: User) => void;
}) {
  const [role, setRole] = useState<Role>(
    ACTIVATION_ROLES.includes(user.role) ? user.role : ACTIVATION_ROLES[0]
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (pending) return;
    if (role === user.role) { onClose(); return; }
    setPending(true);
    setError(null);
    const { data, error: e } = await apiFetch<{ user: User }>(`/api/users/${user.id}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    setPending(false);
    if (e) { setError(friendlyError(e)); return; }
    if (data?.user) onSaved(data.user);
  };

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Rolni o‘zgartirish"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button>
          <span className="ma-panel-title">Rolni o‘zgartirish</span>
        </div>
        <div className="ma-panel-body">
          <p className="ma-muted">
            <strong>{user.displayName}</strong> roli o‘zgartirilmoqda. O‘zgarish darhol kuchga kiradi.
          </p>
          <div className="ma-role-options" role="radiogroup" aria-label="Rol">
            {ACTIVATION_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                className={`ma-role-option${role === r ? " active" : ""}`}
                onClick={() => setRole(r)}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
          {error && <div className="ma-error-inline" role="alert">{error}</div>}
          <div className="ma-form-row">
            <button className="ma-btn primary full" disabled={pending} onClick={save}>
              {pending ? "Saqlanmoqda…" : "Rolni saqlash"}
            </button>
            <button className="ma-btn secondary" onClick={onClose} disabled={pending}>Bekor qilish</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Deactivate Member Sheet ──────────────────────────────────────────────────

interface DeactivationPreview {
  user: User;
  openTasks: { id: string; title: string; status: TaskStatus; deadline: string }[];
  historicalTaskCount: number;
  activeRecurringCount: number;
}

type OpenTasksAction = "REASSIGN" | "CANCEL" | "KEEP";

function DeactivateMemberSheet({
  user,
  users,
  onClose,
  onDeactivated,
}: {
  user: User;
  users: User[];
  onClose: () => void;
  onDeactivated: (user: User) => void;
}) {
  const [preview, setPreview] = useState<DeactivationPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [action, setAction] = useState<OpenTasksAction>("REASSIGN");
  const [reassignTo, setReassignTo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error: e } = await apiFetch<DeactivationPreview>(`/api/users/${user.id}/deactivation-preview`);
      setLoading(false);
      if (data) {
        setPreview(data);
        if (data.openTasks.length === 0) setAction("KEEP");
      } else {
        setLoadError(friendlyError(e) ?? "Xodim vazifalari xulosasini yuklab bo‘lmadi.");
      }
    })();
  }, [user.id]);

  const reassignCandidates = users.filter((candidate) => candidate.isActive && candidate.id !== user.id);
  const openCount = preview?.openTasks.length ?? 0;

  const confirm = async () => {
    if (pending || (action === "REASSIGN" && !reassignTo)) return;
    setPending(true);
    setError(null);
    const { data, error: e } = await apiFetch<{ user: User }>(`/api/users/${user.id}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        openTasksAction: action,
        ...(action === "REASSIGN" ? { reassignToUserId: reassignTo } : {}),
      }),
    });
    setPending(false);
    if (e) { setError(friendlyError(e)); return; }
    if (data?.user) onDeactivated(data.user);
  };

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Jamoadan chiqarish"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button>
          <span className="ma-panel-title">Jamoadan chiqarish</span>
        </div>
        <div className="ma-panel-body">
          {loading && <div className="ma-center-inline"><div className="ma-spinner" /></div>}
          {loadError && <div className="ma-error" role="alert">{loadError}</div>}
          {preview && (
            <>
              <p className="ma-detail-desc"><strong>{user.displayName}</strong> faol jamoadan chiqarilsinmi?</p>
              <ul className="ma-fact-list">
                <li>{openCount} ta faol vazifa</li>
                <li>{preview.historicalTaskCount} ta tarixiy vazifa</li>
                {preview.activeRecurringCount > 0 && (
                  <li>{preview.activeRecurringCount} ta takroriy jadval to‘xtatiladi</li>
                )}
              </ul>
              <p className="ma-muted">Natijada foydalanuvchi:</p>
              <ul className="ma-fact-list muted">
                <li>yangi vazifa va bot xabarlarini olmaydi;</li>
                <li>Mini App’ga faol kirish huquqini yo‘qotadi;</li>
                <li>tarixiy vazifa yozuvlarida saqlanib qoladi.</li>
              </ul>

              {openCount > 0 && (
                <>
                  <h3>{openCount} ta ochiq vazifa bilan nima qilinsin?</h3>
                  <div className="ma-role-options" role="radiogroup" aria-label="Ochiq vazifalarni boshqarish">
                    <button type="button" role="radio" aria-checked={action === "REASSIGN"}
                      className={`ma-role-option${action === "REASSIGN" ? " active" : ""}`}
                      onClick={() => setAction("REASSIGN")}>
                      Boshqa xodimga o‘tkazish
                    </button>
                    <button type="button" role="radio" aria-checked={action === "CANCEL"}
                      className={`ma-role-option${action === "CANCEL" ? " active" : ""}`}
                      onClick={() => setAction("CANCEL")}>
                      Vazifalarni bekor qilish
                    </button>
                    <button type="button" role="radio" aria-checked={action === "KEEP"}
                      className={`ma-role-option${action === "KEEP" ? " active" : ""}`}
                      onClick={() => setAction("KEEP")}>
                      Hozircha o‘z holicha qoldirish
                    </button>
                  </div>
                  {action === "REASSIGN" && (
                    <div className="ma-form-group">
                      <label htmlFor="reassign-to">Kimga o‘tkazilsin</label>
                      <PersonPickerField
                        id="reassign-to"
                        users={reassignCandidates}
                        selectedId={reassignTo || null}
                        onSelect={setReassignTo}
                        pickerTitle="Yangi mas’ulni tanlang"
                        placeholder="Xodimni tanlang…"
                      />
                    </div>
                  )}
                </>
              )}

              {error && <div className="ma-error-inline" role="alert">{error}</div>}
              <div className="ma-form-row">
                <button
                  className="ma-btn danger full"
                  disabled={pending || (action === "REASSIGN" && !reassignTo)}
                  onClick={confirm}
                >
                  {pending ? "Chiqarilmoqda…" : "Jamoadan chiqarish"}
                </button>
                <button className="ma-btn secondary" onClick={onClose} disabled={pending}>Bekor qilish</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
