export type DayPlanGroup = "today" | "important_urgent" | "important_later" | "urgent_other" | "later_other" | "unclassified";

export interface DayPlanTask {
  id: string;
  title: string;
  assigneeId: string;
  status: string;
  deadline: string;
}

export interface DayPlanEntry {
  taskId: string;
  plannedOn: string | null;
  isImportant: boolean | null;
  urgentOverride: boolean | null;
}

export function groupPlannedTasks<T extends DayPlanTask>(
  tasks: readonly T[], plans: readonly DayPlanEntry[], userId: string, now: Date,
): Record<DayPlanGroup, T[]> {
  const today = new Date(now.getTime() + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const byTask = new Map(plans.map((plan) => [plan.taskId, plan]));
  const result: Record<DayPlanGroup, T[]> = {
    today: [], important_urgent: [], important_later: [], urgent_other: [], later_other: [], unclassified: [],
  };
  for (const task of tasks) {
    if (task.assigneeId !== userId || task.status === "DONE" || task.status === "CANCELLED") continue;
    const plan = byTask.get(task.id);
    if (plan?.plannedOn !== today) continue;
    result.today.push(task);
    if (plan.isImportant === null) {
      result.unclassified.push(task);
      continue;
    }
    const urgent = plan.urgentOverride ?? new Date(task.deadline).getTime() <= now.getTime() + 48 * 60 * 60 * 1000;
    const group = plan.isImportant
      ? (urgent ? "important_urgent" : "important_later")
      : (urgent ? "urgent_other" : "later_other");
    result[group].push(task);
  }
  return result;
}
