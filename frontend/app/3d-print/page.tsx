"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, Batch, Operator, Component } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { toast } from "../../components/ui/Toast";

const PROD_TYPE = "3D Печать";

export default function PrintPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [batches, setBatches]   = useState<Batch[]>([]);
  const [stock, setStock]       = useState<Component[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [fetching, setFetching] = useState(true);
  const [tab, setTab]           = useState<"queue" | "stock">("queue");

  const [startModal, setStartModal] = useState<Batch | null>(null);
  const [operatorId, setOperatorId] = useState("");
  const [saving, setSaving]     = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => {
    if (!user) return;
    load();
    api.getOperators(true).then(setOperators).catch(console.error);
  }, [user]);

  useAutoRefresh(() => { load(); }, 30000, !!user && !startModal);

  async function load() {
    setFetching(true);
    try {
      const [all, comps] = await Promise.all([api.getProductionBatches(), api.getComponents()]);
      setBatches(all.filter(b => b.production_type === PROD_TYPE));
      setStock(comps.filter(c => c.source === "3d_print"));
    } catch {}
    setFetching(false);
  }

  async function startBatch() {
    if (!startModal || !operatorId.trim()) return;
    setSaving(true);
    try { await api.startBatch(startModal.batch_id, { operatorIds: [operatorId.trim()] }); setStartModal(null); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function completeBatch(b: Batch) {
    if (!confirm(`Завершить партию 3D печати ${b.batch_id}?`)) return;
    try { await api.completeProduction(b.batch_id, b.actual_qty ?? b.planned_qty); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  if (loading || !user) return null;

  const active = batches.filter(b => !["Завершена", "Отменена"].includes(b.status));
  const done   = batches.filter(b => b.status === "Завершена");

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer",
    fontWeight: 600, fontSize: 13, transition: "all 0.15s",
    background: tab === t ? "var(--primary)" : "transparent",
    color: tab === t ? "#fff" : "var(--text-secondary)",
  });

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0 }}>3D Печать</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>Производство пластиковых компонентов и корпусов</p>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>Обновить</Button>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { label: "В очереди", value: batches.filter(b => b.status === "Запланировано").length, color: "#6b7280" },
            { label: "Печатается", value: batches.filter(b => b.status === "Запущена").length,     color: "#10b981" },
            { label: "Завершено",  value: done.length,                                              color: "#10b981" },
            { label: "Запасы",     value: stock.reduce((s, i) => s + (i.stock ?? 0), 0),            color: "#f59e0b" },
          ].map(s => (
            <div key={s.label} style={{ padding: "12px 20px", borderRadius: 10, minWidth: 110, textAlign: "center", background: s.color + "14", border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: "var(--bg-secondary)", padding: 3, borderRadius: 9, width: "fit-content" }}>
          <button style={tabStyle("queue")} onClick={() => setTab("queue")}>Очередь печати</button>
          <button style={tabStyle("stock")} onClick={() => setTab("stock")}>Запасы 3D</button>
        </div>

        {fetching ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Загрузка...</div>
        ) : tab === "queue" ? (
          active.length === 0 ? (
            <Card><div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Нет активных заданий на печать</div></Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {active.map(b => (
                <Card key={b.batch_id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: "#10b981", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{b.batch_id}</span>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{b.product_name}</span>
                        <Badge status={b.status} />
                      </div>
                      <div style={{ display: "flex", gap: 20, fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap", marginBottom: 10 }}>
                        <span>Нужно напечатать: <b>{b.planned_qty}</b> шт</span>
                        {b.actual_qty != null && <span>Готово: <b style={{ color: "#10b981" }}>{b.actual_qty}</b> шт</span>}
                        {b.operator_name && <span>Оператор: <b>{b.operator_name}</b></span>}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {b.status === "Запланировано" && hasPermission("production.start") && (
                          <Button size="sm" onClick={() => { setStartModal(b); setOperatorId(""); }}>Начать печать</Button>
                        )}
                        {b.status === "Запущена" && hasPermission("production.pause_complete") && (
                          <Button size="sm" variant="success" onClick={() => completeBatch(b)}>Завершить</Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => router.push(`/orders/${b.order_id}`)}>Заказ</Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : (
          /* Stock tab */
          <Card title="Запасы 3D-печатных компонентов">
            {stock.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Нет данных по запасам</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr>{["Компонент","Категория","Количество","Последнее обновление"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {stock.map(s => (
                      <tr key={s.id}>
                        <td style={{ fontWeight: 500 }}>{s.name}</td>
                        <td>{s.category || "—"}</td>
                        <td style={{ fontWeight: 700, color: (s.stock ?? 0) > 0 ? "#10b981" : "#ef4444" }}>{s.stock ?? 0}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.unit || "шт"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>

      <Modal open={!!startModal} onClose={() => setStartModal(null)} title={`Начать печать — ${startModal?.batch_id}`}
        footer={<><Button variant="secondary" onClick={() => setStartModal(null)}>Отмена</Button><Button onClick={startBatch} loading={saving}>Начать</Button></>}>
        <div><label>Табельный номер оператора *</label>
          <input value={operatorId} onChange={e => setOperatorId(e.target.value)} list="op-list3" placeholder="Номер сотрудника" />
          <datalist id="op-list3">{operators.map(o => <option key={o.employee_id} value={o.employee_id}>{o.name}</option>)}</datalist>
        </div>
      </Modal>
    </AppLayout>
  );
}
