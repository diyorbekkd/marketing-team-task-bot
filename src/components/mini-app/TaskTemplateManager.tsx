"use client";

import { useState } from "react";
import { templateDueAt, type TaskTemplate } from "@/domain/task-template";

type Row = { title: string; offsetDays: number; localTime: string };

const webinarRows: Row[] = [
  { title: "Mavzuni aniqlash", offsetDays: -3, localTime: "18:00" },
  { title: "Speakerni aniqlash", offsetDays: -3, localTime: "18:00" },
  { title: "E’lon qilish", offsetDays: -2, localTime: "18:00" },
  { title: "YouTube’ga yuklash", offsetDays: 1, localTime: "18:00" },
];

export function TaskTemplateManager({ templates, onSaved, onClose }: {
  templates: TaskTemplate[]; onSaved: () => void; onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [name, setName] = useState("Webinar");
  const [deadlineOffsetDays, setDeadlineOffsetDays] = useState(1);
  const [deadlineLocalTime, setDeadlineLocalTime] = useState("18:00");
  const [rows, setRows] = useState<Row[]>(webinarRows);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = (template: TaskTemplate) => {
    setSourceId(template.id); setName(template.name);
    setDeadlineOffsetDays(template.deadlineOffsetDays);
    setDeadlineLocalTime(template.deadlineLocalTime);
    setRows(template.checkpoints.map((item) => ({ ...item })));
    setError(null);
  };
  const updateRow = (index: number, patch: Partial<Row>) => setRows((current) => current.map((row, position) =>
    position === index ? { ...row, ...patch } : row));
  const valid = name.trim().length > 0 && Number.isInteger(deadlineOffsetDays)
    && Math.abs(deadlineOffsetDays) <= 365 && !!deadlineLocalTime
    && rows.length > 0 && rows.every((row) => row.title.trim() && Number.isInteger(row.offsetDays)
      && Math.abs(row.offsetDays) <= 365 && !!row.localTime);
  const save = async () => {
    if (!valid || pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch("/api/task-templates", { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          sourceTemplateId: sourceId, name: name.trim(), deadlineOffsetDays,
          deadlineLocalTime, checkpoints: rows.map((row) => ({ ...row, title: row.title.trim() })),
        }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Shablon saqlanmadi.");
      setSourceId(result.id); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Shablon saqlanmadi."); }
    finally { setPending(false); }
  };
  const archive = async () => {
    if (!sourceId || pending) return;
    setPending(true); setError(null);
    try {
      const response = await fetch(`/api/task-templates/${sourceId}`, { method: "DELETE", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Shablon arxivlanmadi.");
      setSourceId(null); setName(""); setRows([{ title: "", offsetDays: 0, localTime: "18:00" }]); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Shablon arxivlanmadi."); }
    finally { setPending(false); }
  };
  return <div className="ma-template-editor">
    <button type="button" className="ma-link-btn" onClick={onClose}>← Vazifaga qaytish</button>
    <h3>Checkpointli vazifa shablonlari</h3>
    <p className="ma-muted">Sanalar tadbir kuniga nisbatan kalendar kunlarda, Toshkent vaqti bilan hisoblanadi. Eski vazifalar shablon tahriridan o‘zgarmaydi.</p>
    <div className="ma-template-list">
      <button type="button" className="ma-btn secondary" onClick={() => {
        setSourceId(null); setName("Webinar"); setDeadlineOffsetDays(1);
        setDeadlineLocalTime("18:00"); setRows(webinarRows); setError(null);
      }}>+ Yangi shablon</button>
      {templates.map((template) => <button type="button" className="ma-btn secondary" key={template.id}
        onClick={() => choose(template)}>{template.name}</button>)}
    </div>
    <label className="ma-form-group">Shablon nomi<input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="ma-template-row">
      <label>Umumiy muddat: kun farqi<input type="number" min={-365} max={365} step={1} value={deadlineOffsetDays}
        onChange={(event) => setDeadlineOffsetDays(Number(event.target.value))} /></label>
      <label>Soat<input type="time" value={deadlineLocalTime} onChange={(event) => setDeadlineLocalTime(event.target.value)} /></label>
    </div>
    <p className="ma-muted">Masalan, +1 — webinar kunidan keyingi kun. Vazifa yaratilayotganda muddatni o‘zgartirish mumkin.</p>
    <h4>Checkpointlar</h4>
    {rows.map((row, index) => <div className="ma-template-row" key={index}>
      <label>Band nomi<input maxLength={200} value={row.title} onChange={(event) => updateRow(index, { title: event.target.value })} /></label>
      <label>Kun farqi<input type="number" min={-365} max={365} step={1} value={row.offsetDays}
        onChange={(event) => updateRow(index, { offsetDays: Number(event.target.value) })} /></label>
      <label>Soat<input type="time" value={row.localTime} onChange={(event) => updateRow(index, { localTime: event.target.value })} /></label>
      <button type="button" className="ma-link-btn" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, position) => position !== index))} aria-label={`${row.title || "Band"}ni o‘chirish`}>×</button>
    </div>)}
    {rows.length < 50 && <button type="button" className="ma-btn secondary" onClick={() => setRows([...rows, { title: "", offsetDays: 0, localTime: "18:00" }])}>+ Band qo‘shish</button>}
    {error && <p className="ma-error" role="alert">{error}</p>}
    <div className="ma-template-actions">
      <button type="button" className="ma-btn primary" disabled={!valid || pending} onClick={save}>{pending ? "Saqlanmoqda…" : sourceId ? "Yangi versiyani saqlash" : "Shablonni saqlash"}</button>
      {sourceId && <button type="button" className="ma-btn secondary" disabled={pending} onClick={archive}>Arxivlash</button>}
    </div>
  </div>;
}

export function templatePreview(template: TaskTemplate, eventOn: string) {
  return {
    deadline: templateDueAt(eventOn, template.deadlineOffsetDays, template.deadlineLocalTime),
    checkpoints: template.checkpoints.map((item) => ({ ...item,
      dueAt: templateDueAt(eventOn, item.offsetDays, item.localTime) })),
  };
}
