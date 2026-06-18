"use client";
import { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";

export type ToastKind = "success" | "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  duration: number;
}

// ── Module-level event bus ────────────────────────────────────────────────
// Позволяет вызывать toast.* из любого места (включая не-React код и
// обработчики событий) без проброса контекста. Провайдер подписывается на шину.
type Listener = (t: Omit<ToastItem, "id">) => void;
let _listener: Listener | null = null;
let _queue: Omit<ToastItem, "id">[] = [];

function emit(kind: ToastKind, message: string, duration = 3800) {
  const payload = { kind, message: String(message ?? ""), duration };
  if (_listener) _listener(payload);
  else _queue.push(payload); // провайдер ещё не смонтирован — буферизуем
}

export const toast = {
  success: (m: string, d?: number) => emit("success", m, d),
  error: (m: string, d?: number) => emit("error", m, d ?? 5200),
  warning: (m: string, d?: number) => emit("warning", m, d),
  info: (m: string, d?: number) => emit("info", m, d),
};

const ICONS: Record<ToastKind, string> = {
  success: "✓",
  error: "✕",
  warning: "!",
  info: "i",
};

// ── Provider + viewport ───────────────────────────────────────────────────
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [leaving, setLeaving] = useState<Set<number>>(new Set());
  // Портал монтируем только после гидрации: и на сервере, и при первом
  // клиентском рендере значение одинаково (false), поэтому HTML совпадает.
  // Ветка `typeof window !== "undefined"` давала hydration mismatch → в
  // прод-сборке это фатальный "client-side exception".
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const remove = useCallback((id: number) => {
    setLeaving((s) => new Set(s).add(id));
    setTimeout(() => {
      setItems((list) => list.filter((t) => t.id !== id));
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, 260); // длительность toastOut
  }, []);

  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = Date.now() + Math.floor(performance.now() % 1000) + Math.random();
      const item: ToastItem = { id, ...t };
      setItems((list) => [...list, item].slice(-5)); // не более 5 одновременно
      if (t.duration > 0) setTimeout(() => remove(id), t.duration);
    },
    [remove]
  );

  useEffect(() => {
    _listener = push;
    // сбрасываем буфер, накопленный до монтирования
    if (_queue.length) {
      _queue.forEach(push);
      _queue = [];
    }
    return () => {
      _listener = null;
    };
  }, [push]);

  return (
    <>
      {children}
      {mounted &&
        createPortal(
          <div className="toast-viewport" role="status" aria-live="polite">
            {items.map((t) => (
              <div key={t.id} className={`toast ${t.kind}${leaving.has(t.id) ? " leaving" : ""}`}>
                <span className="toast-icon" aria-hidden>
                  {ICONS[t.kind]}
                </span>
                <div className="toast-body">{t.message}</div>
                <button className="toast-close" onClick={() => remove(t.id)} aria-label="Закрыть">
                  ✕
                </button>
                {t.duration > 0 && (
                  <span className="toast-progress" style={{ animationDuration: `${t.duration}ms` }} />
                )}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// Хук-обёртка для тех, кто предпочитает контекстный стиль.
export function useToast() {
  return toast;
}
