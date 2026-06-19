"use client";
import { useEffect, useState } from "react";

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "Ctrl / ⌘ + K", desc: "Глобальный поиск (заказы, страницы)" },
  { keys: "?", desc: "Эта справка по горячим клавишам" },
  { keys: "Esc", desc: "Закрыть окно / поиск / справку" },
  { keys: "Ctrl / ⌘ + Enter", desc: "Отправить комментарий" },
];

export function HotkeysHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (e.key === "?" && !typing) { e.preventDefault(); setOpen(o => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (!open) return null;
  return (
    <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 2100, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="glass pop-in" style={{ width: "min(440px, calc(100vw - 32px))", borderRadius: 14, padding: 24, boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>⌨ Горячие клавиши</h2>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-muted)" }}>×</button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {SHORTCUTS.map(s => (
            <div key={s.keys} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "10px 4px", borderBottom: "1px solid var(--border-light)" }}>
              <span style={{ fontSize: 14 }}>{s.desc}</span>
              <kbd style={{ fontSize: 12, fontWeight: 600, border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", background: "var(--bg-secondary)", whiteSpace: "nowrap" }}>{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
