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
}

type AssignmentNotificationResult =
  | { status: "SENT" }
  | { status: "FAILED"; reason: "ASSIGNEE_NOT_ONBOARDED" | "DELIVERY_FAILED" };

type Filter = "my" | "today" | "overdue" | "team" | "review" | "blocked";
type BackendScope = "my" | "today" | "overdue" | "team" | "review";
type ViewMode = "list" | "kanban";
type Nav = "home" | "tasks" | "team";

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

  if (authState === "loading") {
    return (
      <div className="ma-center">
        <div className="ma-spinner" aria-label="Loading" />
      </div>
    );
  }

  if (authState === "no-telegram") {
    return (
      <div className="ma-center">
        <div className="ma-no-tg">
          <div className="ma-no-tg-icon" aria-hidden="true">M</div>
          <p>Open this app from Telegram.</p>
          <span className="ma-muted">
            This workspace is only accessible through the Telegram Mini App or a
            signed-in browser session.
          </span>
        </div>
      </div>
    );
  }

  const pendingUsers = users.filter((u) => !u.isActive);
  const visibleTasks = memberFilter && filter === "team"
    ? tasks.filter((t) => t.assigneeId === memberFilter)
    : tasks;
  const memberFilterUser = memberFilter ? users.find((u) => u.id === memberFilter) ?? null : null;

  return (
    <div className="ma-shell">
      <header className="ma-topbar">
        <div className="ma-brand" aria-hidden="true">M</div>
        <div className="ma-topbar-text">
          <span className="ma-eyebrow">Marketing workspace</span>
          <span className="ma-username">{currentUser?.displayName}</span>
        </div>
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
            loading={homeLoading}
            error={homeError}
            onRetry={loadHome}
            onSelectMember={selectMember}
          />
        )}
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
    </div>
  );
}

// ─── Bottom navigation ────────────────────────────────────────────────────────

const NAV_ICONS: Record<Nav, string> = {
  home: "⌂",
  tasks: "≡",
  team: "◉",
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
  limit,
}: {
  tasks: Task[];
  users: User[];
  onSelectMember: (userId: string) => void;
  limit?: number;
}) {
  const rows = workloadFor(tasks, users).slice(0, limit ?? undefined);
  if (rows.length === 0) {
    return <div className="ma-empty">No active team members yet.</div>;
  }
  return (
    <ul className="ma-workload-list">
      {rows.map((row) => (
        <li key={row.user.id}>
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
        </li>
      ))}
    </ul>
  );
}

// ─── Team ─────────────────────────────────────────────────────────────────────

function TeamView({
  tasks,
  users,
  loading,
  error,
  onRetry,
  onSelectMember,
}: {
  tasks: Task[];
  users: User[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelectMember: (userId: string) => void;
}) {
  if (loading && tasks.length === 0) {
    return <div className="ma-center-inline"><div className="ma-spinner" aria-label="Loading" /></div>;
  }
  if (error) {
    return <div className="ma-error" role="alert">{error} <button onClick={onRetry}>Retry</button></div>;
  }
  return (
    <div className="ma-home">
      <div className="ma-greeting">
        <h1>Team workload</h1>
        <p className="ma-muted">Tap a teammate to see their tasks.</p>
      </div>
      <WorkloadList tasks={tasks} users={users} onSelectMember={onSelectMember} />
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

  const task = detail?.task;
  const events = detail?.events ?? [];
  const dlRequests = detail?.deadlineRequests ?? [];
  const assignee = task ? users.find((u) => u.id === task.assigneeId) : null;
  const creator = task ? users.find((u) => u.id === task.creatorId) : null;
  const isAssignee = task?.assigneeId === currentUser.id;
  const isCreator = task?.creatorId === currentUser.id;
  const isHead = currentUser.role === "HEAD_OF_MARKETING";
  const pendingDL = dlRequests.filter((r) => r.status === "PENDING");

  const actions: { label: string; action: string; variant?: string }[] = [];
  if (task) {
    if (task.status === "ASSIGNED" && isAssignee) actions.push({ label: "Accept", action: "ACCEPT" });
    if (task.status === "IN_PROGRESS" && isAssignee) actions.push({ label: "Submit Review", action: "SUBMIT_REVIEW" });
    if (task.status === "IN_PROGRESS" && isAssignee) actions.push({ label: "Block", action: "_block", variant: "warn" });
    if (task.status === "BLOCKED" && isAssignee) actions.push({ label: "Resume", action: "RESUME" });
    if (task.status === "REVIEW" && (isCreator || isHead)) actions.push({ label: "Approve", action: "APPROVE" });
    if (task.status === "REVIEW" && (isCreator || isHead)) actions.push({ label: "Request Revision", action: "_revision", variant: "warn" });
    if (task.status === "REVISION" && isAssignee) actions.push({ label: "Submit Review", action: "SUBMIT_REVIEW" });
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
