"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { StatCard, Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { api, Order, Task, User, MyOrder, OtkBatch, SlaViolation } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { PRODUCTION_ROLES } from "../../lib/roles";
import { DonutChart, BarChart, Sparkline, Slice } from "../../components/ui/Charts";
import { OrdersAnalytics } from "../../lib/api";
import { exportToExcel, Row as ExcelRow } from "../../lib/excel";
import { toast } from "../../components/ui/Toast";
import { useI18n } from "../../lib/i18n";

const IcoOrders = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
  </svg>
);
const IcoWork = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);
const IcoPause = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const IcoOtk = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const IcoTruck = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
  </svg>
);
const IcoDone = () => (
  <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);


const ROLE_TITLES: Record<string, string> = {
  operator_smd: "Рабочее место — СМД",
  "montažnik": "Рабочее место — Монтаж",
  operator_3d: "Рабочее место — 3D Печать",
  operator_engraving: "Рабочее место — Гравировка",
  operator_otk: "Рабочее место — ОТК",
  operator_shipment: "Рабочее место — Отгрузка",
  admin: "Панель руководителя",
  manager: "Панель руководителя",
};

const STAGE_TYPE_LABELS: Record<string, string> = {
  smd: "СМД", assembly: "Сборка", "3d_print": "3D Печать",
  engraving: "Гравировка", warehouse: "Склад", case: "Корпус", otk: "ОТК",
};

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [otkQueue, setOtkQueue] = useState<OtkBatch[]>([]);
  const [readyShip, setReadyShip] = useState<(Order & { batches?: { batch_id: string; remaining_qty: number }[] })[]>([]);
  const [slaViolations, setSlaViolations] = useState<SlaViolation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [analytics, setAnalytics] = useState<OrdersAnalytics | null>(null);
  const [birthdays, setBirthdays] = useState<User[]>([]);
  const [tab, setTab] = useState<"orders" | "tasks">("orders");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState("normal");
  const [busyStage, setBusyStage] = useState<number | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const role = user?.role ?? "";
  const isProduction = (PRODUCTION_ROLES as readonly string[]).includes(role);
  const isOtk = role === "operator_otk";
  const isShipment = role === "operator_shipment";
  const isBoss = role === "admin" || role === "manager";

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const loadData = useCallback(() => {
    if (!user) return;
    if (isProduction) {
      api.getMyOrders().then(setMyOrders).catch(console.error);
    } else if (isOtk) {
      api.getOtkBatches("Принята").then(setOtkQueue).catch(console.error);
    } else if (isShipment) {
      api.getReadyToShip().then((r) => setReadyShip(r as typeof readyShip)).catch(console.error);
    } else {
      api.getOrders(undefined, undefined, "Создан,Назначен,В работе,Доработка,На проверке ОТК,Готов к проверке ОТК,Передан на ОТК,Готов к отгрузке").then(setOrders).catch(console.error);
      api.checkSlaViolations().then(setSlaViolations).catch(console.error);
      if (role === "admin" || role === "manager") {
        api.getOrdersAnalytics().then(setAnalytics).catch(console.error);
      }
    }
    api.getTasks().then(setTasks).catch(console.error);
    api.getBirthdaysToday().then(setBirthdays).catch(console.error);
    setLastUpdate(new Date());
  }, [user, isProduction, isOtk, isShipment]);

  useEffect(() => { loadData(); }, [loadData]);
  useAutoRefresh(loadData, 30000, !!user);

  if (loading || !user) return null;

  const displayOrders = isProduction ? myOrders : orders;
  const myStagesFlat = myOrders.flatMap((o) =>
    (o.my_stages || []).map((s) => ({ ...s, order: o }))
  );
  const stagesPending = myStagesFlat.filter((s) => s.status === "pending");
  const stagesActive = myStagesFlat.filter((s) => s.status === "in_progress");
  const stagesDone = myStagesFlat.filter((s) => s.status === "done");

  const stats = {
    orders: isProduction
      ? stagesPending.length
      : orders.filter((o) => ["Создан", "Назначен"].includes(o.status)).length,
    inWork: isProduction
      ? stagesActive.length
      : orders.filter((o) => ["В работе", "Доработка"].includes(o.status)).length,
    paused: isProduction ? stagesDone.length : orders.filter((o) => o.has_paused_batches).length,
    otk: isProduction ? 0 : orders.filter((o) => ["На проверке ОТК", "Готов к проверке ОТК", "Передан на ОТК", "Готов к отгрузке"].includes(o.status)).length,
  };

  async function addTask() {
    if (!taskTitle.trim()) return;
    try {
      const t = await api.createTask(taskTitle, "", taskPriority);
      setTasks((prev) => [t, ...prev]);
      setTaskTitle("");
    } catch {}
  }

  async function completeTask(id: number) {
    try {
      const t = await api.completeTask(id);
      setTasks((prev) => prev.map((x) => (x.id === id ? t : x)));
    } catch {}
  }

  async function deleteTask(id: number) {
    try {
      await api.deleteTask(id);
      setTasks((prev) => prev.filter((x) => x.id !== id));
    } catch {}
  }

  async function handleStageStart(orderId: number, stageId: number) {
    setBusyStage(stageId);
    try {
      await api.startStage(orderId, stageId);
      const fresh = await api.getMyOrders();
      setMyOrders(fresh);
    } catch {}
    setBusyStage(null);
  }

  async function handleStageComplete(orderId: number, stageId: number) {
    setBusyStage(stageId);
    try {
      await api.completeStage(orderId, stageId);
      const fresh = await api.getMyOrders();
      setMyOrders(fresh);
    } catch {}
    setBusyStage(null);
  }

  const pendingTasks = tasks.filter((x) => x.status === "pending").length;

  // ── Срезы для аналитики (из загруженных активных заказов) ──────────────────
  const STATUS_COLORS: Record<string, string> = {
    "Создан": "#6b7280", "Назначен": "#64748b", "В работе": "#0ea5e9",
    "Доработка": "#ef4444", "На проверке ОТК": "#8b5cf6", "Готов к проверке ОТК": "#a78bfa",
    "Передан на ОТК": "#8b5cf6", "Готов к отгрузке": "#10b981", "Ожидает компонентов": "#f59e0b",
  };
  const PRIORITY_COLORS: Record<string, string> = {
    "Срочный": "#ef4444", "Высокий": "#f59e0b", "Обычный": "#0ea5e9", "Низкий": "#94a3b8",
  };
  const countBy = (arr: Order[], key: (o: Order) => string) =>
    arr.reduce<Record<string, number>>((m, o) => { const k = key(o); m[k] = (m[k] || 0) + 1; return m; }, {});

  const statusSlices: Slice[] = Object.entries(countBy(orders, o => o.status))
    .map(([label, value]) => ({ label, value, color: STATUS_COLORS[label] || "#94a3b8" }))
    .sort((a, b) => b.value - a.value);
  const deptSlices: Slice[] = Object.entries(countBy(orders.filter(o => o.assigned_department), o => o.assigned_department!))
    .map(([label, value]) => ({ label, value, color: "#6366f1" }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
  const prioritySlices: Slice[] = Object.entries(countBy(orders, o => o.priority || "Обычный"))
    .map(([label, value]) => ({ label, value, color: PRIORITY_COLORS[label] || "#94a3b8" }))
    .sort((a, b) => b.value - a.value);

  const firstName = user.full_name?.split(" ")[0] || user.username;
  const todayStr = new Date().toLocaleDateString("ru", { weekday: "long", day: "numeric", month: "long" });
  const reworkOrders = orders.filter((o) => o.status === "Доработка");

  return (
    <AppLayout>
      {/* ── Page header ────────────────────────────── */}
      <div
        style={{
          marginBottom: 22,
          paddingBottom: 18,
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 7 }}>
            {ROLE_TITLES[role] || "Рабочее место"}
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, color: "var(--text)", fontFamily: "var(--font-display)" }}>
            {t("dash.welcome")}, {firstName}
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", marginTop: 6 }}>
            {todayStr.charAt(0).toUpperCase() + todayStr.slice(1)}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)", background: "var(--bg-tertiary)", border: "1px solid var(--border)", padding: "6px 12px", borderRadius: 8 }}>
          <span className="live-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
          Обновлено {lastUpdate ? lastUpdate.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" }) : "—"}
        </div>
      </div>

      {/* ── Birthday banner ────────────────────────── */}
      {birthdays.length > 0 && (
        <div
          style={{
            display: "flex", alignItems: "center", gap: 14, padding: "13px 18px",
            borderRadius: 10, background: "var(--bg-secondary)",
            border: "1px solid var(--border)", marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 20 }}>🎉</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>Сегодня день рождения</p>
            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{birthdays.map((u) => u.full_name || u.username).join(", ")}</p>
          </div>
        </div>
      )}

      {/* ════════ ПРОИЗВОДСТВЕННЫЕ РОЛИ: монтажник / СМД / 3D / гравёр ════════ */}
      {isProduction && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            <StatCard title="Ожидают начала" value={stagesPending.length} icon={<IcoOrders />} accent="#f59e0b" />
            <StatCard title="В работе" value={stagesActive.length} icon={<IcoWork />} accent="#0ea5e9" />
            <StatCard title="Выполнено этапов" value={stagesDone.length} icon={<IcoDone />} accent="#10b981" />
          </div>

          <Card
            title="Мои этапы производства"
            actions={<Button size="sm" variant="secondary" onClick={() => router.push("/my-tasks")}>Все задачи →</Button>}
          >
            {myStagesFlat.filter((s) => s.status !== "done").length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Все этапы выполнены — отличная работа!</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {myStagesFlat
                  .filter((s) => s.status !== "done")
                  .sort((a, b) => (a.status === "in_progress" ? -1 : 1) - (b.status === "in_progress" ? -1 : 1))
                  .slice(0, 10)
                  .map((s) => (
                    <div
                      key={s.id}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                        padding: "12px 16px", borderRadius: 11, flexWrap: "wrap",
                        border: `1px solid ${s.status === "in_progress" ? "#0ea5e950" : "var(--border-light)"}`,
                        background: s.status === "in_progress" ? "#0ea5e90a" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                        <span style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 8px", borderRadius: 5, background: "var(--bg-tertiary)", color: "var(--text-muted)", flexShrink: 0 }}>
                          #{s.order.id}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>
                            {s.stage_name || STAGE_TYPE_LABELS[s.stage_type] || s.stage_type}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                            {s.order.product_name} · {s.order.planned_qty} шт
                            {s.order.deadline && ` · до ${new Date(s.order.deadline).toLocaleDateString("ru")}`}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                        {s.status === "pending" ? (
                          <Button size="sm" loading={busyStage === s.id} onClick={() => handleStageStart(s.order.id, s.id)}>
                            ▶ Начать
                          </Button>
                        ) : (
                          <Button size="sm" variant="success" loading={busyStage === s.id} onClick={() => handleStageComplete(s.order.id, s.id)}>
                            ✓ Завершить
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ════════ ОТК: очередь проверки ════════ */}
      {isOtk && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
            <StatCard title="Партий в очереди" value={otkQueue.length} icon={<IcoOtk />} accent="#8b5cf6" />
            <StatCard title="Изделий на проверку" value={otkQueue.reduce((s, b) => s + (b.released_qty || 0), 0)} icon={<IcoOrders />} accent="#6366f1" />
            <StatCard title="Срочных заказов" value={otkQueue.filter((b) => b.order_id).length} icon={<IcoWork />} accent="#f59e0b" />
          </div>
          <Card
            title="Очередь проверки ОТК"
            actions={<Button size="sm" onClick={() => router.push("/otk")}>Открыть ОТК →</Button>}
          >
            {otkQueue.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Очередь пуста — все партии проверены</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {otkQueue.slice(0, 10).map((b) => (
                  <div
                    key={b.batch_id}
                    onClick={() => router.push("/otk")}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                      padding: "11px 16px", borderRadius: 10, cursor: "pointer",
                      border: "1px solid var(--border-light)", transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-tertiary)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 8px", borderRadius: 5, background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
                        {b.batch_id}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{b.product_name}</span>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{b.production_type}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)" }}>{b.released_qty} шт</span>
                      <Badge status={b.status} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ════════ ОТГРУЗКА: готово к отправке ════════ */}
      {isShipment && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 24 }}>
            <StatCard title="Заказов к отгрузке" value={readyShip.length} icon={<IcoTruck />} accent="#10b981" />
            <StatCard
              title="Партий готово"
              value={readyShip.reduce((s, o) => s + (o.batches?.length || 0), 0)}
              icon={<IcoOrders />} accent="#6366f1"
            />
          </div>
          <Card
            title="Готово к отгрузке"
            actions={<Button size="sm" onClick={() => router.push("/shipment")}>Открыть отгрузку →</Button>}
          >
            {readyShip.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 0" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Нет продукции, ожидающей отгрузки</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {readyShip.slice(0, 10).map((o) => (
                  <div
                    key={o.id}
                    onClick={() => router.push("/shipment")}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                      padding: "11px 16px", borderRadius: 10, cursor: "pointer",
                      border: "1px solid var(--border-light)", transition: "background 0.12s",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-tertiary)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 8px", borderRadius: 5, background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
                        #{o.id}
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{o.product_name}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        партий: {o.batches?.length || 0}
                      </span>
                      <Badge status="Готов к отгрузке" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      {/* ════════ РУКОВОДИТЕЛЬ / ОСТАЛЬНЫЕ РОЛИ ════════ */}
      {!isProduction && !isOtk && !isShipment && (
        <>
          {/* Quick actions */}
          {isBoss && (
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              {[
                { label: "+ Новый заказ", href: "/orders", primary: true },
                { label: "Планирование", href: "/planning" },
                { label: "Производство", href: "/production" },
                { label: "ОТК", href: "/otk" },
                { label: "Отгрузка", href: "/shipment" },
                { label: "Склад", href: "/warehouse" },
              ].map((a) => (
                <button
                  key={a.href + a.label}
                  onClick={() => router.push(a.href)}
                  style={{
                    padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: a.primary ? "none" : "1px solid var(--border)",
                    background: a.primary ? "var(--primary)" : "var(--bg-secondary)",
                    color: a.primary ? "#fff" : "var(--text)",
                    boxShadow: "var(--shadow-sm)", transition: "transform 0.12s, box-shadow 0.12s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = ""; }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}

          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <StatCard title={t("dash.new_orders")} value={stats.orders} icon={<IcoOrders />} accent="#6366f1" />
            <StatCard title={t("dash.in_work")} value={stats.inWork} icon={<IcoWork />} accent="#3b82f6" />
            <StatCard title={t("dash.paused")} value={stats.paused} icon={<IcoPause />} accent="#f59e0b" />
            <StatCard title={t("dash.on_otk")} value={stats.otk} icon={<IcoOtk />} accent="#8b5cf6" />
          </div>

          {/* ── Заголовок аналитики + экспорт отчёта ──────────────────── */}
          {isBoss && analytics && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t("dash.analytics")}</h2>
              <Button size="sm" variant="secondary" onClick={() => {
                if (!analytics) return;
                const k = analytics.kpi;
                const rows: ExcelRow[] = [
                  { "Показатель": "Выполнено сегодня", "Значение": k.completed_today },
                  { "Показатель": "Выполнено за неделю", "Значение": k.completed_week },
                  { "Показатель": "Выполнено за месяц", "Значение": k.completed_month },
                  { "Показатель": "Создано сегодня", "Значение": k.created_today },
                  { "Показатель": "Активных заказов", "Значение": k.active_total },
                  { "Показатель": "Просрочено", "Значение": k.overdue },
                  { "Показатель": "Средний цикл (ч)", "Значение": k.avg_cycle_hours ?? "—" },
                  { "Показатель": "", "Значение": "" },
                  ...analytics.by_status.map(s => ({ "Показатель": `Статус: ${s.label}`, "Значение": s.value })),
                  ...analytics.by_department.map(d => ({ "Показатель": `Отдел: ${d.label}`, "Значение": d.value })),
                ];
                exportToExcel(rows, "Производственный_отчёт", "Отчёт").then(() => toast.success("Отчёт выгружен"));
              }}>⬇ Отчёт в Excel</Button>
            </div>
          )}

          {/* ── KPI производства ──────────────────────────────────────── */}
          {isBoss && analytics && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 16 }}>
              {[
                { label: "Выполнено сегодня", value: analytics.kpi.completed_today, color: "#10b981" },
                { label: "За неделю", value: analytics.kpi.completed_week, color: "#0ea5e9" },
                { label: "За месяц", value: analytics.kpi.completed_month, color: "#6366f1" },
                { label: "Создано сегодня", value: analytics.kpi.created_today, color: "#8b5cf6" },
                { label: "Просрочено", value: analytics.kpi.overdue, color: analytics.kpi.overdue > 0 ? "#ef4444" : "#94a3b8" },
                { label: "Сред. цикл, ч", value: analytics.kpi.avg_cycle_hours ?? "—", color: "#f59e0b" },
              ].map(k => (
                <div key={k.label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{k.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Графики ───────────────────────────────────────────────── */}
          {isBoss && orders.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
              <Card title="Заказы по статусам">
                <DonutChart data={statusSlices} />
              </Card>
              <Card title="Загрузка по отделам">
                {deptSlices.length > 0
                  ? <BarChart data={deptSlices} />
                  : <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "20px 0", textAlign: "center" }}>Отделы не назначены</div>}
              </Card>
              <Card title="Заказы по приоритету">
                <BarChart data={prioritySlices} />
              </Card>
              {analytics && analytics.completion_trend.length > 1 && (
                <Card title="Завершения за 14 дней">
                  <Sparkline points={analytics.completion_trend.map(t => t.value)} color="#10b981" width={280} height={64} />
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                    Всего: {analytics.completion_trend.reduce((s, t) => s + t.value, 0)} заказов
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* SLA violations */}
          {slaViolations.length > 0 && (
            <div
              style={{
                padding: "14px 18px", borderRadius: 12, marginBottom: 16,
                background: "#f59e0b10", border: "1px solid #f59e0b40",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>⏰</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#b45309" }}>
                      SLA нарушен — заказы просрочены ({slaViolations.length})
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                      {slaViolations.slice(0, 5).map((v) => `#${v.order_id} ${v.product_name} (+${v.hours_overdue}ч)`).join(" · ")}
                      {slaViolations.length > 5 && ` и ещё ${slaViolations.length - 5}…`}
                    </div>
                  </div>
                </div>
                <Button size="sm" variant="warning" onClick={() => router.push("/orders")}>Разобрать</Button>
              </div>
            </div>
          )}

          {/* Rework alert */}
          {reworkOrders.length > 0 && (
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 16, padding: "12px 18px", borderRadius: 12,
                background: "#ef444410", border: "1px solid #ef444435",
                marginBottom: 16, flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>⚠</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#ef4444" }}>
                    Заказы возвращены с ОТК на доработку ({reworkOrders.length})
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                    {reworkOrders.map((o) => `#${o.id} ${o.product_name}`).join(" · ")}
                  </div>
                </div>
              </div>
              <button
                onClick={() => router.push("/orders")}
                style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
              >
                Посмотреть
              </button>
            </div>
          )}

          {/* Tabs block */}
          <div
            style={{
              background: "var(--bg-secondary)", border: "1px solid var(--border)",
              borderRadius: 14, boxShadow: "var(--shadow-sm)", marginBottom: 24, overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-light)" }}>
              {(["orders", "tasks"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: "14px 24px", fontSize: 13, fontWeight: 500,
                    color: tab === t ? "var(--primary)" : "var(--text-secondary)",
                    background: "none", border: "none", cursor: "pointer", position: "relative",
                    transition: "color 0.15s", letterSpacing: "-0.005em",
                  }}
                >
                  {t === "orders" ? "Производственные задачи" : `Общие задачи${pendingTasks > 0 ? ` (${pendingTasks})` : ""}`}
                  {tab === t && (
                    <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, borderRadius: "2px 2px 0 0", background: "var(--primary)" }} />
                  )}
                </button>
              ))}
            </div>

            <div style={{ padding: "16px 20px" }}>
              {tab === "orders" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {displayOrders.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px 0" }}>
                      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Нет активных заказов</p>
                    </div>
                  ) : (
                    displayOrders.slice(0, 20).map((o) => (
                      <div
                        key={o.id}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          padding: "11px 16px", borderRadius: 10,
                          border: "1px solid var(--border-light)", cursor: "pointer", transition: "background 0.12s",
                        }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "var(--bg-tertiary)")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "")}
                        onClick={() => router.push(`/orders/${o.id}`)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <span style={{ fontSize: 11, fontFamily: "monospace", padding: "2px 8px", borderRadius: 5, background: "var(--bg-tertiary)", color: "var(--text-muted)" }}>
                            #{o.id}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{o.product_name}</span>
                          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{o.planned_qty} шт</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          {o.deadline && (
                            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              до {new Date(o.deadline).toLocaleDateString("ru")}
                            </span>
                          )}
                          <Badge status={o.status} />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {tab === "tasks" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <input
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addTask()}
                      placeholder="Новая задача..."
                      style={{
                        flex: 1, height: 36, padding: "0 12px", borderRadius: 8,
                        border: "1.5px solid var(--border)", background: "var(--bg-tertiary)",
                        color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "inherit",
                      }}
                    />
                    <select
                      value={taskPriority}
                      onChange={(e) => setTaskPriority(e.target.value)}
                      style={{
                        height: 36, padding: "0 28px 0 10px", borderRadius: 8,
                        border: "1.5px solid var(--border)", background: "var(--bg-tertiary)",
                        color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "inherit",
                        cursor: "pointer", flexShrink: 0,
                      }}
                    >
                      <option value="normal">Обычный</option>
                      <option value="high">Срочный</option>
                      <option value="low">Низкий</option>
                    </select>
                    <Button onClick={addTask} size="sm">Добавить</Button>
                  </div>

                  {tasks.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "36px 0" }}>
                      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Нет задач</p>
                    </div>
                  ) : (
                    tasks.map((t) => (
                      <div
                        key={t.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 12,
                          padding: "10px 14px", borderRadius: 10,
                          border: "1px solid var(--border-light)",
                          opacity: t.status === "completed" ? 0.5 : 1, transition: "opacity 0.15s",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={t.status === "completed"}
                          onChange={() =>
                            t.status === "pending"
                              ? completeTask(t.id)
                              : api.reopenTask(t.id).then((r) =>
                                  setTasks((prev) => prev.map((x) => (x.id === t.id ? r : x)))
                                )
                          }
                          style={{ width: 15, height: 15, cursor: "pointer", accentColor: "#6366f1", flexShrink: 0 }}
                        />
                        <span
                          style={{
                            flex: 1, fontSize: 13,
                            color: t.status === "completed" ? "var(--text-muted)" : "var(--text)",
                            textDecoration: t.status === "completed" ? "line-through" : "none",
                          }}
                        >
                          {t.title}
                        </span>
                        <span
                          style={{
                            fontSize: 11, padding: "2px 8px", borderRadius: 99, fontWeight: 500, flexShrink: 0,
                            ...(t.priority === "high"
                              ? { background: "#fef2f2", color: "#dc2626" }
                              : t.priority === "low"
                              ? { background: "#f8fafc", color: "#64748b" }
                              : { background: "#eff6ff", color: "#2563eb" }),
                          }}
                        >
                          {t.priority === "high" ? "Срочный" : t.priority === "low" ? "Низкий" : "Обычный"}
                        </span>
                        <button
                          onClick={() => deleteTask(t.id)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "var(--border)", display: "flex", padding: 2, flexShrink: 0, transition: "color 0.12s",
                          }}
                          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "#ef4444")}
                          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--border)")}
                        >
                          <svg width={14} height={14} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

    </AppLayout>
  );
}
