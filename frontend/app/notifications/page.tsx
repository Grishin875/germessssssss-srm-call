"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SkeletonTable } from "../../components/ui/Skeleton";
import { api, NotificationItem } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { toast } from "../../components/ui/Toast";

// Иконка и цвет по типу уведомления (мягкая семантика, без неона)
function meta(type: string): { icon: string; color: string } {
  const t = (type || "").toLowerCase();
  if (t.includes("otk") || t.includes("брак") || t.includes("reject") || t.includes("defect")) return { icon: "✕", color: "#dc2626" };
  if (t.includes("ship") || t.includes("отгруз") || t.includes("done") || t.includes("complete") || t.includes("заверш")) return { icon: "✓", color: "#16a34a" };
  if (t.includes("deadline") || t.includes("sla") || t.includes("overdue") || t.includes("срок") || t.includes("warn")) return { icon: "!", color: "#d97706" };
  if (t.includes("comment") || t.includes("chat") || t.includes("mention") || t.includes("коммент")) return { icon: "💬", color: "#2563eb" };
  if (t.includes("assign") || t.includes("назнач") || t.includes("task") || t.includes("задач")) return { icon: "◎", color: "#2563eb" };
  return { icon: "i", color: "var(--primary)" };
}

function dayBucket(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sod = (x: Date) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
  const diff = Math.round((sod(now) - sod(d)) / 86400000);
  if (diff <= 0) return "Сегодня";
  if (diff === 1) return "Вчера";
  if (diff < 7) return "На этой неделе";
  return "Ранее";
}

export default function NotificationsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const load = useCallback(() => {
    if (!user) return;
    api.getNotifications()
      .then((r) => setItems(Array.isArray(r) ? r : []))
      .catch(console.error)
      .finally(() => setFetching(false));
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 30000, !!user);

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items]);
  const shown = useMemo(
    () => (filter === "unread" ? items.filter((n) => !n.is_read) : items),
    [items, filter]
  );

  // Группировка по дням с сохранением порядка
  const groups = useMemo(() => {
    const out: { label: string; rows: NotificationItem[] }[] = [];
    for (const n of shown) {
      const label = dayBucket(n.created_at);
      let g = out.find((x) => x.label === label);
      if (!g) { g = { label, rows: [] }; out.push(g); }
      g.rows.push(n);
    }
    return out;
  }, [shown]);

  async function markAll() {
    setBusy(true);
    try {
      await api.markAllRead();
      setItems((list) => list.map((n) => ({ ...n, is_read: true })));
      toast.success("Все уведомления отмечены прочитанными");
    } catch { toast.error("Не удалось обновить"); }
    setBusy(false);
  }

  async function openOne(n: NotificationItem) {
    if (!n.is_read) {
      api.markNotifRead(n.id).catch(() => {});
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    }
    if (n.link) router.push(n.link);
  }

  if (loading || !user) return null;

  return (
    <AppLayout>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <h1>Уведомления</h1>
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 6 }}>
            {unreadCount > 0 ? `${unreadCount} непрочитанных` : "Все уведомления прочитаны"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" loading={busy} onClick={markAll}>Прочитать все</Button>
        )}
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {([["all", "Все"], ["unread", `Непрочитанные${unreadCount ? ` · ${unreadCount}` : ""}`]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            style={{
              padding: "8px 14px", fontSize: 13, fontWeight: 600, background: "none", border: "none", cursor: "pointer",
              color: filter === k ? "var(--primary)" : "var(--text-secondary)", position: "relative",
            }}
          >
            {label}
            {filter === k && <span style={{ position: "absolute", left: 8, right: 8, bottom: -1, height: 2, background: "var(--primary)", borderRadius: 2 }} />}
          </button>
        ))}
      </div>

      {fetching ? (
        <div className="glass" style={{ borderRadius: 12, padding: 16 }}><SkeletonTable rows={6} cols={2} /></div>
      ) : shown.length === 0 ? (
        <EmptyState icon="🔔" title={filter === "unread" ? "Нет непрочитанных" : "Уведомлений пока нет"}
          description={filter === "unread" ? "Вы всё прочитали — отличная работа." : "Здесь появятся события по заказам, ОТК, срокам и задачам."} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map((g) => (
            <div key={g.label}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8, paddingLeft: 2 }}>{g.label}</div>
              <div className="glass" style={{ borderRadius: 12, overflow: "hidden" }}>
                {g.rows.map((n, i) => {
                  const m = meta(n.type);
                  return (
                    <div
                      key={n.id}
                      onClick={() => openOne(n)}
                      style={{
                        display: "flex", gap: 12, alignItems: "flex-start", padding: "13px 16px",
                        borderTop: i === 0 ? "none" : "1px solid var(--border-light)",
                        cursor: n.link ? "pointer" : "default",
                        background: n.is_read ? "transparent" : "var(--primary-light)",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={(e) => { if (n.link) (e.currentTarget as HTMLElement).style.background = "var(--bg-tertiary)"; }}
                      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = n.is_read ? "transparent" : "var(--primary-light)")}
                    >
                      <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, background: `color-mix(in srgb, ${m.color} 14%, transparent)`, color: m.color }}>
                        {m.icon}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: n.is_read ? 500 : 700, color: "var(--text)" }}>{n.title}</span>
                          {!n.is_read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--primary)", flexShrink: 0 }} />}
                        </div>
                        {n.message && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.4 }}>{n.message}</div>}
                        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 5 }}>
                          {new Date(n.created_at).toLocaleString("ru", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {n.link && <span style={{ color: "var(--primary)", marginLeft: 8 }}>Открыть →</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
