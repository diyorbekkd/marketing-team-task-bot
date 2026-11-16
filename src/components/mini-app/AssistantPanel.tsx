"use client";

import { useEffect, useRef, useState } from "react";

type Turn = { id: string; userText: string; answerText: string | null; status: string };
const suggestions = ["Bugun nimadan boshlay?", "Kechikayotgan ishlarimni tartibla", "Vazifamni kichik qadamlarga bo‘l"];

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [available, setAvailable] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    void fetch("/api/assistant", { credentials: "same-origin" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Suhbatni yuklab bo‘lmadi.");
        if (mounted) { setTurns(data.turns); setAvailable(data.available); }
      })
      .catch((e) => { if (mounted) setError(e instanceof Error ? e.message : "Suhbatni yuklab bo‘lmadi."); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const requestKey = crypto.randomUUID();
    setInput(""); setError(null); setBusy(true);
    setTurns((current) => [...current, { id: requestKey, userText: question, answerText: null, status: "PENDING" }]);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestKey, text: question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Javob olinmadi.");
      setTurns((current) => current.map((turn) => turn.id === requestKey
        ? { ...turn, id: data.turnId, answerText: data.answer, status: data.status } : turn));
    } catch (e) {
      setTurns((current) => current.filter((turn) => turn.id !== requestKey));
      setInput(question);
      setError(e instanceof Error ? e.message : "Javob olinmadi. Qayta urinib ko‘ring.");
    } finally { setBusy(false); }
  }

  return <div className="ma-overlay" role="dialog" aria-modal="true" aria-label="AI yordamchi" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ma-panel ma-assistant-panel">
      <div className="ma-panel-header"><button className="ma-back-btn" onClick={onClose} aria-label="Yopish">←</button><span className="ma-panel-title">✦ Ish yordamchisi</span></div>
      <div className="ma-assistant-messages">
        <div className="ma-assistant-intro">Salom! Vazifalarni birga tartiblaymiz. Reja tuzish, ishni qismlarga bo‘lish yoki SOP haqida savol bering.</div>
        {!available && <div className="ma-notice warning">AI yordamchi hali serverda ulanmagan. Rahbar AI Gateway hisobini faollashtirishi kerak.</div>}
        {turns.map((turn) => <div key={turn.id} className="ma-assistant-turn">
          <div className="ma-assistant-user">{turn.userText}</div>
          <div className="ma-assistant-reply">{turn.answerText ?? "O‘ylayapman…"}</div>
        </div>)}
        <div ref={endRef} />
      </div>
      {turns.length === 0 && <div className="ma-assistant-suggestions">{suggestions.map((s) => <button key={s} disabled={busy || !available} onClick={() => void send(s)}>{s}</button>)}</div>}
      <form className="ma-assistant-form" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
        {error && <p role="alert" className="ma-assistant-error">{error}</p>}
        <label className="ma-sr-only" htmlFor="ma-assistant-input">Yordamchiga savol</label>
        <textarea id="ma-assistant-input" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Nimaga yordam beray?" rows={2} maxLength={3000} disabled={busy || !available} />
        <button type="submit" disabled={busy || !available || !input.trim()}>{busy ? "Kuting…" : "Yuborish"}</button>
      </form>
    </div>
  </div>;
}
