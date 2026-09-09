"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  deadlineRequests: DeadlineRequest[];
  postingChecklist: PostingChecklist | null;
  recurringDefinition: RecurringDefinition | null;
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

type AssignmentNotificationResult =
  | { status: "SENT" }
  | { status: "FAILED"; reason: "ASSIGNEE_NOT_ONBOARDED" | "DELIVERY_FAILED" };

type Filter = "my" | "today" | "overdue" | "team" | "review" | "blocked";
type BackendScope = "my" | "today" | "overdue" | "team" | "review";
type ViewMode = "list" | "kanban";
type Nav = "home" | "tasks" | "team" | "reports";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  BLOCKED: "Blocked",
  REVIEW: "Review",
  REVISION: "Revision",
  DONE: "Done",
  CANCELLED: "Cancelled",
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
  low: "Low",
  normal: "Normal",
  high: "High",
};

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

const ROLE_LABELS: Record<Role, string> = {
  OPERATOR_VIDEO_EDITOR: "Video Editor",
  CONTENT_MARKETER: "Content Marketer",
  DIGITAL_MARKETER: "Digital Marketer",
  SMM_MANAGER: "SMM Manager",
  HEAD_OF_MARKETING: "Head of Marketing",
};

const ACTIVATION_ROLES: Role[] = [
  "OPERATOR_VIDEO_EDITOR",
  "CONTENT_MARKETER",
  "DIGITAL_MARKETER",
  "SMM_MANAGER",
];

const FILTER_LABELS: Record<Filter, string> = {
  my: "My Tasks",
  today: "Today",
  overdue: "Overdue",
  team: "Team",
  review: "Review",
  blocked: "Blocked",
};

const EMPTY_COPY: Record<Filter, string> = {
  my: "No tasks assigned to you yet.",
  today: "Bugun task yo‘q",
  overdue: "Overdue tasklar yo‘q",
  team: "No team tasks yet.",
  review: "Nothing waiting for review.",
  blocked: "No blocked tasks.",
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
  return d.toLocaleDateString("en-US", {
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
  return d.toLocaleString("en-US", {
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
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Convert a datetime-local string to Asia/Tashkent offset-bearing ISO string (+05:00) */
function localDatetimeToISO(local: string): string {
  if (!local) return "";
  // local is "YYYY-MM-DDTHH:mm" — append seconds and +05:00 offset
  const withSeconds = local.length === 16 ? local + ":00" : local;
  return withSeconds + "+05:00";
}

/** Recognizably technical failures get a human message; validation messages
 * from the API are already human-authored and are shown as-is. */
function friendlyError(message: string | null): string | null {
  if (!message) return message;
  const technical = /fetch|network|unexpected token|http 5\d\d|internal server error|typeerror/i;
  return technical.test(message) ? "Something went wrong. Please try again." : message;
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
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [homeTasks, setHomeTasks] = useState<Task[]>([]);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPendingUsers, setShowPendingUsers] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [roleEditUser, setRoleEditUser] = useState<User | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [taskNotice, setTaskNotice] = useState<{ kind: "success" | "warning"; text: string } | null>(null);

  const isHead = currentUser?.role === "HEAD_OF_MARKETING";

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

      setAuthState("no-telegram");
    })();
  }, []);

  // Load users
  const loadUsers = useCallback(async () => {
    const { data } = await apiFetch<{ users: User[] }>("/api/users");
    if (data?.users) setUsers(data.users);
  }, []);

  // Load the Tasks-tab list for the active filter
  const loadTasks = useCallback(
    async (f: Filter) => {
      setLoadingTasks(true);
      setTasksError(null);
      const scope = scopeForFilter(f, isHead);
      const { data, error } = await apiFetch<{ tasks: Task[] }>(
        `/api/tasks?scope=${scope}`
      );
      setLoadingTasks(false);
      if (data?.tasks) {
        setTasks(f === "blocked" ? data.tasks.filter((t) => t.status === "BLOCKED") : data.tasks);
      } else {
        setTasksError(friendlyError(error) ?? "Failed to load tasks");
      }
    },
    [isHead]
  );

  // Load the Home/Team overview dataset (team-wide for Head, personal otherwise)
  const loadHome = useCallback(async () => {
    setHomeLoading(true);
    setHomeError(null);
    const { data, error } = await apiFetch<{ tasks: Task[] }>(
      `/api/tasks?scope=${isHead ? "team" : "my"}`
    );
    setHomeLoading(false);
    if (data?.tasks) setHomeTasks(data.tasks);
    else setHomeError(friendlyError(error) ?? "Failed to load overview");
  }, [isHead]);

  useEffect(() => {
    if (authState !== "authed") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([loadUsers(), loadTasks(filter), loadHome()]);
  }, [authState, filter, loadUsers, loadTasks, loadHome]);

  const refreshAll = useCallback(() => {
    void loadTasks(filter);
    void loadHome();
  }, [loadTasks, filter, loadHome]);

  const goToFilter = useCallback((f: Filter) => {
    setMemberFilter(null);
    setFilter(f);
    setNav("tasks");
  }, []);

  const changeFilter = useCallback((f: Filter) => {
    setMemberFilter(null);
    setFilter(f);
  }, []);

  const selectMember = useCallback((userId: string) => {
    setMemberFilter(userId);
    setFilter("team");
    setNav("tasks");
  }, []);

  const handleRoleSaved = useCallback((updated: User) => {
    setRoleEditUser(null);
    setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, role: updated.role } : u)));
    setCurrentUser((prev) => (prev && prev.id === updated.id ? { ...prev, role: updated.role } : prev));
    setTaskNotice({ kind: "success", text: `Role updated to ${ROLE_LABELS[updated.role]}.` });
  }, []);

  if (authState === "loading") {
    return (
      <div className="ma-center">
        <div className="ma-spinner" aria-label="Loading" />
      </div>
    );
  }

  if (authState === "no-telegram") {
    const inactiveMessage = authError && /aktiv|no longer active/i.test(authError) ? authError : null;
    return (
      <div className="ma-center">
        <div className="ma-no-tg">
          <div className="ma-no-tg-icon" aria-hidden="true">M</div>
          <p>{inactiveMessage ? "You're not on the active team." : "Open this app from Telegram."}</p>
          <span className="ma-muted">
            {inactiveMessage ?? "This workspace is only accessible through the Telegram Mini App or a signed-in browser session."}
          </span>
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
              aria-label={`${pendingUsers.length} pending users`}
            >
              {pendingUsers.length}
            </button>
          )}
          <button
            className="ma-icon-btn"
            onClick={() => setShowQuickAdd(true)}
            aria-label="Add task"
          >
            +
          </button>
        </div>
      </header>

      <main className="ma-main">
        {taskNotice && (
          <div className={`ma-notice ${taskNotice.kind}`} role="status">
            <span>{taskNotice.text}</span>
            <button onClick={() => setTaskNotice(null)} aria-label="Dismiss notification">×</button>
          </div>
        )}

        {nav === "home" && (
          <HomeView
            isHead={isHead}
            displayName={currentUser?.displayName ?? ""}
            tasks={homeTasks}
            users={users}
            loading={homeLoading}
            error={homeError}
            onRetry={loadHome}
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
            memberFilterUser={memberFilterUser}
            onClearMember={() => setMemberFilter(null)}
          />
        )}

        {nav === "team" && isHead && (
          <TeamView
            tasks={homeTasks}
            users={users}
            inactiveMembers={inactiveMembers}
            loading={homeLoading}
            error={homeError}
            onRetry={loadHome}
            onSelectMember={selectMember}
            onEditRole={setRoleEditUser}
            onDeactivate={setDeactivateTarget}
            onReactivated={(updated) => {
              setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
              setTaskNotice({ kind: "success", text: `${updated.displayName} is active again.` });
            }}
          />
        )}

        {nav === "reports" && <ReportsView isHead={isHead} />}
      </main>

      <BottomNav nav={nav} onChange={setNav} showTeam={isHead} />

      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          currentUser={currentUser!}
          users={users}
          onClose={() => setSelectedTaskId(null)}
          onRefresh={refreshAll}
        />
      )}

      {showQuickAdd && (
        <QuickAddPanel
          currentUser={currentUser!}
          users={users}
          onClose={() => setShowQuickAdd(false)}
          onCreated={(notification) => {
            setShowQuickAdd(false);
            setTaskNotice(notification.status === "SENT"
              ? { kind: "success", text: "Task created and assignee notified." }
              : {
                  kind: "warning",
                  text: "Task created, but the private notification was not delivered. Ask the assignee to send /start to the bot.",
                });
            refreshAll();
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
          onClose={() => setShowProfile(false)}
          onEditRole={() => { setShowProfile(false); setRoleEditUser(currentUser); }}
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
            setTaskNotice({ kind: "success", text: `${updated.displayName} was removed from the active team.` });
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
    { key: "home", label: "Home" },
    { key: "tasks", label: "Tasks" },
    ...(showTeam ? [{ key: "team" as Nav, label: "Team" }] : []),
    { key: "reports", label: "Reports" },
  ];
  return (
    <nav className="ma-bottom-nav" aria-label="Primary">
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
  { key: "today", label: "Today", tone: "primary" },
  { key: "overdue", label: "Overdue", tone: "danger" },
  { key: "blocked", label: "Blocked", tone: "warning" },
  { key: "review", label: "Review", tone: "violet" },
];

function HomeView({
  isHead,
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
  if (loading && tasks.length === 0) {
    return <div className="ma-center-inline"><div className="ma-spinner" aria-label="Loading" /></div>;
  }
  if (error) {
    return <div className="ma-error" role="alert">{error} <button onClick={onRetry}>Retry</button></div>;
  }

  const counts = countsFor(tasks);
  const priority = priorityTasks(tasks);
  const firstName = displayName.split(" ")[0] || displayName;

  return (
    <div className="ma-home">
      <div className="ma-greeting">
        <h1>{tashkentGreeting()}, {firstName}</h1>
        <p className="ma-muted">{isHead ? "Here's how the team is doing." : "Here's what's on your plate."}</p>
      </div>

      <div className="ma-stat-grid">
        {STAT_TILES.map((tile) => (
          <button key={tile.key} className={`ma-stat-tile tone-${tile.tone}`} onClick={() => onGoToFilter(tile.key)}>
            <span className="ma-stat-value">{counts[tile.key as keyof typeof counts]}</span>
            <span className="ma-stat-label">{tile.label}</span>
          </button>
        ))}
      </div>

      {isHead && (
        <section className="ma-section">
          <div className="ma-section-head">
            <h3>Team workload</h3>
            <button className="ma-link-btn" onClick={() => onGoToFilter("team")}>View all</button>
          </div>
          <WorkloadList tasks={tasks} users={users} onSelectMember={onSelectMember} limit={4} />
        </section>
      )}

      <section className="ma-section">
        <h3>{isHead ? "Priority tasks" : "Your priority tasks"}</h3>
        {priority.length === 0 ? (
          <div className="ma-empty">{isHead ? "Nothing urgent right now." : "You're all caught up."}</div>
        ) : (
          <TaskList tasks={priority} users={users} onSelect={onSelectTask} />
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
  const rows = workloadFor(tasks, users).slice(0, limit ?? undefined);
  if (rows.length === 0) {
    return <div className="ma-empty">No active team members yet.</div>;
  }
  return (
    <ul className="ma-workload-list">
      {rows.map((row) => (
        <li key={row.user.id} className="ma-workload-item">
          <button className="ma-workload-row" onClick={() => onSelectMember(row.user.id)}>
            <span className="ma-workload-name">
              {row.user.displayName}
              <span className="ma-muted"> · {ROLE_LABELS[row.user.role]}</span>
            </span>
            <span className="ma-workload-counts">
              <span className="ma-workload-count">{row.open} open</span>
              <span className="ma-workload-count">{row.today} today</span>
              <span className={`ma-workload-count${row.overdue > 0 ? " danger" : ""}`}>{row.overdue} overdue</span>
            </span>
          </button>
          {row.user.role !== "HEAD_OF_MARKETING" && (onEditRole || onDeactivate) && (
            <span className="ma-workload-actions">
              {onEditRole && (
                <button
                  className="ma-workload-edit"
                  onClick={() => onEditRole(row.user)}
                  aria-label={`Edit role for ${row.user.displayName}`}
                  title="Edit role"
                >
                  ✎
                </button>
              )}
              {onDeactivate && (
                <button
                  className="ma-workload-edit danger"
                  onClick={() => onDeactivate(row.user)}
                  aria-label={`Remove ${row.user.displayName} from team`}
                  title="Remove from team"
                >
                  ⛔
                </button>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
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
    return <div className="ma-center-inline"><div className="ma-spinner" aria-label="Loading" /></div>;
  }
  if (error) {
    return <div className="ma-error" role="alert">{error} <button onClick={onRetry}>Retry</button></div>;
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
        <h1>Team workload</h1>
        <p className="ma-muted">Tap a teammate to see their tasks, ✎ to fix their role, or ⛔ to remove them.</p>
      </div>
      <WorkloadList tasks={tasks} users={users} onSelectMember={onSelectMember} onEditRole={onEditRole} onDeactivate={onDeactivate} />

      {inactiveMembers.length > 0 && (
        <section className="ma-section">
          <button className="ma-section-head ma-collapse-toggle" onClick={() => setShowInactive((value) => !value)} aria-expanded={showInactive}>
            <h3>Inactive members ({inactiveMembers.length})</h3>
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
                    {reactivating === member.id ? "…" : "Reactivate"}
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
  memberFilterUser: User | null;
  onClearMember: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const primaryFilters: Filter[] = isHead ? ["my", "today", "overdue", "team"] : ["my", "today", "overdue"];
  const extraActive = filter === "review" || filter === "blocked" ? filter : null;

  return (
    <div className="ma-tasks-view">
      <nav className="ma-filters" aria-label="Task filters">
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
            Filters ▾
          </button>
          {moreOpen && (
            <div className="ma-filter-sheet" role="menu">
              <button role="menuitem" onClick={() => { onFilterChange("review"); setMoreOpen(false); }}>Review</button>
              <button role="menuitem" onClick={() => { onFilterChange("blocked"); setMoreOpen(false); }}>Blocked</button>
            </div>
          )}
        </div>
        <div className="ma-view-toggle" role="group" aria-label="View mode">
          <button
            className={`ma-view-btn${viewMode === "list" ? " active" : ""}`}
            onClick={() => onViewModeChange("list")}
            aria-pressed={viewMode === "list"}
            title="List view"
          >
            ☰
          </button>
          <button
            className={`ma-view-btn${viewMode === "kanban" ? " active" : ""}`}
            onClick={() => onViewModeChange("kanban")}
            aria-pressed={viewMode === "kanban"}
            title="Kanban view"
          >
            ⊞
          </button>
        </div>
      </nav>

      {memberFilterUser && (
        <div className="ma-member-chip">
          Showing <strong>{memberFilterUser.displayName}</strong>
          <button onClick={onClearMember} aria-label="Clear teammate filter">×</button>
        </div>
      )}

      {loading && (
        <div className="ma-center-inline">
          <div className="ma-spinner" aria-label="Loading tasks" />
        </div>
      )}
      {!loading && error && (
        <div className="ma-error" role="alert">
          {error}
          <button onClick={onRetry}>Retry</button>
        </div>
      )}
      {!loading && !error && tasks.length === 0 && (
        <div className="ma-empty">{EMPTY_COPY[filter]}</div>
      )}
      {!loading && !error && tasks.length > 0 && (
        viewMode === "list"
          ? <TaskList tasks={tasks} users={users} onSelect={onSelect} />
          : <KanbanBoard tasks={tasks} users={users} onSelect={onSelect} />
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
    <ul className="ma-task-list" aria-label="Tasks">
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
      aria-label={`Task: ${task.title}`}
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
          {overdue ? "Overdue · " : today ? "Today · " : ""}
          {fmtDate(task.deadline)}
        </span>
      </div>
    </button>
  );
}

// ─── Reports / analytics ─────────────────────────────────────────────────────

function metricDuration(hours: number | null): string {
  if (hours == null) return "—";
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function metricPercent(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

function ReportsView({ isHead }: { isHead: boolean }) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiFetch<AnalyticsResponse>("/api/reports?days=30");
    setLoading(false);
    if (result.data) setData(result.data);
    else setError(friendlyError(result.error) ?? "Failed to load reports");
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="ma-center-inline"><div className="ma-spinner" /></div>;
  if (error) return <div className="ma-error" role="alert">{error}<button onClick={load}>Retry</button></div>;
  if (!data) return null;
  const metric = data.metrics;
  const maxThroughput = Math.max(metric.created, metric.completed, 1);

  return (
    <div className="ma-reports">
      <div className="ma-section-head">
        <div>
          <span className="ma-eyebrow">Operational visibility</span>
          <h1>{isHead ? "Team reports" : "My reports"}</h1>
        </div>
        <span className="ma-window-chip">Last 30 days</span>
      </div>

      <section className="ma-report-card">
        <h3>Created vs completed</h3>
        <div className="ma-comparison-row"><span>Created</span><strong>{metric.created}</strong></div>
        <div className="ma-bar"><span style={{ width: `${metric.created / maxThroughput * 100}%` }} /></div>
        <div className="ma-comparison-row"><span>Completed</span><strong>{metric.completed}</strong></div>
        <div className="ma-bar success"><span style={{ width: `${metric.completed / maxThroughput * 100}%` }} /></div>
      </section>

      <div className="ma-report-grid">
        <div className="ma-report-stat"><span>Carry-over</span><strong>{metric.carryOver}</strong></div>
        <div className="ma-report-stat danger"><span>Current overdue</span><strong>{metric.currentOverdue}</strong></div>
        <div className="ma-report-stat"><span>On-time</span><strong>{metricPercent(metric.onTimeCompletionRate)}</strong></div>
        <div className="ma-report-stat"><span>Revision rate</span><strong>{metricPercent(metric.revisionRate)}</strong></div>
        <div className="ma-report-stat"><span>Deadline requests</span><strong>{metric.deadlineChangeRequests}</strong></div>
        <div className="ma-report-stat"><span>Avg cycle</span><strong>{metricDuration(metric.averageCycleHours)}</strong></div>
      </div>

      <section className="ma-report-card">
        <h3>Current workload</h3>
        <div className="ma-workload-metrics">
          <span>Open <strong>{metric.workload.open}</strong></span>
          <span>In progress <strong>{metric.workload.inProgress}</strong></span>
          <span>Today <strong>{metric.workload.dueToday}</strong></span>
          <span>Next 48h <strong>{metric.workload.dueNext48h}</strong></span>
          <span>High <strong>{metric.workload.highPriority}</strong></span>
          <span className="danger">Overdue <strong>{metric.workload.overdue}</strong></span>
          <span>Blocked <strong>{metric.workload.blocked}</strong></span>
          <span>Review <strong>{metric.workload.review}</strong></span>
        </div>
      </section>

      {(metric.posting.created > 0 || metric.posting.currentOpen > 0) && (
        <section className="ma-report-card">
          <h3>#posting workflow</h3>
          <div className="ma-workload-metrics">
            <span>Created <strong>{metric.posting.created}</strong></span>
            <span>Completed <strong>{metric.posting.completed}</strong></span>
            <span>Current open <strong>{metric.posting.currentOpen}</strong></span>
          </div>
        </section>
      )}

      <section className="ma-report-card">
        <h3>Average time in status</h3>
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
          <h3>Team breakdown</h3>
          <div className="ma-analytics-team">
            {data.team.map((row) => (
              <article className="ma-employee-analytics" key={row.user.id}>
                <div className="ma-section-head"><strong>{row.user.displayName}</strong><span className="ma-muted">{ROLE_LABELS[row.user.role]}</span></div>
                <div className="ma-employee-numbers">
                  <span>Done <b>{row.metrics.completed}</b></span>
                  <span>On time <b>{row.metrics.onTimeCompleted}</b></span>
                  <span>Open <b>{row.workload.open}</b></span>
                  <span className={row.workload.overdue ? "danger" : ""}>Overdue <b>{row.workload.overdue}</b></span>
                  <span>Revisions <b>{row.metrics.revisionCount}</b></span>
                  <span>DL changes <b>{row.metrics.deadlineChangeRequests}</b></span>
                  <span>Avg cycle <b>{metricDuration(row.metrics.averageCycleHours)}</b></span>
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
}: {
  taskId: string;
  currentUser: User;
  users: User[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState("");
  const [showBlockInput, setShowBlockInput] = useState(false);
  const [showRevisionInput, setShowRevisionInput] = useState(false);
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
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await apiFetch<TaskDetail>(`/api/tasks/${taskId}`);
    setLoading(false);
    if (data) setDetail(data);
    else setError(friendlyError(e) ?? "Failed to load task");
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
    const { error: e } = await apiFetch<{ task: Task }>(
      `/api/tasks/${taskId}/actions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      }
    );
    setActionPending(false);
    if (e) { setActionError(friendlyError(e)); return false; }
    await load();
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
    await load();
    onRefresh();
  };

  const toggleChecklist = async (itemId: string) => {
    setChecklistPendingId(itemId);
    setActionError(null);
    const { data, error: e } = await apiFetch<{ postingChecklist: PostingChecklist }>(
      `/api/checklist-items/${itemId}/toggle`, { method: "POST" }
    );
    setChecklistPendingId(null);
    if (e) { setActionError(friendlyError(e)); return; }
    if (data?.postingChecklist) {
      setDetail((previous) => previous ? { ...previous, postingChecklist: data.postingChecklist } : previous);
    }
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
  const dlRequests = detail?.deadlineRequests ?? [];
  const assignee = task ? users.find((u) => u.id === task.assigneeId) : null;
  const creator = task ? users.find((u) => u.id === task.creatorId) : null;
  const isAssignee = task?.assigneeId === currentUser.id;
  const isCreator = task?.creatorId === currentUser.id;
  const isHead = currentUser.role === "HEAD_OF_MARKETING";
  const pendingDL = dlRequests.filter((r) => r.status === "PENDING");
  const postingChecklist = detail?.postingChecklist;
  const postingComplete = !postingChecklist || postingChecklist.items.every((item) => item.isCompleted);
  const recurringDefinition = detail?.recurringDefinition;
  const canManageRecurrence = Boolean(task && (isHead || task.creatorId === currentUser.id || recurringDefinition?.createdBy === currentUser.id));

  const actions: { label: string; action: string; variant?: string }[] = [];
  if (task) {
    if (task.status === "ASSIGNED" && isAssignee) actions.push({ label: "Accept", action: "ACCEPT" });
    if (task.status === "IN_PROGRESS" && isAssignee && postingComplete) actions.push({ label: "Submit Review", action: "SUBMIT_REVIEW" });
    if (task.status === "IN_PROGRESS" && isAssignee) actions.push({ label: "Block", action: "_block", variant: "warn" });
    if (task.status === "BLOCKED" && isAssignee) actions.push({ label: "Resume", action: "RESUME" });
    if (task.status === "REVIEW" && (isCreator || isHead)) actions.push({ label: "Approve", action: "APPROVE" });
    if (task.status === "REVIEW" && (isCreator || isHead)) actions.push({ label: "Request Revision", action: "_revision", variant: "warn" });
    if (task.status === "REVISION" && isAssignee && postingComplete) actions.push({ label: "Submit Review", action: "SUBMIT_REVIEW" });
    if (!isTerminal(task.status) && (isCreator || isHead)) actions.push({ label: "Cancel", action: "CANCEL", variant: "danger" });
    if (isTerminal(task.status) && isHead) actions.push({ label: "Reopen", action: "REOPEN" });
  }

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Task detail"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel" ref={panelRef} tabIndex={-1}>
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Close">←</button>
          <span className="ma-panel-title">Task Detail</span>
        </div>

        {loading && <div className="ma-center-inline"><div className="ma-spinner" /></div>}
        {error && <div className="ma-error" role="alert">{error} <button onClick={load}>Retry</button></div>}

        {task && (
          <div className="ma-panel-body">
            <div className="ma-detail-top">
              <span className={`ma-priority p-${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>
              <span className={`ma-status-pill s-${task.status.toLowerCase()}`}>{STATUS_LABELS[task.status]}</span>
            </div>

            <h2 className="ma-detail-title">{task.title}</h2>
            {task.description && <p className="ma-detail-desc">{task.description}</p>}

            <dl className="ma-detail-meta">
              <dt>Assignee</dt><dd>{assignee?.displayName ?? "—"}</dd>
              <dt>Creator</dt><dd>{creator?.displayName ?? "—"}</dd>
              <dt>Deadline</dt><dd>{fmtDateTime(task.deadline)}</dd>
              {task.blockedReason && <><dt>Blocked reason</dt><dd className="ma-overdue-text">{task.blockedReason}</dd></>}
            </dl>

            {postingChecklist && (
              <section className="ma-checklist-card" aria-labelledby="posting-checklist-title">
                <div className="ma-section-head">
                  <div>
                    <h3 id="posting-checklist-title">Posting checklist</h3>
                    <span className="ma-muted">{postingChecklist.items.filter((item) => item.isCompleted).length} / {postingChecklist.items.length} complete</span>
                  </div>
                  {postingComplete && <span className="ma-complete-chip">Complete</span>}
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
                  <p className="ma-muted">Complete all platforms to enable Send to Review.</p>
                )}
              </section>
            )}

            {/* Deadline requests */}
            {pendingDL.length > 0 && (
              <section className="ma-section" aria-labelledby="dl-req-title">
                <h3 id="dl-req-title">Pending Deadline Requests</h3>
                {pendingDL.map((req) => {
                  const requester = users.find((u) => u.id === req.requestedBy);
                  return (
                    <div key={req.id} className="ma-dl-req">
                      <span><strong>{requester?.displayName ?? "Someone"}</strong> → {fmtDateTime(req.requestedDeadline)}</span>
                      <span className="ma-muted">{req.reason}</span>
                      {(isCreator || isHead) && (
                        <div className="ma-dl-actions">
                          <button className="ma-btn primary" disabled={actionPending} onClick={() => resolveDeadline(req.id, true)}>Approve</button>
                          <button className="ma-btn warn" disabled={actionPending} onClick={() => resolveDeadline(req.id, false)}>Reject</button>
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
                <h3>Actions</h3>
                {showBlockInput ? (
                  <div className="ma-block-form">
                    <label htmlFor="block-reason">Reason for blocking</label>
                    <textarea
                      id="block-reason"
                      value={blockReason}
                      onChange={(e) => setBlockReason(e.target.value)}
                      rows={3}
                      placeholder="Describe what's blocking progress…"
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
                        Confirm Block
                      </button>
                      <button className="ma-btn secondary" onClick={() => setShowBlockInput(false)}>Cancel</button>
                    </div>
                  </div>
                ) : showRevisionInput ? (
                  <div className="ma-block-form">
                    <label htmlFor="revision-reason">Revision comment (optional)</label>
                    <textarea
                      id="revision-reason"
                      value={revisionReason}
                      onChange={(event) => setRevisionReason(event.target.value)}
                      rows={3}
                      maxLength={5000}
                      placeholder="Explain what should change…"
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
                        Request Revision
                      </button>
                      <button className="ma-btn secondary" onClick={() => setShowRevisionInput(false)}>Cancel</button>
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
                <h3>Deadline Change</h3>
                {showDLRequest ? (
                  <div className="ma-block-form">
                    <label htmlFor="dl-date">Proposed deadline</label>
                    <input id="dl-date" type="datetime-local" value={dlDate} onChange={(e) => setDlDate(e.target.value)} />
                    <label htmlFor="dl-reason">Reason</label>
                    <textarea id="dl-reason" value={dlReason} onChange={(e) => setDlReason(e.target.value)} rows={2} placeholder="Why do you need more time?" />
                    <div className="ma-form-row">
                      <button className="ma-btn primary" disabled={actionPending || !dlDate || !dlReason.trim()} onClick={requestDeadline}>Submit Request</button>
                      <button className="ma-btn secondary" onClick={() => setShowDLRequest(false)}>Cancel</button>
                    </div>
                    {actionError && <div className="ma-error-inline" role="alert">{actionError}</div>}
                  </div>
                ) : (
                  <button className="ma-btn secondary" onClick={() => setShowDLRequest(true)}>Request deadline change</button>
                )}
              </section>
            )}

            {canManageRecurrence && (
              <section className="ma-section">
                <h3>Recurring task</h3>
                {showRecurrenceForm ? (
                  <div className="ma-block-form">
                    <label htmlFor="recurrence-frequency">Schedule</label>
                    <select id="recurrence-frequency" value={recurrenceFrequency} onChange={(event) => setRecurrenceFrequency(event.target.value as RecurringDefinition["frequency"])}>
                      <option value="WEEKDAYS">Daily — Mon–Fri</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                    {recurrenceFrequency === "WEEKLY" && <>
                      <label htmlFor="recurrence-weekday">Weekday</label>
                      <select id="recurrence-weekday" value={recurrenceWeekday} onChange={(event) => setRecurrenceWeekday(Number(event.target.value))}>
                        {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((label, index) => <option key={label} value={index + 1}>{label}</option>)}
                      </select>
                    </>}
                    {recurrenceFrequency === "MONTHLY" && <>
                      <label htmlFor="recurrence-day">Day of month</label>
                      <input id="recurrence-day" type="number" min="1" max="31" value={recurrenceDay} onChange={(event) => setRecurrenceDay(Number(event.target.value))} />
                      <span className="ma-muted">Shorter months use their last day.</span>
                    </>}
                    <label htmlFor="recurrence-time">Time</label>
                    <input id="recurrence-time" type="time" value={recurrenceTime} onChange={(event) => setRecurrenceTime(event.target.value)} />
                    <label htmlFor="recurrence-end">End date (optional)</label>
                    <input id="recurrence-end" type="date" value={recurrenceEnd} onChange={(event) => setRecurrenceEnd(event.target.value)} />
                    {detail?.recurringDefinition && (
                      <>
                        <label htmlFor="recurrence-assignee">Assignee</label>
                        <select id="recurrence-assignee" value={recurrenceAssigneeId} onChange={(event) => setRecurrenceAssigneeId(event.target.value)}>
                          {users.filter((u) => u.isActive).map((u) => (
                            <option key={u.id} value={u.id}>{u.displayName}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <div className="ma-form-row">
                      <button className="ma-btn primary" disabled={actionPending || !recurrenceTime} onClick={saveRecurrence}>Save future schedule</button>
                      <button className="ma-btn secondary" onClick={() => setShowRecurrenceForm(false)}>Cancel</button>
                    </div>
                  </div>
                ) : recurringDefinition ? (
                  <div className="ma-recurrence-card">
                    <div><strong>{recurringDefinition.frequency === "WEEKDAYS" ? "Every weekday" : recurringDefinition.frequency === "WEEKLY" ? `Every ${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(recurringDefinition.weekday ?? 1) - 1]}` : `Every month on day ${recurringDefinition.dayOfMonth}`}</strong><span> at {recurringDefinition.localTime}</span></div>
                    <span className={`ma-recurrence-status ${recurringDefinition.status.toLowerCase()}`}>{recurringDefinition.status}</span>
                    {recurringDefinition.status === "PAUSED" && recurringDefinition.pauseReason === "ASSIGNEE_DEACTIVATED" && (
                      <span className="ma-muted">Paused automatically — the assignee was removed from the team. Change the assignee, then Resume.</span>
                    )}
                    {recurringDefinition.nextOccurrenceAt && <span className="ma-muted">Next: {fmtDateTime(recurringDefinition.nextOccurrenceAt)}</span>}
                    {recurringDefinition.status !== "STOPPED" && <div className="ma-action-row">
                      <button className="ma-btn secondary" disabled={actionPending} onClick={openRecurrenceForm}>Edit future</button>
                      <button className="ma-btn secondary" disabled={actionPending} onClick={() => recurrenceAction(recurringDefinition.status === "PAUSED" ? "RESUME" : "PAUSE")}>{recurringDefinition.status === "PAUSED" ? "Resume" : "Pause"}</button>
                      <button className="ma-btn danger" disabled={actionPending} onClick={() => recurrenceAction("STOP")}>Stop</button>
                    </div>}
                  </div>
                ) : (
                  <button className="ma-btn secondary" onClick={openRecurrenceForm}>Make recurring</button>
                )}
                {actionError && <div className="ma-error-inline" role="alert">{actionError}</div>}
              </section>
            )}

            {/* Events */}
            {events.length > 0 && (
              <section className="ma-section" aria-labelledby="events-title">
                <h3 id="events-title">Activity</h3>
                <ol className="ma-events">
                  {events.map((ev) => {
                    const actor = ev.actorId ? users.find((u) => u.id === ev.actorId) : null;
                    return (
                      <li key={ev.id} className="ma-event">
                        <span className="ma-event-type">{ev.eventType.replace(/_/g, " ")}</span>
                        <span className="ma-muted"> · {actor?.displayName ?? "System"} · {fmtDateTime(ev.createdAt)}</span>
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

// ─── Quick Add Panel ──────────────────────────────────────────────────────────

function QuickAddPanel({
  currentUser,
  users,
  onClose,
  onCreated,
}: {
  currentUser: User;
  users: User[];
  onClose: () => void;
  onCreated: (notification: AssignmentNotificationResult) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser.id);
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeUsers = users.filter((u) => u.isActive);

  const submit = async () => {
    if (pending || !title.trim() || !assigneeId || !deadline) return;
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
    if (!data) { setError("Task was not created."); return; }
    onCreated(data.notification);
  };

  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Quick add task"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Close">←</button>
          <span className="ma-panel-title">New Task</span>
        </div>
        <div className="ma-panel-body">
          <div className="ma-form-group">
            <label htmlFor="qa-title">Title *</label>
            <input
              id="qa-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              autoFocus
            />
          </div>
          <div className="ma-form-group">
            <label htmlFor="qa-assignee">Assignee *</label>
            <select id="qa-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </select>
          </div>
          <div className="ma-form-group">
            <label htmlFor="qa-deadline">Deadline *</label>
            <input id="qa-deadline" type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
          <details className="ma-more-details">
            <summary>Priority &amp; description</summary>
            <div className="ma-form-group">
              <label htmlFor="qa-priority">Priority</label>
              <select id="qa-priority" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {(["low", "normal", "high"] as Priority[]).map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
            <div className="ma-form-group">
              <label htmlFor="qa-desc">Description</label>
              <textarea
                id="qa-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Optional details…"
              />
            </div>
          </details>
          {error && <div className="ma-error-inline" role="alert">{error}</div>}
          <button className="ma-btn primary full" disabled={pending || !title.trim() || !deadline || !assigneeId} onClick={submit}>
            {pending ? "Creating…" : "Create Task"}
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
      aria-label="Pending users"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Close">←</button>
          <span className="ma-panel-title">Pending Users</span>
        </div>
        <div className="ma-panel-body">
          {users.length === 0 && <p className="ma-muted">No pending users.</p>}
          {users.map((u) => (
            <div key={u.id} className="ma-pending-user">
              <div className="ma-pending-name">{u.displayName}</div>
              <div className="ma-form-row">
                <select
                  aria-label={`Role for ${u.displayName}`}
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
                  {pending[u.id] ? "…" : "Activate"}
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
  onClose,
  onEditRole,
}: {
  user: User;
  onClose: () => void;
  onEditRole: () => void;
}) {
  const canEditOwnRole = user.role !== "HEAD_OF_MARKETING";
  return (
    <div
      className="ma-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Your profile"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Close">←</button>
          <span className="ma-panel-title">Your Profile</span>
        </div>
        <div className="ma-panel-body">
          <dl className="ma-detail-meta">
            <dt>Name</dt><dd>{user.displayName}</dd>
            <dt>Role</dt><dd>{ROLE_LABELS[user.role]}</dd>
            {user.telegramUsername && <><dt>Telegram</dt><dd>@{user.telegramUsername}</dd></>}
          </dl>
          {canEditOwnRole ? (
            <button className="ma-btn secondary full" onClick={onEditRole}>Edit role</button>
          ) : (
            <p className="ma-muted">Head&rsquo;s role can only be changed outside the app.</p>
          )}
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
      aria-label="Edit role"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Close">←</button>
          <span className="ma-panel-title">Edit Role</span>
        </div>
        <div className="ma-panel-body">
          <p className="ma-muted">
            Correcting <strong>{user.displayName}</strong>&rsquo;s role. This takes effect immediately.
          </p>
          <div className="ma-role-options" role="radiogroup" aria-label="Role">
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
              {pending ? "Saving…" : "Save role"}
            </button>
            <button className="ma-btn secondary" onClick={onClose} disabled={pending}>Cancel</button>
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
        setLoadError(friendlyError(e) ?? "Failed to load this teammate's task summary.");
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
      aria-label="Remove from team"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ma-panel">
        <div className="ma-panel-header">
          <button className="ma-back-btn" onClick={onClose} aria-label="Close">←</button>
          <span className="ma-panel-title">Remove from Team</span>
        </div>
        <div className="ma-panel-body">
          {loading && <div className="ma-center-inline"><div className="ma-spinner" /></div>}
          {loadError && <div className="ma-error" role="alert">{loadError}</div>}
          {preview && (
            <>
              <p className="ma-detail-desc">Remove <strong>{user.displayName}</strong> from active team?</p>
              <ul className="ma-fact-list">
                <li>{openCount} active task{openCount === 1 ? "" : "s"}</li>
                <li>{preview.historicalTaskCount} historical task{preview.historicalTaskCount === 1 ? "" : "s"}</li>
                {preview.activeRecurringCount > 0 && (
                  <li>{preview.activeRecurringCount} recurring definition{preview.activeRecurringCount === 1 ? "" : "s"} will pause</li>
                )}
              </ul>
              <p className="ma-muted">They will:</p>
              <ul className="ma-fact-list muted">
                <li>stop receiving new tasks and bot notifications</li>
                <li>lose active Mini App access</li>
                <li>remain in historical task records</li>
              </ul>

              {openCount > 0 && (
                <>
                  <h3>What happens to their {openCount} open task{openCount === 1 ? "" : "s"}?</h3>
                  <div className="ma-role-options" role="radiogroup" aria-label="Open task handling">
                    <button type="button" role="radio" aria-checked={action === "REASSIGN"}
                      className={`ma-role-option${action === "REASSIGN" ? " active" : ""}`}
                      onClick={() => setAction("REASSIGN")}>
                      Reassign to another teammate
                    </button>
                    <button type="button" role="radio" aria-checked={action === "CANCEL"}
                      className={`ma-role-option${action === "CANCEL" ? " active" : ""}`}
                      onClick={() => setAction("CANCEL")}>
                      Cancel these tasks
                    </button>
                    <button type="button" role="radio" aria-checked={action === "KEEP"}
                      className={`ma-role-option${action === "KEEP" ? " active" : ""}`}
                      onClick={() => setAction("KEEP")}>
                      Keep as-is for now
                    </button>
                  </div>
                  {action === "REASSIGN" && (
                    <div className="ma-form-group">
                      <label htmlFor="reassign-to">Reassign to</label>
                      <select id="reassign-to" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                        <option value="">Choose a teammate…</option>
                        {reassignCandidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.displayName}</option>
                        ))}
                      </select>
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
                  {pending ? "Removing…" : "Remove from team"}
                </button>
                <button className="ma-btn secondary" onClick={onClose} disabled={pending}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
