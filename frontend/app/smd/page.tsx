"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, Batch, Operator, Recipe } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { toast } from "../../components/ui/Toast";

const PROD_TYPE = "SMD";

export default function SmdPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [batches, setBatches] = useState<Batch[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [fetching, setFetching] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [startModal, setStartModal] = useState<Batch | null>(null);
  const [operatorId, setOperatorId] = useState("");
  const [pauseModal, setPauseModal] = useState<Batch | null>(null);
  const [pauseQty, setPauseQty] = useState("");
  const [pauseComment, setPauseComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [otkSubmitting, setOtkSubmitting] = useState<string | null>(null);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => {
    if (!user) return;
    load();
    api.getOperators(true).then(setOperators).catch(console.error);
    api.getRecipes().then(setRecipes).catch(console.error);
  }, [user]);

  useAutoRefresh(() => { load(); }, 30000, !!user && !startModal && !pauseModal);

  async function load() {
    setFetching(true);
    try {
      const all = await api.getProductionBatches();
      setBatches(all.filter(b => b.production_type === PROD_TYPE));
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

  async function pauseBatch() {
    if (!pauseModal) return;
    setSaving(true);
    try { await api.pauseShift(pauseModal.batch_id, Number(pauseQty) || 0, pauseComment); setPauseModal(null); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function completeBatch(b: Batch) {
    if (!confirm(`Завершить партию ${b.batch_id}?`)) return;
    try { await api.completeProduction(b.batch_id, b.actual_qty ?? b.planned_qty); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function submitToOtk(b: Batch) {
    if (!b.order_id) return;
    setOtkSubmitting(b.batch_id);
    try {
      await api.updateOrder(b.order_id, { status: "На проверке ОТК" });
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setOtkSubmitting(null);
  }

  if (loading || !user) return null;

  const active = batches.filter(b => !["Завершена", "Отменена"].includes(b.status));
  const done   = batches.filter(b => b.status === "Завершена");

  // Batches completed but not yet submitted to OTK
  const otkReady = done.filter(b =>
    b.order_id &&
    !["На проверке ОТК", "Готов к отгрузке", "Завершён", "Завершен"].includes(b.order_status || "")
  );

  // Batches returned from OTK for rework
  const returned = batches.filter(b => b.order_status === "Доработка");

  const getComponents = (productName: string) =>
    recipes.filter(r => r.product_name === productName && r.production_type === PROD_TYPE);

  const statusColor: Record<string, string> = {
    "Запланировано": "#6b7280", "Запущена": "#0ea5e9", "На паузе": "#f59e0b",
    "Готов к проверке ОТК": "#8b5cf6", "Завершена": "#10b981",
  };

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0 }}>СМД — монтаж компонентов</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
              Пайка SMD-компонентов на плату
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>Обновить</Button>
        </div>

        {/* Returned from OTK alert */}
        {returned.length > 0 && (
          <div style={{
            padding: "14px 18px", borderRadius: 10,
            background: "#ef444415", border: "1px solid #ef444440",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#ef4444" }}>
              ⚠ Возвращены с ОТК на доработку ({returned.length})
            </div>
            {returned.map(b => (
              <div key={b.batch_id} style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontFamily: "monospace", color: "var(--text-muted)", fontSize: 12 }}>{b.batch_id}</span>
                <span style={{ fontWeight: 600 }}>{b.product_name}</span>
                <Button size="sm" variant="ghost" onClick={() => router.push(`/orders/${b.order_id}`)}>Открыть заказ</Button>
              </div>
            ))}
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { label: "В очереди",  value: batches.filter(b => b.status === "Запланировано").length, color: "#6b7280" },
            { label: "В работе",   value: batches.filter(b => b.status === "Запущена").length,      color: "#0ea5e9" },
            { label: "На паузе",   value: batches.filter(b => b.status === "На паузе").length,      color: "#f59e0b" },
            { label: "Завершено",  value: done.length,                                               color: "#10b981" },
          ].map(s => (
            <div key={s.label} style={{
              padding: "12px 20px", borderRadius: 10, minWidth: 110, textAlign: "center",
              background: s.color + "14", border: `1px solid ${s.color}30`,
            }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Active batches */}
        {fetching ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Загрузка...</div>
        ) : active.length === 0 ? (
          <Card>
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
              Нет активных партий СМД
            </div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {active.map(b => {
              const color = statusColor[b.status] ?? "#6b7280";
              const comps = getComponents(b.product_name);
              const isExpanded = expanded === b.batch_id;
              return (
                <Card key={b.batch_id}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                    <div style={{ width: 4, alignSelf: "stretch", borderRadius: 4, background: color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{b.batch_id}</span>
                        <span style={{ fontWeight: 700, fontSize: 15 }}>{b.product_name}</span>
                        <Badge status={b.status} />
                      </div>
                      <div style={{ display: "flex", gap: 20, fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap", marginBottom: 10 }}>
                        <span>План: <b>{b.planned_qty}</b> шт</span>
                        {b.actual_qty != null && <span>Факт: <b style={{ color: "#10b981" }}>{b.actual_qty}</b> шт</span>}
                        {b.operator_name && <span>Оператор: <b>{b.operator_name}</b></span>}
                      </div>

                      {comps.length > 0 && (
                        <button
                          onClick={() => setExpanded(isExpanded ? null : b.batch_id)}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#8b5cf6", fontWeight: 600, padding: 0, marginBottom: 8 }}
                        >
                          {isExpanded ? "▲ Скрыть" : `▼ Компоненты (${comps.length})`}
                        </button>
                      )}
                      {isExpanded && (
                        <div style={{ overflowX: "auto", marginBottom: 10 }}>
                          <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                            <thead>
                              <tr>
                                {["Компонент", "Норма", "Десигнатор", "Сторона"].map(h => (
                                  <th key={h} style={{ textAlign: "left", padding: "2px 8px", color: "var(--text-muted)", fontWeight: 600 }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {comps.map(c => (
                                <tr key={c.id}>
                                  <td style={{ padding: "3px 8px" }}>{c.component_name}</td>
                                  <td style={{ padding: "3px 8px" }}>{c.norm}</td>
                                  <td style={{ padding: "3px 8px", color: "#8b5cf6", fontWeight: 500 }}>{c.designator || "—"}</td>
                                  <td style={{ padding: "3px 8px" }}>{c.board_side || "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                        <Button size="sm" variant="ghost" onClick={() => router.push(`/orders/${b.order_id}`)}>Заказ</Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Ready for OTK */}
        {otkReady.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Готовы к сдаче на ОТК
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {otkReady.map(b => (
                <Card key={b.batch_id}>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{b.batch_id}</span>
                        <span style={{ fontWeight: 700 }}>{b.product_name}</span>
                        <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "#10b98115", color: "#10b981", fontWeight: 600 }}>Завершена</span>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                        Произведено: <b style={{ color: "#10b981" }}>{b.actual_qty ?? b.planned_qty}</b> шт
                        {b.operator_name && <> · Оператор: <b>{b.operator_name}</b></>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => submitToOtk(b)}
                      loading={otkSubmitting === b.batch_id}
                    >
                      Сдать на ОТК
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Completed (archived) */}
        {done.filter(b => ["На проверке ОТК", "Готов к отгрузке", "Завершён", "Завершен"].includes(b.order_status || "")).length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
              Сданы на ОТК / Завершены
            </div>
            <Card>
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead><tr>{["ID партии","Изделие","План","Факт","Оператор","Статус заказа"].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {done.filter(b => ["На проверке ОТК", "Готов к отгрузке", "Завершён", "Завершен"].includes(b.order_status || "")).map(b => (
                      <tr key={b.batch_id}>
                        <td className="font-mono" style={{ fontSize: 12 }}>{b.batch_id}</td>
                        <td style={{ fontWeight: 500 }}>{b.product_name}</td>
                        <td>{b.planned_qty}</td>
                        <td style={{ color: "#10b981", fontWeight: 600 }}>{b.actual_qty ?? 0}</td>
                        <td>{b.operator_name || "—"}</td>
                        <td><Badge status={b.order_status || "—"} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Modal open={!!startModal} onClose={() => setStartModal(null)}
        title={`Запустить ${startModal?.batch_id}`}
        footer={<><Button variant="secondary" onClick={() => setStartModal(null)}>Отмена</Button><Button onClick={startBatch} loading={saving}>Запустить</Button></>}
      >
        <div><label>Табельный номер оператора *</label>
          <input value={operatorId} onChange={e => setOperatorId(e.target.value)} list="op-list" placeholder="Номер сотрудника" />
          <datalist id="op-list">{operators.map(o => <option key={o.employee_id} value={o.employee_id}>{o.name}</option>)}</datalist>
        </div>
      </Modal>

      <Modal open={!!pauseModal} onClose={() => setPauseModal(null)}
        title={`Пауза — ${pauseModal?.batch_id}`}
        footer={<><Button variant="secondary" onClick={() => setPauseModal(null)}>Отмена</Button><Button variant="warning" onClick={pauseBatch} loading={saving}>На паузу</Button></>}
      >
        <div className="space-y-3">
          <div><label>Произведено за смену</label>
            <input type="number" value={pauseQty} onChange={e => setPauseQty(e.target.value)} min="0" /></div>
          <div><label>Комментарий</label>
            <textarea value={pauseComment} onChange={e => setPauseComment(e.target.value)} rows={2} /></div>
        </div>
      </Modal>
    </AppLayout>
  );
}
