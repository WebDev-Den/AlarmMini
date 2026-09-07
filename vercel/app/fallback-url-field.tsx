"use client";
import { useEffect, useRef, useState } from "react";
import { verifyFallbackEndpoint } from "./fallback-settings";

export function FallbackUrlField({ id, value, onChange, token, onTokenChange, disabled = false }: {
  id: string; value: string; onChange: (value: string) => void; token: string; onTokenChange: (value: string) => void; disabled?: boolean;
}) {
  const [result, setResult] = useState<{ kind: "idle" | "checking" | "success" | "error"; message: string }>({ kind: "idle", message: "" });
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setResult({ kind: "idle", message: "" });
    return () => pending.current?.abort();
  }, [value, token]);
  async function check() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setResult({ kind: "checking", message: "Перевіряємо доступність і 25 станів областей…" });
    try {
      await verifyFallbackEndpoint(value, token, controller.signal);
      if (!controller.signal.aborted) setResult({ kind: "success", message: "Перевірено: HTTP 200, усі 25 значень — 0 або 1. URL можна записати в плату." });
    } catch (error) {
      if (!controller.signal.aborted) setResult({ kind: "error", message: error instanceof Error ? error.message : "Не вдалося перевірити URL. Повтори спробу." });
    }
  }
  return <div className="fallback-field">
    <label htmlFor={id}>Резервний URL<input id={id} name={id} type="url" autoComplete="off" spellCheck={false} placeholder="https://example.com/alerts.json" value={value} disabled={disabled} aria-describedby={`${id}-result ${id}-help`} aria-invalid={result.kind === "error"} onChange={(event) => {
      pending.current?.abort(); setResult({ kind: "idle", message: "" }); onChange(event.target.value);
    }} /></label>
    <label htmlFor={`${id}-token`}>Токен авторизації (необов’язково)<input id={`${id}-token`} name={`${id}-token`} type="password" autoComplete="new-password" spellCheck={false} maxLength={511} value={token} disabled={disabled} aria-describedby={`${id}-token-help`} onChange={(event) => {
      pending.current?.abort(); setResult({ kind: "idle", message: "" }); onTokenChange(event.target.value);
    }} /></label>
    <p id={`${id}-token-help`} className="hint">Лише токен, без «Bearer». Передаємо в Authorization: Bearer …; для захисту токена використовуй HTTPS. Потрібна прошивка 2.0.9 або новіша.</p>
    <button type="button" className="btn" disabled={disabled || !value.trim() || result.kind === "checking"} onClick={() => void check()}>{result.kind === "checking" ? "Перевіряємо URL…" : "Перевірити URL"}</button>
    <p id={`${id}-result`} className={`fallback-check ${result.kind}`} role="status" aria-live="polite">{result.message}</p>
    <p id={`${id}-help`} className="hint">Перед записом перевіримо URL ще раз. Перевірка виконується з сервера сайту; доступність із мережі плати може відрізнятися.</p>
  </div>;
}
