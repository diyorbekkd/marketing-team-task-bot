import { tashkentDateKey } from "./reporting";

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
  isImportant: boolean | null;
  urgentOverride: boolean | null;
}

export interface DayCheckpoint {
  taskId: string;
  title: string;
  dueAt: string | null;
  completedAt: string | null;
}

export interface DayWorkItem<T extends DayPlanTask> {
  task: T;
  checkpoints: DayCheckpoint[];
  deadlineToday: boolean;
}

export function groupTodayWork<T extends DayPlanTask>(
  tasks: readonly T[], plans: readonly DayPlanEntry[], checkpoints: readonly DayCheckpoint[], userId: string, now: Date,
): Record<DayPlanGroup, DayWorkItem<T>[]> {
  const today = tashkentDateKey(now);
  const byTask = new Map(plans.map((plan) => [plan.taskId, plan]));
  const checkpointsByTask = new Map<string, DayCheckpoint[]>();
  for (const checkpoint of checkpoints) {
    if (!checkpoint.dueAt || tashkentDateKey(new Date(checkpoint.dueAt)) !== today) continue;
    const list = checkpointsByTask.get(checkpoint.taskId) ?? [];
    list.push(checkpoint);
    checkpointsByTask.set(checkpoint.taskId, list);
  }
  const result: Record<DayPlanGroup, DayWorkItem<T>[]> = {
    today: [], important_urgent: [], important_later: [], urgent_other: [], later_other: [], unclassified: [],
  };
  for (const task of tasks) {
    if (task.assigneeId !== userId || task.status === "DONE" || task.status === "CANCELLED") continue;
    const taskCheckpoints = checkpointsByTask.get(task.id) ?? [];
    const deadlineToday = tashkentDateKey(new Date(task.deadline)) === today;
    if (!deadlineToday && taskCheckpoints.length === 0) continue;
    const item = { task, checkpoints: taskCheckpoints, deadlineToday };
    result.today.push(item);
    const plan = byTask.get(task.id);
    if (plan?.isImportant == null) {
      result.unclassified.push(item);
      continue;
    }
    const urgent = plan.urgentOverride ?? new Date(task.deadline).getTime() <= now.getTime() + 48 * 60 * 60 * 1000;
    const group = plan.isImportant
      ? (urgent ? "important_urgent" : "important_later")
      : (urgent ? "urgent_other" : "later_other");
    result[group].push(item);
  }
  return result;
}
