"use client";

import { useState } from "react";
import { t } from "@/i18n";

type CalendarMode = "day" | "week" | "month";
type CalendarTaskStatus = keyof typeof t.taskStatus;

interface CalendarTask {
  id: string;
  title: string;
  status: CalendarTaskStatus;
  assigneeId: string;
  deadline: string;
  publicationAt?: string | null;
}

interface CalendarUser {
  id: string;
  displayName: string;
}

interface CalendarViewProps {
  tasks: CalendarTask[];
  users: CalendarUser[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (id: string) => void;
}

const TZ = "Asia/Tashkent";

function dateParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: map.year, month: map.month, day: map.day };
}

function dateKey(value: string | Date): string {
  const parts = dateParts(typeof value === "string" ? new Date(value) : value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function midnight(key: string): Date {
  return new Date(`${key}T00:00:00+05:00`);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("uz-UZ", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function CalendarView({ tasks, users, loading, error, onRetry, onSelect }: CalendarViewProps) {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchorKey, setAnchorKey] = useState(() => dateKey(new Date()));
  const anchor = midnight(anchorKey);
  let start = anchor;
  let dayCount = 1;

  if (mode === "week") {
    const weekdayLabel = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(anchor);
    const weekday = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[weekdayLabel] ?? 1;
    start = new Date(anchor.getTime() - (weekday - 1) * 86_400_000);
    dayCount = 7;
  } else if (mode === "month") {
    const { year, month } = dateParts(anchor);
    start = midnight(`${year}-${month}-01`);
    dayCount = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  }

  const days = Array.from({ length: dayCount }, (_, index) => new Date(start.getTime() + index * 86_400_000));
  const shift = (direction: -1 | 1) => {
    if (mode === "month") {
      const { year, month } = dateParts(anchor);
      const shifted = new Date(Date.UTC(Number(year), Number(month) - 1 + direction, 15, 7));
      setAnchorKey(dateKey(shifted));
      return;
    }
    setAnchorKey(dateKey(new Date(anchor.getTime() + direction * (mode === "week" ? 7 : 1) * 86_400_000)));
  };
  const periodLabel = mode === "month"
    ? new Intl.DateTimeFormat("uz-UZ", { timeZone: TZ, month: "long", year: "numeric" }).format(anchor)
    : days.length === 1
      ? formatDate(days[0].toISOString())
      : `${formatDate(days[0].toISOString())} — ${formatDate(days.at(-1)?.toISOString() ?? days[0].toISOString())}`;
  const entries = tasks.flatMap((task) => [
    { task, date: task.deadline, kind: "deadline" as const },
    ...(task.publicationAt ? [{ task, date: task.publicationAt, kind: "publication" as const }] : []),
  ]);

  return (
    <div className="ma-calendar-view">
      <div className="ma-section-head">
        <div><span className="ma-eyebrow">Marketing kalendari</span><h2>{periodLabel}</h2></div>
        <button className="ma-btn secondary" onClick={() => setAnchorKey(dateKey(new Date()))}>Bugun</button>
      </div>
      <div className="ma-calendar-toolbar">
        <button className="ma-icon-btn" onClick={() => shift(-1)} aria-label="Oldingi davr">←</button>
        <div className="ma-view-toggle" role="group" aria-label="Taqvim ko‘rinishi">
          {(["day", "week", "month"] as const).map((value) => (
            <button key={value} className={`ma-view-btn${mode === value ? " active" : ""}`} onClick={() => setMode(value)}>
              {value === "day" ? "Kun" : value === "week" ? "Hafta" : "Oy"}
            </button>
          ))}
        </div>
        <button className="ma-icon-btn" onClick={() => shift(1)} aria-label="Keyingi davr">→</button>
      </div>
      <div className="ma-calendar-legend">
        <span><i className="deadline" /> Muddat</span>
        <span><i className="publication" /> Publikatsiya</span>
      </div>
      {loading && <div className="ma-center-inline"><div className="ma-spinner" aria-label="Taqvim yuklanmoqda" /></div>}
      {!loading && error && <div className="ma-error" role="alert">{error}<button onClick={onRetry}>Qayta urinish</button></div>}
      {!loading && !error && (
        <div className="ma-calendar-days">
          {days.map((day) => {
            const key = dateKey(day);
            const dayEntries = entries.filter((entry) => dateKey(entry.date) === key)
              .sort((left, right) => left.date.localeCompare(right.date));
            return (
              <section className={`ma-calendar-day${key === dateKey(new Date()) ? " today" : ""}`} key={key}>
                <header><strong>{new Intl.DateTimeFormat("uz-UZ", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(day)}</strong><span>{dayEntries.length || ""}</span></header>
                {dayEntries.length === 0 ? <p className="ma-muted">Reja yo‘q</p> : dayEntries.map((entry) => {
                  const assignee = users.find((user) => user.id === entry.task.assigneeId);
                  return (
                    <button className={`ma-calendar-entry ${entry.kind}`} key={`${entry.kind}-${entry.task.id}`} onClick={() => onSelect(entry.task.id)}>
                      <span>{entry.kind === "deadline" ? "Muddat" : "Publikatsiya"} · {formatTime(entry.date)}</span>
                      <strong>{entry.task.title}</strong>
                      <small>{assignee?.displayName ?? "—"} · {t.taskStatus[entry.task.status]}</small>
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
