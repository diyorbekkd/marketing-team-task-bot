"use client";

import { useEffect, useState } from "react";
import { groupTodayWork, type DayPlanGroup, type DayPlanTask } from "@/domain/planning";
import type { Checkpoint, PersonalPlan } from "./TaskPlanningPanel";

const GROUPS: Array<{ key: Exclude<DayPlanGroup, "today">; label: string }> = [
  { key: "important_urgent", label: "Muhim va shoshilinch" },
  { key: "important_later", label: "Muhim, shoshilinch emas" },
  { key: "urgent_other", label: "Shoshilinch, muhim emas" },
  { key: "later_other", label: "Muhim ham, shoshilinch ham emas" },
  { key: "unclassified", label: "Muhimligi belgilanmagan" },
];
const checkpointTime = new Intl.DateTimeFormat("uz-UZ", {
  timeZone: "Asia/Tashkent", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

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
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [referenceNow, setReferenceNow] = useState(() => Date.now());
  const [retryKey, setRetryKey] = useState(0);
  const todayKey = new Date(referenceNow + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);

  useEffect(() => {
    const controller = new AbortController();
    const clock = window.setInterval(() => setReferenceNow(Date.now()), 60_000);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch("/api/plans", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Plans unavailable");
        return response.json() as Promise<{ plans: PersonalPlan[]; checkpoints: Checkpoint[] }>;
      })
      .then((result) => { setPlans(result.plans); setCheckpoints(result.checkpoints); setReferenceNow(Date.now()); setError(false); setLoading(false); })
      .catch(() => { if (!controller.signal.aborted) { setReferenceNow(Date.now()); setError(true); setLoading(false); } });
    return () => { controller.abort(); window.clearInterval(clock); };
  }, [refreshKey, todayKey, retryKey]);

  const grouped = groupTodayWork(tasks, plans, checkpoints, userId, new Date(referenceNow));
  const checkpointCount = grouped.today.reduce((sum, item) => sum + item.checkpoints.length, 0);
  const completedCount = grouped.today.reduce((sum, item) => sum + item.checkpoints.filter((checkpoint) => checkpoint.completedAt).length, 0);
  if (view) {
    const title = view === "today" ? "Bugungi ishlar" : GROUPS.find((group) => group.key === view)?.label ?? "Vazifalar";
    return <section className="ma-planning-page" aria-label={title}>
      <button className="ma-planning-back" onClick={onBack}>← Mening kunimga qaytish</button>
      <h1>{title}</h1>
      <p className="ma-muted">{loading ? "Bugungi ishlar yuklanmoqda…" : `${grouped[view].length} ta vazifa · checkpoint, syomka yoki deadline bugun`}</p>
      {error && <p className="ma-error" role="alert">Bugungi ishlar yuklanmadi. <button onClick={() => setRetryKey((value) => value + 1)}>Qayta urinish</button></p>}
      {!loading && !error && <div className="ma-planning-task-list">
        {grouped[view].map((item) => <button key={item.task.id} onClick={() => onSelectTask(item.task.id)}>
          <span className="ma-day-task-copy"><strong>{item.task.title}</strong>
            {item.checkpoints.map((checkpoint, index) => <small key={index} className={checkpoint.completedAt ? "is-done" : ""}>
              {checkpoint.completedAt ? "✓" : "◷"} {checkpoint.title} · {checkpointTime.format(new Date(checkpoint.dueAt!))}
            </small>)}
            {item.deadlineToday && <small>Vazifa muddati bugun</small>}
            {item.shootToday && item.task.shootAt && <small>Syomka · {checkpointTime.format(new Date(item.task.shootAt))}</small>}
          </span><span className="ma-day-task-open">Ochish →</span>
        </button>)}
        {grouped[view].length === 0 && <p className="ma-muted">Bu bo‘limda vazifa yo‘q.</p>}
      </div>}
    </section>;
  }

  return <section className="ma-section ma-my-day" aria-labelledby="my-day-title">
    <h3 id="my-day-title">Mening kunim</h3>
    <p className="ma-muted">Bugungi checkpoint, syomka va muddati bugun tugaydigan vazifalar bir joyda.</p>
    {loading && <p className="ma-muted">Bugungi ishlar yuklanmoqda…</p>}
    {error && <p className="ma-error" role="alert">Bugungi ishlar yuklanmadi. <button onClick={() => setRetryKey((value) => value + 1)}>Qayta urinish</button></p>}
    {!loading && !error && <><button className="ma-day-summary-card" onClick={() => onOpen("today")}>
      <strong>Bugungi ishlar</strong><span>{grouped.today.length} ta vazifa · {checkpointCount} ta checkpoint{completedCount ? ` · ${completedCount} tasi bajarildi` : ""}</span>
      <small>{grouped.today.length ? grouped.today.slice(0, 2).map((item) =>
        `${item.task.title}: ${item.checkpoints[0] ? `${item.checkpoints[0].title} · ${checkpointTime.format(new Date(item.checkpoints[0].dueAt!))}` : item.shootToday && item.task.shootAt ? `syomka · ${checkpointTime.format(new Date(item.task.shootAt))}` : "deadline bugun"}`,
      ).join(" · ") : "Vazifada bugungi checkpoint belgilashingiz mumkin"}</small>
    </button>
    <details className="ma-planning-matrix-disclosure">
      <summary>Muhimlik matritsasi</summary>
      <p className="ma-muted ma-matrix-caption">Bugungi ishlar muhimlik va shoshilinchlik bo‘yicha.</p>
      <div className="ma-matrix" aria-label="Bugungi vazifalar matritsasi">
        {GROUPS.map((group) => <button className="ma-matrix-cell" key={group.key} onClick={() => onOpen(group.key)}>
          <strong>{group.label}</strong><span>{grouped[group.key].length} ta</span>
        </button>)}
      </div>
    </details>
    </>}
  </section>;
}
