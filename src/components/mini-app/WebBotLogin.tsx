"use client";

import { useEffect, useState } from "react";

interface LoginLink { url: string; expiresAt: number; webhookReady: boolean | null }

export function WebBotLogin() {
  const [link, setLink] = useState<LoginLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const createLink = async () => {
    setCreating(true); setError(null);
    try {
      const response = await fetch("/api/auth/link/start", { method: "POST", credentials: "same-origin" });
      const result = await response.json() as { url?: string; expiresIn?: number; webhookReady?: boolean | null; error?: string };
      if (!response.ok || !result.url || !result.expiresIn) throw new Error(result.error ?? "Havola yaratilmadi.");
      setLink({ url: result.url, expiresAt: Date.now() + result.expiresIn * 1000, webhookReady: result.webhookReady ?? null });
      setWaiting(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Havola yaratilmadi. Qayta urinib ko‘ring.");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!link) return;
    const controller = new AbortController();
    let inFlight = false;
    const check = async () => {
      if (inFlight || controller.signal.aborted) return;
      if (Date.now() >= link.expiresAt) {
        setWaiting(false); setLink(null); setError("Havola muddati tugadi. Yangisini yarating.");
        return;
      }
      inFlight = true;
      try {
        const response = await fetch("/api/auth/link/complete", {
          method: "POST", credentials: "same-origin", signal: controller.signal,
        });
        if (!response.ok) throw new Error("Kirish holatini tekshirib bo‘lmadi.");
        const result = await response.json() as { status: "PENDING" | "EXPIRED" | "SIGNED_IN" };
        setError(null);
        if (result.status === "SIGNED_IN") { window.location.replace("/"); return; }
        if (result.status === "EXPIRED") {
          setWaiting(false); setLink(null); setError("Havola muddati tugadi. Yangisini yarating.");
        }
      } catch {
        if (!controller.signal.aborted) setError("Aloqa uzildi. Qayta tekshiryapmiz…");
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void check(); }, 2500);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [link]);

  return <div className="ma-web-bot-login">
    {!link ? <button className="ma-btn primary ma-web-login" disabled={creating} onClick={createLink}>
      {creating ? "Havola yaratilmoqda…" : "Bot orqali kirish"}
    </button> : <>
      <a className="ma-btn primary ma-web-login" href={link.url} target="_blank" rel="noopener noreferrer">Telegram botni ochish →</a>
      <span className="ma-muted">Botda Start bosing, so‘ng shu sahifaga qayting. Havola 10 daqiqa amal qiladi.</span>
      {link.webhookReady === false && <span className="ma-error-inline" role="alert">Test bot bu Preview serveriga ulanmagan. Botdagi Start javob bermasa, webhook manzilini yangilash kerak.</span>}
      {waiting && <span className="ma-muted" role="status">Bot tasdig‘i kutilmoqda…</span>}
      <button className="ma-link-btn" onClick={createLink} disabled={creating}>Yangi havola yaratish</button>
    </>}
    {error && <span className="ma-error-inline" role="alert">{error}</span>}
  </div>;
}
