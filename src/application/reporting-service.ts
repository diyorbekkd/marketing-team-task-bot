import type { MarketingRepository } from "./ports/marketing-repository";
import type { ReportDispatcher } from "./ports/report-dispatcher";
import type { DeadlineChangeRequest, Task, TaskEvent, User } from "@/domain/models";
import {
  activeUsers,
  formatTaskTime,
  isOpenTask,
  tashkentDateKey,
  tashkentDayRange,
  tashkentWeekRange,
  weeklyMetrics,
  workloadMetrics,
} from "@/domain/reporting";

export type ScheduledReportType = "DAILY_MORNING" | "DAILY_EVENING" | "WEEKLY";

function inRange(value: string | null, start: Date, end: Date) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= start.getTime() && time < end.getTime();
}

function importantSection(icon: string, label: string, tasks: Task[], users: User[]) {
  if (!tasks.length) return [];
  const shown = tasks.slice().sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()).slice(0, 3);
  return ["", `${icon} ${label} (${tasks.length})`, ...shown.map((task) => {
    const assignee = users.find((user) => user.id === task.assigneeId);
    return `• ${task.title} — ${assignee?.displayName ?? "—"}`;
  })];
}

function morningEmployee(user: User, tasks: Task[], now: Date) {
  const mine = tasks.filter((task) => task.assigneeId === user.id);
  const counts = workloadMetrics(mine, now);
  const today = tashkentDayRange(now);
  const dueToday = mine.filter((task) => isOpenTask(task) && inRange(task.deadline, today.start, today.end))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  if (!dueToday.length) {
    return ["☀️ Bugungi vazifalaringiz", "", "Bugun muddati tugaydigan vazifa yo‘q.", `Kechikkan: ${counts.overdue}`].join("\n");
  }
  return [
    "☀️ Bugungi vazifalaringiz", "",
    `Bugun muddati tugaydi: ${counts.dueToday}`,
    `Kechikkan: ${counts.overdue}`,
    `Jarayonda: ${counts.inProgress}`,
    `Bloklangan: ${counts.blocked}`,
    "", "Bugun:", "",
    ...dueToday.slice(0, 5).map((task, index) => `${index + 1}. ${task.title} — ${formatTaskTime(task.deadline)}`),
    ...(dueToday.length > 5 ? [`… yana ${dueToday.length - 5} ta`] : []),
  ].join("\n");
}

function morningHead(tasks: Task[], users: User[], now: Date) {
  const counts = workloadMetrics(tasks, now);
  const open = tasks.filter(isOpenTask);
  const lines = [
    "☀️ Marketing — Bugun", "",
    `Bugun muddati tugaydi: ${counts.dueToday}`,
    `Kechikkan: ${counts.overdue}`,
    `Bloklangan: ${counts.blocked}`,
    `Tekshiruvda: ${counts.review}`,
    "", "Jamoa:", "",
    ...activeUsers(users).map((user) => {
      const metric = workloadMetrics(tasks, now, user.id);
      return `${user.displayName} — Ochiq ${metric.open} | Bugun ${metric.dueToday} | Kechikkan ${metric.overdue}`;
    }),
  ];
  lines.push(
    ...importantSection("🔴", "Kechikkan", open.filter((task) => new Date(task.deadline) < now), users),
    ...importantSection("🚫", "Bloklangan", open.filter((task) => task.status === "BLOCKED"), users),
    ...importantSection("📝", "Tekshiruvda", open.filter((task) => task.status === "REVIEW"), users),
  );
  return lines.join("\n");
}

function eveningEmployee(user: User, tasks: Task[], events: TaskEvent[], now: Date) {
  const range = tashkentDayRange(now);
  const mine = tasks.filter((task) => task.assigneeId === user.id);
  const taskIds = new Set(mine.map((task) => task.id));
  const completed = mine.filter((task) => inRange(task.completedAt, range.start, now)).length;
  const review = events.filter((event) => taskIds.has(event.taskId) && event.eventType === "REVIEW_REQUESTED"
    && inRange(event.createdAt, range.start, now)).length;
  const counts = workloadMetrics(mine, now);
  const urgent = mine.filter((task) => isOpenTask(task) && (task.priority === "high" || new Date(task.deadline) < now))
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime()).slice(0, 3);
  return [
    "🌙 Bugungi vazifalaringizni tekshiring", "",
    "Qaysilari bajarildi, qaysilari ertaga qoldi? Mini App orqali holatini yangilang.", "",
    `Bajarildi: ${completed}`,
    `Kechikkan: ${counts.overdue}`,
    `Bloklangan: ${counts.blocked}`,
    `Tekshiruvga yuborildi: ${review}`,
    `Keyingi kunga qolgan ochiq vazifa: ${counts.open}`,
    ...(urgent.length ? ["", "Muhim qolganlar:", ...urgent.map((task) => `• ${task.title}`)] : []),
  ].join("\n");
}

function eveningHead(tasks: Task[], events: TaskEvent[], users: User[], now: Date) {
  const range = tashkentDayRange(now);
  const counts = workloadMetrics(tasks, now);
  const created = tasks.filter((task) => inRange(task.createdAt, range.start, now)).length;
  const completed = tasks.filter((task) => inRange(task.completedAt, range.start, now)).length;
  return [
    "🌙 Marketing — Kun yakuni", "",
    `Bugun yaratildi: ${created}`,
    `Bajarildi: ${completed}`,
    `Kechikkan: ${counts.overdue}`,
    `Bloklangan: ${counts.blocked}`,
    `Tekshiruvda: ${counts.review}`,
    `Keyingi kunga qoldi: ${counts.open}`,
    "", "Jamoa:", "",
    ...activeUsers(users).map((user) => {
      const mine = tasks.filter((task) => task.assigneeId === user.id);
      const metric = workloadMetrics(mine, now);
      const done = mine.filter((task) => inRange(task.completedAt, range.start, now)).length;
      return `${user.displayName} — Bajarildi ${done} | Ochiq ${metric.open} | Kechikkan ${metric.overdue}`;
    }),
  ].join("\n");
}

function weeklyEmployee(user: User, tasks: Task[], events: TaskEvent[], requests: DeadlineChangeRequest[], now: Date) {
  const range = tashkentWeekRange(now);
  const metric = weeklyMetrics({ tasks, events, requests, ...range, userId: user.id });
  return [
    "📊 Haftalik natija", "",
    `Yaratildi: ${metric.created}`,
    `Bajarildi: ${metric.completed}`,
    `Vaqtida: ${metric.onTimeCompleted}`,
    `Kechikkan: ${metric.overdue}`,
    `Bloklangan: ${metric.blocked}`,
    `Tuzatishlar: ${metric.revisions}`,
    `Muddat o‘zgarishlari: ${metric.deadlineChanges}`,
    `Keyingi haftaga qoldi: ${metric.carryOver}`,
  ].join("\n");
}

function weeklyHead(tasks: Task[], events: TaskEvent[], requests: DeadlineChangeRequest[], users: User[], now: Date) {
  const range = tashkentWeekRange(now);
  const metric = weeklyMetrics({ tasks, events, requests, ...range });
  return [
    "📊 Marketing — Haftalik natija", "",
    `Yaratildi: ${metric.created}`,
    `Bajarildi: ${metric.completed}`,
    `Reja va natija: ${metric.created} / ${metric.completed}`,
    `Vaqtida: ${metric.onTimeCompleted}`,
    `Kechikkan: ${metric.overdue}`,
    `Hozir kechikkan: ${metric.currentOverdue}`,
    `Bloklangan: ${metric.blocked}`,
    `Tuzatishlar: ${metric.revisions}`,
    `Muddat o‘zgarishlari: ${metric.deadlineChanges}`,
    `Keyingi davrga qoldi: ${metric.carryOver}`,
    "", "Jamoa:", "",
    ...activeUsers(users).map((user) => {
      const personal = weeklyMetrics({ tasks, events, requests, ...range, userId: user.id });
      return `${user.displayName} — Bajarildi ${personal.completed} | Vaqtida ${personal.onTimeCompleted} | Kechikkan ${personal.currentOverdue}`;
    }),
  ].join("\n");
}

export class ReportingService {
  constructor(private readonly repository: MarketingRepository, private readonly dispatcher: ReportDispatcher) {}

  async deliver(type: ScheduledReportType, now = new Date()) {
    const [users, tasks, events, requests] = await Promise.all([
      this.repository.listUsers(), this.repository.listTasks(), this.repository.listAllTaskEvents(),
      this.repository.listDeadlineChangeRequests(),
    ]);
    const recipients = activeUsers(users);
    const notOnboarded = users.filter((user) => user.isActive && !recipients.includes(user)).length;
    if (notOnboarded > 0) {
      console.warn(JSON.stringify({ event: "scheduled_report_recipient_not_onboarded", reportType: type, count: notOnboarded }));
    }
    const intervalKey = type === "WEEKLY"
      ? `${tashkentDateKey(tashkentWeekRange(now).start)}_${tashkentDateKey(now)}`
      : tashkentDateKey(now);
    let sent = 0;
    let deduplicated = 0;
    let failed = 0;
    let skipped = 0;

    for (const recipient of recipients) {
      const isHead = recipient.role === "HEAD_OF_MARKETING";
      const scopedTasks = isHead ? tasks : tasks.filter((task) => task.assigneeId === recipient.id);
      const scopedIds = new Set(scopedTasks.map((task) => task.id));
      const day = tashkentDayRange(now);
      const week = tashkentWeekRange(now);
      const hasEveningSignal = scopedTasks.some((task) => isOpenTask(task)
        || inRange(task.createdAt, day.start, now) || inRange(task.completedAt, day.start, now))
        || events.some((event) => scopedIds.has(event.taskId) && inRange(event.createdAt, day.start, now));
      const weekly = weeklyMetrics({ tasks, events, requests, ...week, userId: isHead ? undefined : recipient.id });
      const hasWeeklySignal = Object.values(weekly).some((value) => value > 0);
      if ((type === "DAILY_EVENING" && !hasEveningSignal) || (type === "WEEKLY" && !hasWeeklySignal)) {
        skipped += 1;
        continue;
      }
      const text = type === "DAILY_MORNING"
        ? isHead ? morningHead(tasks, users, now) : morningEmployee(recipient, tasks, now)
        : type === "DAILY_EVENING"
          ? isHead ? eveningHead(tasks, events, users, now) : eveningEmployee(recipient, tasks, events, now)
          : isHead ? weeklyHead(tasks, events, requests, users, now) : weeklyEmployee(recipient, tasks, events, requests, now);
      const claimed = await this.repository.claimReportDelivery({ reportType: type, intervalKey, recipientUserId: recipient.id });
      if (!claimed) { deduplicated += 1; continue; }
      try {
        await this.dispatcher.sendReport(recipient, text, `report:${type}:${intervalKey}:${recipient.id}`);
        await this.repository.completeReportDelivery({ reportType: type, intervalKey, recipientUserId: recipient.id, status: "SENT" });
        sent += 1;
      } catch {
        await this.repository.completeReportDelivery({
          reportType: type, intervalKey, recipientUserId: recipient.id, status: "FAILED", failureReason: "DELIVERY_FAILED",
        });
        console.warn(JSON.stringify({ event: "scheduled_report_delivery_failed", reportType: type, recipientUserId: recipient.id }));
        failed += 1;
      }
    }
    return { recipients: recipients.length, sent, deduplicated, failed, skipped };
  }
}
