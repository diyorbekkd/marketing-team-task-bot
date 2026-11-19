"use client";

import { useState } from "react";

export interface PersonalPlan {
  userId: string;
  taskId: string;
  isImportant: boolean | null;
  urgentOverride: boolean | null;
  plannedOn: string | null;
  estimatedMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Checkpoint {
  id: string;
  taskId: string;
  title: string;
  dueAt: string | null;
  position: number;
  createdBy: string;
  completedBy: string | null;
  completedAt: string | null;
  createdAt: string;
}

async function write<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: "same-origin",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Saqlab bo‘lmadi.");
  return result as T;
}

function tashkentDateTime(iso: string) {
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
}

export function TaskPlanningPanel({ taskId, terminal, canEditCheckpoints = true, plan, checkpoints, onPlan, onCheckpoints, onRefreshPlan, onRefreshDetail }: {
  taskId: string;
  terminal: boolean;
  canEditCheckpoints?: boolean;
  plan: PersonalPlan | null;
  checkpoints: Checkpoint[];
  onPlan: (plan: PersonalPlan) => void;
  onCheckpoints: (items: Checkpoint[]) => void;
  onRefreshPlan: () => void;
  onRefreshDetail: () => void;
}) {
  const [important, setImportant] = useState(plan?.isImportant === null || plan?.isImportant === undefined ? "" : String(plan.isImportant));
  const [urgent, setUrgent] = useState(plan?.urgentOverride === null || plan?.urgentOverride === undefined ? "" : String(plan.urgentOverride));
  const [estimate, setEstimate] = useState(plan?.estimatedMinutes?.toString() ?? "");
  const [title, setTitle] = useState("");
  const [dueDateTime, setDueDateTime] = useState("");
  const [pending, setPending] = useState(false);
  const [editingDueId, setEditingDueId] = useState<string | null>(null);
  const [editingDueValue, setEditingDueValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const completed = checkpoints.filter((item) => item.completedAt).length;

  const savePlan = async () => {
    setPending(true); setError(null);
    try {
      const result = await write<{ plan: PersonalPlan }>(`/api/tasks/${taskId}/plan`, "PUT", {
        isImportant: important === "" ? null : important === "true",
        urgentOverride: urgent === "" ? null : urgent === "true",
        plannedOn: null,
        estimatedMinutes: estimate ? Number(estimate) : null,
      });
      onPlan(result.plan);
      onRefreshPlan();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Reja saqlanmadi.");
    } finally { setPending(false); }
  };

  const addCheckpoint = async () => {
    if (!title.trim()) return;
    setPending(true); setError(null);
    try {
      const result = await write<{ checkpoint: Checkpoint }>(`/api/tasks/${taskId}/checkpoints`, "POST", {
        title: title.trim(),
        dueAt: dueDateTime ? `${dueDateTime}${dueDateTime.length === 16 ? ":00" : ""}+05:00` : null,
      });
      onCheckpoints([...checkpoints, result.checkpoint]);
      setTitle(""); setDueDateTime("");
      onRefreshPlan();
      onRefreshDetail();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkpoint qo‘shilmadi.");
    } finally { setPending(false); }
  };

  const toggleCheckpoint = async (id: string) => {
    setPending(true); setError(null);
    const previous = checkpoints;
    onCheckpoints(checkpoints.map((item) => item.id === id
      ? { ...item, completedAt: item.completedAt ? null : new Date().toISOString() }
      : item));
    try {
      const result = await write<{ checkpoint: Checkpoint }>(`/api/checkpoints/${id}`, "POST");
      onCheckpoints(checkpoints.map((item) => item.id === id ? result.checkpoint : item));
      onRefreshPlan();
      onRefreshDetail();
    } catch (cause) {
      onCheckpoints(previous);
      setError(cause instanceof Error ? cause.message : "Checkpoint yangilanmadi.");
    } finally { setPending(false); }
  };

  const removeCheckpoint = async (id: string) => {
    setPending(true); setError(null);
    try {
      await write<{ ok: true }>(`/api/checkpoints/${id}`, "DELETE");
      onCheckpoints(checkpoints.filter((item) => item.id !== id));
      onRefreshPlan();
      onRefreshDetail();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkpoint o‘chirilmadi.");
    } finally { setPending(false); }
  };

  const saveDue = async (id: string) => {
    setPending(true); setError(null);
    try {
      const result = await write<{ checkpoint: Checkpoint }>(`/api/checkpoints/${id}`, "PATCH", {
        dueAt: editingDueValue ? `${editingDueValue}:00+05:00` : null,
      });
      onCheckpoints(checkpoints.map((item) => item.id === id ? result.checkpoint : item));
      setEditingDueId(null); onRefreshPlan(); onRefreshDetail();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Checkpoint vaqti yangilanmadi."); }
    finally { setPending(false); }
  };

  return <section className="ma-section ma-planning" aria-label="Shaxsiy reja va checkpointlar">
    <h3>Reja va progress</h3>
    <p className="ma-muted">Barchasi ixtiyoriy. Shoshilinchlik deadline’dan 48 soat oldin avtomatik taklif qilinadi.</p>
    <div className="ma-planning-grid">
      <label>Muhimlik
        <select value={important} onChange={(event) => setImportant(event.target.value)}>
          <option value="">Belgilanmagan</option><option value="true">Muhim</option><option value="false">Muhim emas</option>
        </select>
      </label>
      <label>Shoshilinchlik
        <select value={urgent} onChange={(event) => setUrgent(event.target.value)}>
          <option value="">Avtomatik (deadlinega 48 soat qolganda)</option>
          <option value="true">Shoshilinch</option><option value="false">Shoshilinch emas</option>
        </select>
      </label>
      <label>Taxminiy vaqt (daqiqa)<input type="number" min="5" max="1440" step="5" value={estimate} onChange={(event) => setEstimate(event.target.value)} /></label>
    </div>
    <button className="ma-btn secondary" disabled={pending} onClick={savePlan}>Rejani saqlash</button>

    <div className="ma-planning-checkpoints">
      <h3>Checkpointlar {checkpoints.length > 0 && <span className="ma-muted">{completed}/{checkpoints.length}</span>}</h3>
      {checkpoints.length > 0 && <progress max={checkpoints.length} value={completed} aria-label="Checkpoint progressi" />}
      {checkpoints.map((item) => <div className="ma-planning-checkpoint" key={item.id}>
        <button type="button" disabled={pending || !canEditCheckpoints} onClick={() => toggleCheckpoint(item.id)}
          aria-label={`${item.title}: ${item.completedAt ? "qayta ochish" : "bajarildi deb belgilash"}`}>
          {item.completedAt ? "☑" : "☐"}
        </button>
        <span className={item.completedAt ? "completed" : ""}>{item.title}
          {item.dueAt && <small className="ma-muted"> · {tashkentDateTime(item.dueAt)}</small>}
        </span>
        {canEditCheckpoints && !terminal && <button type="button" disabled={pending} onClick={() => {
          setEditingDueId(item.id);
          setEditingDueValue(item.dueAt ? new Date(Date.parse(item.dueAt) + 5 * 60 * 60 * 1000).toISOString().slice(0, 16) : "");
        }} aria-label={`${item.title} vaqtini o‘zgartirish`}>✎</button>}
        {canEditCheckpoints && <button type="button" disabled={pending} onClick={() => removeCheckpoint(item.id)} aria-label={`${item.title} checkpointini o‘chirish`}>×</button>}
        {editingDueId === item.id && <div className="ma-template-due-editor">
          <input aria-label="Checkpoint vaqti" type="datetime-local" value={editingDueValue} onChange={(event) => setEditingDueValue(event.target.value)} />
          <button type="button" className="ma-btn secondary" disabled={pending} onClick={() => saveDue(item.id)}>Saqlash</button>
          <button type="button" className="ma-btn secondary" onClick={() => setEditingDueId(null)}>Bekor qilish</button>
        </div>}
      </div>)}
      {!terminal && canEditCheckpoints && checkpoints.length < 50 && <div className="ma-planning-add">
        <textarea aria-label="Yangi checkpoint" placeholder="Natija yoki oraliq maqsad" maxLength={200} rows={2}
          value={title} onChange={(event) => setTitle(event.target.value)}
          onInput={(event) => {
            event.currentTarget.style.height = "auto";
            event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px`;
          }} />
        <input aria-label="Checkpoint sana va vaqti (ixtiyoriy)" type="datetime-local" value={dueDateTime} onChange={(event) => setDueDateTime(event.target.value)} />
        <button className="ma-btn primary ma-checkpoint-add" disabled={pending || !title.trim()} onClick={addCheckpoint}>+ Checkpoint qo‘shish</button>
      </div>}
    </div>
    {error && <p className="ma-error" role="alert">{error}</p>}
  </section>;
}
