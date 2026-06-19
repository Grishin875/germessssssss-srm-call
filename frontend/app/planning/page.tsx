"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Badge, PriorityBadge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SkeletonCards } from "../../components/ui/Skeleton";
import { api, Order } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { exportToExcel, Row as ExcelRow } from "../../lib/excel";
import { toast } from "../../components/ui/Toast";

const ACTIVE_STATUSES =
  "Создан,Назначен,В работе,Доработка,Ожидает компонентов,На проверке ОТК,Готов к проверке ОТК,Передан на ОТК,Готов к отгрузке";

const TERMINAL = ["Завершен", "Завершён", "Выполнен", "Отгружено", "отгружено", "Отменен", "Отменён", "Отменена"];

type BucketKey = "overdue" | "today" | "tomorrow" | "week" | "next_week" | "later" | "none";

const BUCKETS: { key: BucketKey; label: string; accent: string }[] = [
  { key: "overdue",   label: "Просрочено",     accent: "#dc2626" },
  { key: "today",     label: "Сегодня",        accent: "#d97706" },
  { key: "tomorrow",  label: "Завтра",         accent: "#ca8a04" },
  { key: "week",      label: "На этой неделе", accent: "#2563eb" },
  { key: "next_week", label: "След. неделя",   accent: "#0891b2" },
  { key: "later",     label: "Позже",          accent: "#64748b" },
  { key: "none",      label: "Без срока",      accent: "#94a3b8" },
];

function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function bucketOf(o: Order, now: Date): BucketKey {
  if (!o.deadline) return "none";
  const dl = startOfDay(new Date(o.deadline));
  if (isNaN(dl.getTime())) return "none";
  const today = startOfDay(now);
  const day = 86400000;
  const diff = Math.round((dl.getTime() - today.getTime()) / day);
  const isTerminal = TERMINAL.includes(o.status);
  if (diff < 0) return isTerminal ? "later" : "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  // конец текущей недели (вс): дней до воскресенья
  const dow = (today.getDay() + 6) % 7; // 0=пн … 6=вс
  const daysToSunday = 6 - dow;
  if (diff <= daysToSunday) return "week";
  if (diff <= daysToSunday + 7) return "next_week";
  return "later";
}

function pct(o: Order): number | null {
  return o.stages_total ? Math.round(((o.stages_done || 0) / o.stages_total) * 100) : null;
}

// «Под угрозой»: срок ≤ 2 дней, не терминальный, прогресс < 60%
function atRisk(o: Order, now: Date): boolean {
  if (!o.deadline || TERMINAL.includes(o.status)) return false;
  const diff = Math.round((startOfDay(new Date(o.deadline)).getTime() - startOfDay(now).getTime()) / 86400000);
  if (diff < 0 || diff > 2) return false;
  const p = pct(o);
  return p == null ? true : p < 60;
}

export default function PlanningPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [prioFilter, setPrioFilter] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const load = useCallback(() => {
    if (!user) return;
    api.getOrders(undefined, undefined, ACTIVE_STATUSES)
      .then((r) => { setOrders(r); setNow(new Date()); })
      .catch(console.error)
      .finally(() => setFetching(false));
  }, [user]);

  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 60000, !!user);

  const departments = useMemo(
    () => Array.from(new Set(orders.map((o) => o.assigned_department).filter(Boolean))) as string[],
    [orders]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) =>
      (!q || o.product_name.toLowerCase().includes(q) || String(o.id).includes(q)) &&
      (!deptFilter || o.assigned_department === deptFilter) &&
      (!prioFilter || o.priority === prioFilter)
    );
  }, [orders, search, deptFilter, prioFilter]);

  const grouped = useMemo(() => {
    const ref = now ?? new Date();
    const map: Record<BucketKey, Order[]> = {
      overdue: [], today: [], tomorrow: [], week: [], next_week: [], later: [], none: [],
    };
    for (const o of filtered) map[bucketOf(o, ref)].push(o);
    const prioRank: Record<string, number> = { "Срочный": 0, "Высокий": 1, "Обычный": 2, "Низкий": 3 };
    for (const k of Object.keys(map) as BucketKey[]) {
      map[k].sort((a, b) => {
        const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        if (da !== db) return da - db;
        return (prioRank[a.priority] ?? 9) - (prioRank[b.priority] ?? 9);
      });
    }
    return map;
  }, [filtered, now]);

  const stats = useMemo(() => {
    const ref = now ?? new Date();
    return {
      active: filtered.length,
      overdue: grouped.overdue.length,
      today: grouped.today.length,
      risk: filtered.filter((o) => atRisk(o, ref)).length,
      none: grouped.none.length,
    };
  }, [filtered, grouped, now]);

  function exportBoard() {
    const refNow = now ?? new Date();
    const bucketLabel = (k: BucketKey) => BUCKETS.find((b) => b.key === k)?.label ?? k;
    const rows: ExcelRow[] = filtered
      .slice()
      .sort((a, b) => {
        const da = a.deadline ? new Date(a.deadline).getTime() : Infinity;
        const db = b.deadline ? new Date(b.deadline).getTime() : Infinity;
        return da - db;
      })
      .map((o) => {
        const daysLeft = o.deadline
          ? Math.round((startOfDay(new Date(o.deadline)).getTime() - startOfDay(refNow).getTime()) / 86400000)
          : null;
        const p = pct(o);
        return {
          "ID": o.id,
          "Изделие": o.product_name,
          "Кол-во": o.planned_qty,
          "Приоритет": o.priority,
          "Отдел": o.assigned_department || "—",
          "Статус": o.status,
          "Срок": o.deadline ? new Date(o.deadline).toLocaleDateString("ru") : "—",
          "Осталось дней": daysLeft == null ? "—" : daysLeft,
          "Группа": bucketLabel(bucketOf(o, refNow)),
          "Прогресс, %": p == null ? "—" : p,
          "Под угрозой": atRisk(o, refNow) ? "да" : "",
        };
      });
    if (rows.length === 0) { toast.info("Нет заказов для выгрузки"); return; }
    exportToExcel(rows, "План_по_срокам", "Планирование").then(() => toast.success("План выгружен в Excel"));
  }

  if (loading || !user) return null;
  if (!hasPermission("orders.view")) {
    return (
      <AppLayout>
        <EmptyState icon="🔒" title="Нет доступа" description="У вас нет прав на просмотр заказов." />
      </AppLayout>
    );
  }

  const ref = now ?? new Date();

  return (
    <AppLayout>
      <div style={{ marginBottom: 18 }}>
        <h1>Планирование</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 6 }}>
          Загрузка по срокам и контроль дедлайнов производства
        </p>
      </div>

      {/* KPI */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 18 }}>
        {[
          { label: "Активных заказов", value: stats.active, color: "var(--text)" },
          { label: "Просрочено", value: stats.overdue, color: stats.overdue ? "#dc2626" : "var(--text)" },
          { label: "Срок сегодня", value: stats.today, color: stats.today ? "#d97706" : "var(--text)" },
          { label: "Под угрозой", value: stats.risk, color: stats.risk ? "#dc2626" : "var(--text)" },
          { label: "Без срока", value: stats.none, color: stats.none ? "#d97706" : "var(--text)" },
        ].map((k) => (
          <div key={k.label} className="glass" style={{ borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: k.color, fontFamily: "var(--font-display)", fontVariantNumeric: "tabular-nums" }}>{k.value}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 7 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2" style={{ alignItems: "center", marginBottom: 16 }}>
        <input
          placeholder="Поиск по заказу или изделию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">Все отделы</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={prioFilter} onChange={(e) => setPrioFilter(e.target.value)} style={{ maxWidth: 160 }}>
          <option value="">Любой приоритет</option>
          {["Срочный", "Высокий", "Обычный", "Низкий"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {(search || deptFilter || prioFilter) && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setDeptFilter(""); setPrioFilter(""); }}>Сбросить</Button>
        )}
        <Button variant="ghost" size="sm" style={{ marginLeft: "auto" }} disabled={fetching || filtered.length === 0} onClick={exportBoard}>⬇ Excel</Button>
        <Button variant="secondary" size="sm" onClick={() => router.push("/orders")}>Все заказы →</Button>
      </div>

      {/* Board */}
      {fetching ? (
        <SkeletonCards count={6} />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🗓️" title="Нет активных заказов"
          description="Когда появятся заказы со сроками, они выстроятся здесь по дедлайнам."
          action={hasPermission("orders.create") ? <Button onClick={() => router.push("/orders")}>К заказам</Button> : undefined}
        />
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8, alignItems: "flex-start" }}>
          {BUCKETS.map((b) => {
            const list = grouped[b.key];
            return (
              <div key={b.key} style={{ flex: "0 0 264px", width: 264, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 2px 0" }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: b.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", textTransform: "uppercase", letterSpacing: "0.03em" }}>{b.label}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", background: "var(--bg-tertiary)", borderRadius: 6, padding: "1px 8px", minWidth: 22, textAlign: "center" }}>{list.length}</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {list.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: "18px 0", border: "1px dashed var(--border)", borderRadius: 10 }}>—</div>
                  ) : list.map((o) => {
                    const p = pct(o);
                    const risk = atRisk(o, ref);
                    return (
                      <button
                        key={o.id}
                        onClick={() => router.push(`/orders/${o.id}`)}
                        className="card-elev glass"
                        style={{
                          textAlign: "left", cursor: "pointer", borderRadius: 10, padding: "11px 13px",
                          borderLeft: `3px solid ${b.accent}`, display: "flex", flexDirection: "column", gap: 8, width: "100%",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>#{o.id}</span>
                          {risk && (
                            <span title="Под угрозой срыва срока" style={{ fontSize: 10, fontWeight: 700, color: "#dc2626", background: "var(--danger-light)", borderRadius: 5, padding: "1px 6px" }}>⚠ риск</span>
                          )}
                          <span style={{ marginLeft: "auto" }}><PriorityBadge priority={o.priority} /></span>
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {o.product_name}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                          <span>{o.planned_qty} шт</span>
                          {o.deadline && <span style={{ color: b.key === "overdue" ? "#dc2626" : "var(--text-muted)" }}>· {new Date(o.deadline).toLocaleDateString("ru")}</span>}
                        </div>
                        {p != null && (
                          <div title={`${o.stages_done}/${o.stages_total} этапов`}>
                            <div style={{ height: 5, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                              <div style={{ width: `${p}%`, height: "100%", background: p === 100 ? "#16a34a" : "var(--primary)" }} />
                            </div>
                          </div>
                        )}
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                          <Badge status={o.status} />
                          {o.assigned_department && <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}>{o.assigned_department}</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppLayout>
  );
}
