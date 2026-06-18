"use client";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { GlobalSearch } from "./GlobalSearch";
import { HotkeysHelp } from "./HotkeysHelp";
import { api, NotificationItem } from "../../lib/api";

function NotificationBell() {
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [notifs, setNotifs] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadCount();
    const t = setInterval(loadCount, 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    api.getNotifications().then(setNotifs).catch(console.error);
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  async function loadCount() {
    try { const r = await api.getUnreadCount(); setCount(r.count); } catch {}
  }

  async function markAll() {
    await api.markAllRead().catch(console.error);
    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
    setCount(0);
  }

  async function markOne(id: number, link?: string) {
    await api.markNotifRead(id).catch(console.error);
    setNotifs(n => n.map(x => x.id === id ? { ...x, is_read: true } : x));
    setCount(c => Math.max(0, c - 1));
    if (link) { setOpen(false); router.push(link); }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{ position: "relative", background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, color: "var(--text-secondary)", display: "flex", alignItems: "center" }}>
        <svg width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {count > 0 && (
          <span style={{ position: "absolute", top: 2, right: 2, background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: "50%", width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="glass" style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: "min(340px, calc(100vw - 24px))", borderRadius: 14, zIndex: 1000, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Уведомления</span>
            {count > 0 && <button onClick={markAll} style={{ fontSize: 12, color: "var(--primary)", background: "none", border: "none", cursor: "pointer" }}>Прочитать все</button>}
          </div>
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {notifs.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Нет уведомлений</div>
            ) : notifs.map(n => (
              <div key={n.id} onClick={() => markOne(n.id, n.link)} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-light)", cursor: n.link ? "pointer" : "default", background: n.is_read ? "transparent" : "var(--primary)08", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: n.is_read ? "transparent" : "#6366f1", marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600, color: "var(--text)" }}>{n.title}</div>
                  {n.message && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{n.message}</div>}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{new Date(n.created_at).toLocaleString("ru")}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex h-screen" style={{ background: "transparent" }}>
      <Sidebar mobileOpen={menuOpen} onClose={() => setMenuOpen(false)} />
      {menuOpen && <div className="sidebar-backdrop mobile-only" onClick={() => setMenuOpen(false)} />}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header
          className="glass"
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 40px", borderRadius: 0, borderLeft: "none", borderRight: "none", borderTop: "none", flexShrink: 0, gap: 8, position: "sticky", top: 0, zIndex: 50 }}
        >
          <button
            className="mobile-only"
            onClick={() => setMenuOpen(true)}
            aria-label="Открыть меню"
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, color: "var(--text-secondary)", alignItems: "center" }}
          >
            <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
            title="Поиск (Ctrl+K)"
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: "7px 12px", cursor: "pointer", color: "var(--text-muted)", fontSize: 13 }}
          >
            <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <span className="desktop-only">Поиск</span>
            <kbd className="desktop-only" style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px" }}>⌘K</kbd>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <NotificationBell />
          </div>
        </header>
        <GlobalSearch />
        <HotkeysHelp />
        <main className="flex-1 overflow-y-auto">
          <div className="ac animate-fadeIn" style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 40px" }}>{children}</div>
        </main>
      </div>
    </div>
  );
}
