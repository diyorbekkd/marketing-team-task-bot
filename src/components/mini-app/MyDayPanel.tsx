"use client";

import { useEffect, useState } from "react";
import { groupPlannedTasks, type DayPlanGroup, type DayPlanTask } from "@/domain/planning";
import type { PersonalPlan } from "./TaskPlanningPanel";

const GROUPS: Array<{ key: Exclude<DayPlanGroup, "today">; label: string }> = [
  { key: "important_urgent", label: "Muhim va shoshilinch" },
  { key: "important_later", label: "Muhim, shoshilinch emas" },
  { key: "urgent_other", label: "Shoshilinch, muhim emas" },
  { key: "later_other", label: "Muhim ham, shoshilinch ham emas" },
  { key: "unclassified", label: "Muhimligi belgilanmagan" },
];

export function MyDayPanel({ tasks, userId, refreshKey, view, onOpen, onBack, onSelectTask }: {
  tasks: DayPlanTask[];
  userId: string;
  refreshKey: number;
  view: DayPlanGroup | null;
  onOpen: (view: DayPlanGroup) => void;
  onBack: () => void;
  onSelectTask: (id: string) => void;
}) {
  const [plans, setPlans] = useState<PersonalPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [referenceNow, setReferenceNow] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const clock = window.setInterval(() => setReferenceNow(Date.now()), 60_000);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/plans", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Plans unavailable");
        return response.json() as Promise<{ plans: PersonalPlan[] }>;
      })
      .then((result) => { setPlans(result.plans); setReferenceNow(Date.now()); setError(false); setLoading(false); })
      .catch(() => { if (!controller.signal.aborted) { setReferenceNow(Date.now()); setError(true); setLoading(false); } });
    return () => { controller.abort(); window.clearInterval(clock); };
  }, [refreshKey]);

  const grouped = groupPlannedTasks(tasks, plans, userId, new Date(referenceNow));
  if (view) {
    const title = view === "today" ? "Bugunga rejalangan" : GROUPS.find((group) => group.key === view)?.label ?? "Vazifalar";
    return <section className="ma-planning-page" aria-label={title}>
      <button className="ma-planning-back" onClick={onBack}>← Mening kunimga qaytish</button>
      <h1>{title}</h1>
      <p className="ma-muted">{loading ? "Reja yuklanmoqda…" : `Bugunga rejalangan vazifalar · ${grouped[view].length} ta`}</p>
      {error && <p className="ma-error" role="alert">Reja yuklanmadi. Sahifani qayta ochib ko‘ring.</p>}
      {!loading && <div className="ma-planning-task-list">
        {grouped[view].map((task) => <button key={task.id} onClick={() => onSelectTask(task.id)}>
          <strong>{task.title}</strong><span>Vazifani ochish →</span>
        </button>)}
        {grouped[view].length === 0 && <p className="ma-muted">Bu bo‘limda vazifa yo‘q.</p>}
      </div>}
    </section>;
  }

  return <section className="ma-section ma-my-day" aria-labelledby="my-day-title">
    <h3 id="my-day-title">Mening kunim</h3>
    <p className="ma-muted">Rejalangan kun — ishlashni tanlagan kuningiz. Deadline — topshirishning oxirgi muddati.</p>
    {loading && <p className="ma-muted">Reja yuklanmoqda…</p>}
    {error && <p className="ma-muted">Shaxsiy reja yuklanmadi. Sahifani yangilab ko‘ring.</p>}
    {!loading && <><button className="ma-day-summary-card" onClick={() => onOpen("today")}>
      <strong>Bugunga rejalangan</strong><span>{grouped.today.length} ta vazifa</span>
      <small>{grouped.today.length ? grouped.today.slice(0, 2).map((task) => task.title).join(" · ") : "Taskni ochib bugunga qo‘shing"}</small>
    </button>
    <p className="ma-muted ma-matrix-caption">Quyidagi kartalar faqat bugunga rejalangan vazifalarni guruhlaydi. Belgilanmaganlar ham alohida ko‘rsatiladi.</p>
    <div className="ma-matrix" aria-label="Bugungi vazifalar matritsasi">
      {GROUPS.map((group) => <button className="ma-matrix-cell" key={group.key} onClick={() => onOpen(group.key)}>
        <strong>{group.label}</strong><span>{grouped[group.key].length} ta</span>
      </button>)}
    </div>
    </>}
  </section>;
}
