"use client";

import { useEffect, useState } from "react";
import type { PersonalPlan } from "./TaskPlanningPanel";

interface DayTask {
  id: string;
  title: string;
  assigneeId: string;
  status: string;
  deadline: string;
}

function tashkentToday(referenceNow: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(referenceNow));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function MyDayPanel({ tasks, userId, refreshKey, onSelectTask }: {
  tasks: DayTask[];
  userId: string;
  refreshKey: number;
  onSelectTask: (id: string) => void;
}) {
  const [plans, setPlans] = useState<PersonalPlan[]>([]);
  const [error, setError] = useState(false);
  const [referenceNow, setReferenceNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const clock = window.setInterval(() => setReferenceNow(Date.now()), 60_000);
    fetch("/api/plans", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Plans unavailable");
        return response.json() as Promise<{ plans: PersonalPlan[] }>;
      })
      .then((result) => { setPlans(result.plans); setReferenceNow(Date.now()); setError(false); })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => { controller.abort(); window.clearInterval(clock); };
  }, [refreshKey]);

  const planByTask = new Map(plans.map((plan) => [plan.taskId, plan]));
  const myOpenTasks = tasks.filter((task) => task.assigneeId === userId && !["DONE", "CANCELLED"].includes(task.status));
  const today = tashkentToday(referenceNow);
  const selected = myOpenTasks.filter((task) => planByTask.get(task.id)?.plannedOn === today);
  const groups = [
    { important: true, urgent: true, label: "Muhim va shoshilinch" },
    { important: true, urgent: false, label: "Muhim, shoshilinch emas" },
    { important: false, urgent: true, label: "Shoshilinch, muhim emas" },
    { important: false, urgent: false, label: "Muhim ham, shoshilinch ham emas" },
  ];
  const classified = myOpenTasks.flatMap((task) => {
    const plan = planByTask.get(task.id);
    if (plan?.isImportant == null) return [];
    const urgent = plan.urgentOverride ?? new Date(task.deadline).getTime() <= referenceNow + 48 * 60 * 60 * 1000;
    return [{ task, important: plan.isImportant, urgent }];
  });

  return <section className="ma-section ma-my-day" aria-labelledby="my-day-title">
    <h3 id="my-day-title">Mening kunim</h3>
    <p className="ma-muted">Taskni ochib “Reja va progress” bo‘limida bugunga qo‘shing yoki muhimligini belgilang.</p>
    {error && <p className="ma-muted">Shaxsiy reja yuklanmadi. Sahifani yangilab ko‘ring.</p>}
    {selected.length > 0 ? <div className="ma-my-day-list">
      {selected.map((task) => <button key={task.id} onClick={() => onSelectTask(task.id)}>{task.title}</button>)}
    </div> : <p className="ma-muted">Bugunga hali task tanlanmagan.</p>}
    <div className="ma-matrix" aria-label="Muhim va shoshilinch matritsasi">
      {groups.map((group) => {
        const items = classified.filter((item) => item.important === group.important && item.urgent === group.urgent);
        return <div className="ma-matrix-cell" key={group.label}>
          <strong>{group.label}</strong><span>{items.length} ta</span>
          {items.slice(0, 2).map(({ task }) => <button key={task.id} onClick={() => onSelectTask(task.id)}>{task.title}</button>)}
        </div>;
      })}
    </div>
  </section>;
}
