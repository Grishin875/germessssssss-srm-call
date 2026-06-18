"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge, PriorityBadge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, Batch, Order, Operator } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { toast } from "../../components/ui/Toast";

// ─── Kanban column config ────────────────────────────────────────────────────
const BOARD_COLUMNS: { key: string; label: string; statuses: string[]; color: string }[] = [
  { key: "new",      label: "Создан",    statuses: ["Создан", "Назначен"],                                                      color: "#6b7280" },
  { key: "working",  label: "В работе",  statuses: ["В работе", "Доработка"],                                                   color: "#0ea5e9" },
  { key: "otk",      label: "ОТК",       statuses: ["На проверке ОТК", "Готов к проверке ОТК", "Передан на ОТК", "Готов к отгрузке"], color: "#8b5cf6" },
  { key: "done",     label: "Завершён",  statuses: ["Завершен", "Завершён"],                                                    color: "#10b981" },
];

// ─── Order card ──────────────────────────────────────────────────────────────
function OrderCard({ order, onClick }: { order: Order; onClick: () => void }) {
  const col = BOARD_COLUMNS.find(c => c.statuses.includes(order.status));
  const color = col?.color ?? "#6b7280";

  const isOverdue = order.deadline && order.status !== "Завершен"
    && new Date(order.deadline) < new Date();

  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--bg, #fff)",
        border: "1px solid var(--border, #e5e7eb)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        transition: "box-shadow 0.15s, transform 0.1s",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.1)";
        (e.currentTarget as HTMLDivElement).style.transform = "translateY(-1px)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = "";
        (e.currentTarget as HTMLDivElement).style.transform = "";
      }}
    >
      {/* Top row: id + priority */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>#{order.id}</span>
        <PriorityBadge priority={order.priority} />
      </div>

      {/* Product name */}
      <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{order.product_name}</div>

      {/* Qty */}
      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
        {order.planned_qty} шт
        {order.actual_qty ? <span style={{ color: "#10b981", marginLeft: 6 }}>· {order.actual_qty} факт</span> : null}
      </div>

      {/* Bottom row: deadline + operator */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 2 }}>
        {order.deadline ? (
          <span style={{
            fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 6,
            background: isOverdue ? "#ef444418" : "var(--bg-secondary)",
            color: isOverdue ? "#ef4444" : "var(--text-muted)",
            border: isOverdue ? "1px solid #ef444430" : "1px solid var(--border)",
          }}>
            {isOverdue ? "⚠ " : ""}{new Date(order.deadline).toLocaleDateString("ru")}
          </span>
        ) : <span />}
        {order.assigned_operator_name && (
          <span style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            👤 {order.assigned_operator_name}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
export default function ProductionPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [view, setView] = useState<"board" | "table">("board");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [fetching, setFetching] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Batch modals
  const [startModal, setStartModal] = useState<Batch | null>(null);
  const [operatorId, setOperatorId] = useState("");
  const [pauseModal, setPauseModal] = useState<Batch | null>(null);
  const [pauseQty, setPauseQty] = useState("");
  const [pauseComment, setPauseComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    load();
    api.getOperators(true).then(setOperators).catch(console.error);
  }, [user]);

  useAutoRefresh(() => { load(); }, 30000, !!user && !startModal && !pauseModal);

  async function load() {
    setFetching(true);
    try {
      const [b, o] = await Promise.all([
        api.getProductionBatches(),
        api.getOrders(undefined, undefined, "Создан,Назначен,В работе,Доработка,На проверке ОТК,Готов к проверке ОТК,Передан на ОТК,Готов к отгрузке,Завершен,Завершён"),
      ]);
      setBatches(b);
      setOrders(o);
    } catch {}
    setFetching(false);
  }

  async function startBatch() {
    if (!startModal || !operatorId.trim()) return;
    setSaving(true);
    try {
      await api.startBatch(startModal.batch_id, { operatorIds: [operatorId.trim()] });
      setStartModal(null); setOperatorId("");
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function pauseBatch() {
    if (!pauseModal) return;
    setSaving(true);
    try {
      await api.pauseShift(pauseModal.batch_id, Number(pauseQty) || 0, pauseComment);
      setPauseModal(null); setPauseQty(""); setPauseComment("");
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function completeBatch(b: Batch) {
    if (!confirm(`Завершить партию ${b.batch_id}?`)) return;
    try { await api.completeProduction(b.batch_id, b.actual_qty ?? b.planned_qty); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  if (loading || !user) return null;

  const filteredBatches = batches.filter(b => {
    if (statusFilter && b.status !== statusFilter) return false;
    if (typeFilter && b.production_type !== typeFilter) return false;
    return true;
  });
  const types = [...new Set(batches.map(b => b.production_type))];

  const viewBtnStyle = (v: string): React.CSSProperties => ({
    padding: "6px 16px", borderRadius: 7, border: "none", cursor: "pointer",
    fontWeight: 600, fontSize: 13, transition: "all 0.15s",
    background: view === v ? "var(--primary)" : "transparent",
    color: view === v ? "#fff" : "var(--text-secondary)",
  });

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h1>Производство</h1>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {/* View toggle */}
            <div style={{ display: "flex", gap: 2, background: "var(--bg-secondary)", padding: 3, borderRadius: 9 }}>
              <button style={viewBtnStyle("board")} onClick={() => setView("board")}>
                ⊞ Доска
              </button>
              <button style={viewBtnStyle("table")} onClick={() => setView("table")}>
                ☰ Список
              </button>
            </div>
            <Button variant="secondary" size="sm" onClick={load}>Обновить</Button>
          </div>
        </div>

        {fetching ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Загрузка...</div>
        ) : view === "board" ? (

          /* ── BOARD VIEW ───────────────────────────────────────────────── */
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(220px, 1fr))",
            gap: 16,
            alignItems: "start",
          }}>
            {BOARD_COLUMNS.map(col => {
              const colOrders = orders.filter(o => col.statuses.includes(o.status));
              return (
                <div key={col.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {/* Column header */}
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 12px", borderRadius: 8,
                    background: col.color + "14",
                    border: `1px solid ${col.color}30`,
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: col.color }}>{col.label}</span>
                    <span style={{
                      fontWeight: 700, fontSize: 12,
                      background: col.color + "25", color: col.color,
                      padding: "1px 8px", borderRadius: 10,
                    }}>{colOrders.length}</span>
                  </div>

                  {/* Cards */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {colOrders.length === 0 ? (
                      <div style={{
                        textAlign: "center", padding: "20px 12px",
                        color: "var(--text-muted)", fontSize: 12,
                        border: "1px dashed var(--border)", borderRadius: 8,
                      }}>Нет заказов</div>
                    ) : (
                      colOrders.map(o => (
                        <OrderCard
                          key={o.id}
                          order={o}
                          onClick={() => router.push(`/orders/${o.id}`)}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

        ) : (

          /* ── TABLE VIEW ───────────────────────────────────────────────── */
          <>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="">Все статусы</option>
                {["Запланировано","Запущена","На паузе","Готов к проверке ОТК","Завершена","Отменена"].map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                <option value="">Все типы</option>
                {types.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <Card>
              {filteredBatches.length === 0 ? (
                <div className="text-center py-12">Партии не найдены</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        {["ID партии","Изделие","Тип","План","Факт","Оператор","Статус","Действия"].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredBatches.map(b => (
                        <tr key={b.batch_id}>
                          <td className="font-mono" style={{ fontSize: 12 }}>{b.batch_id}</td>
                          <td style={{ fontWeight: 500 }}>{b.product_name}</td>
                          <td>{b.production_type}</td>
                          <td>{b.planned_qty}</td>
                          <td>{b.actual_qty ?? 0}</td>
                          <td>{b.operator_name || "—"}</td>
                          <td><Badge status={b.status} /></td>
                          <td>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {b.status === "Запланировано" && hasPermission("production.start") && (
                                <Button size="sm" onClick={() => { setStartModal(b); setOperatorId(""); }}>Запустить</Button>
                              )}
                              {b.status === "Запущена" && hasPermission("production.pause_complete") && (
                                <>
                                  <Button size="sm" variant="warning" onClick={() => { setPauseModal(b); setPauseQty(""); setPauseComment(""); }}>Пауза</Button>
                                  <Button size="sm" variant="success" onClick={() => completeBatch(b)}>Завершить</Button>
                                </>
                              )}
                              {b.status === "На паузе" && hasPermission("production.start") && (
                                <Button size="sm" onClick={() => { setStartModal(b); setOperatorId(b.operator_id || ""); }}>Продолжить</Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>

      {/* Start batch modal */}
      <Modal
        open={!!startModal}
        onClose={() => setStartModal(null)}
        title={`Запустить партию ${startModal?.batch_id}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStartModal(null)}>Отмена</Button>
            <Button onClick={startBatch} loading={saving}>Запустить</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label>Номер сотрудника *</label>
            <input
              value={operatorId}
              onChange={e => setOperatorId(e.target.value)}
              list="operators-list"
              placeholder="Введите табельный номер"
            />
            <datalist id="operators-list">
              {operators.map(o => <option key={o.employee_id} value={o.employee_id}>{o.name}</option>)}
            </datalist>
          </div>
        </div>
      </Modal>

      {/* Pause batch modal */}
      <Modal
        open={!!pauseModal}
        onClose={() => setPauseModal(null)}
        title={`Завершить смену — ${pauseModal?.batch_id}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPauseModal(null)}>Отмена</Button>
            <Button variant="warning" onClick={pauseBatch} loading={saving}>Поставить на паузу</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label>Произведено за смену *</label>
            <input type="number" value={pauseQty} onChange={e => setPauseQty(e.target.value)} min="0" />
          </div>
          <div>
            <label>Комментарий</label>
            <textarea value={pauseComment} onChange={e => setPauseComment(e.target.value)} rows={2} />
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
