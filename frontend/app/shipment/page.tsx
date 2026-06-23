"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, Order, OtkBatch } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";

interface ReadyOrder extends Order {
  batches?: {
    batch_id: string;
    good_qty: number;
    shipped_qty: number;
    remaining_qty: number;
    status: string;
    check_date?: string;
  }[];
}

interface ShipHistoryItem {
  batch_id: string;
  product_name: string;
  good_qty: number;
  shipped_qty: number;
  ship_date?: string;
  check_date?: string;
  shipper_name?: string;
  maker_name?: string;
  order_id?: number;
}

export default function ShipmentPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [ready, setReady] = useState<ReadyOrder[]>([]);
  const [history, setHistory] = useState<ShipHistoryItem[]>([]);
  const [fetching, setFetching] = useState(true);
  const [tab, setTab] = useState<"ready" | "history">("ready");

  // Filters for history
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterProduct, setFilterProduct] = useState("");

  // Ship modal
  const [shipOrder, setShipOrder] = useState<ReadyOrder | null>(null);
  const [shipItems, setShipItems] = useState<{ batchId: string; maxQty: number; qty: string }[]>([]);
  const [shipperId, setShipperId] = useState("");
  const [saving, setSaving] = useState(false);
  const [shipError, setShipError] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [recipient, setRecipient] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (user) loadReady(); }, [user]);
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab]);

  useAutoRefresh(() => {
    if (tab === "ready") loadReady();
    else loadHistory();
  }, 30000, !!user && !shipOrder);

  async function loadReady() {
    setFetching(true);
    try {
      const data = await api.getReadyToShip();
      setReady(data as ReadyOrder[]);
    } catch {}
    setFetching(false);
  }

  async function loadHistory() {
    setFetching(true);
    try {
      const params: Record<string, string> = {};
      if (filterFrom) params.date_from = filterFrom;
      if (filterTo) params.date_to = filterTo;
      if (filterProduct) params.product_name = filterProduct;
      // Используем эндпоинт истории отгрузок
      const res = await fetch(`/api/shipment/history?${new URLSearchParams(params)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("crm_token")}` },
      });
      if (res.ok) setHistory(await res.json());
    } catch {}
    setFetching(false);
  }

  function openShipModal(order: ReadyOrder) {
    const batches = order.batches ?? [];
    setShipItems(batches
      .filter(b => b.remaining_qty > 0)
      .map(b => ({ batchId: b.batch_id, maxQty: b.remaining_qty, qty: String(b.remaining_qty) }))
    );
    setShipperId(user?.full_name || user?.username || "");
    setShipError("");
    setInvoiceNumber("");
    setRecipient("");
    setShipOrder(order);
  }

  async function doShip() {
    if (!shipOrder || !shipperId.trim()) { setShipError("Укажите ответственного за отгрузку"); return; }
    const items = shipItems.filter(i => Number(i.qty) > 0);
    if (!items.length) { setShipError("Укажите количество для отгрузки"); return; }
    for (const item of items) {
      if (Number(item.qty) > item.maxQty) {
        setShipError(`Нельзя отгрузить больше доступного (${item.maxQty} шт) для ${item.batchId}`);
        return;
      }
    }
    setSaving(true); setShipError("");
    try {
      await api.shipPartial(items.map(i => ({ batchId: i.batchId, qty: Number(i.qty), shipperId: shipperId.trim(), invoiceNumber: invoiceNumber.trim() || undefined, recipient: recipient.trim() || undefined })));
      setShipOrder(null);
      loadReady();
    } catch (e: unknown) { setShipError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  if (loading || !user) return null;

  if (!hasPermission("otk.view")) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-gray-500">Нет доступа</div>
      </AppLayout>
    );
  }

  const totalReady = ready.reduce((s, o) => s + (o.batches ?? []).reduce((ss, b) => ss + b.remaining_qty, 0), 0);
  const totalShipped = history.reduce((s, h) => s + (h.shipped_qty ?? 0), 0);

  const tabStyle = (t: string): React.CSSProperties => ({
    padding: "7px 18px", borderRadius: 7, border: "none", cursor: "pointer",
    fontWeight: 600, fontSize: 13, transition: "all 0.15s",
    background: tab === t ? "var(--primary)" : "transparent",
    color: tab === t ? "#fff" : "var(--text-secondary)",
  });

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0 }}>Отгрузка</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>Готовая продукция к отправке</p>
          </div>
          <Button variant="secondary" size="sm" onClick={tab === "ready" ? loadReady : loadHistory}>Обновить</Button>
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { label: "Готово к отгрузке", value: `${ready.length} заказов`, sub: `${totalReady} шт`, color: "#10b981" },
            { label: "Отгружено (история)", value: `${history.length} партий`, sub: `${totalShipped} шт`, color: "#0ea5e9" },
          ].map(s => (
            <div key={s.label} style={{ padding: "14px 20px", borderRadius: 10, minWidth: 160, background: s.color + "14", border: `1px solid ${s.color}30` }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 13, color: s.color, opacity: 0.8 }}>{s.sub}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: "var(--bg-secondary)", padding: 3, borderRadius: 9, width: "fit-content" }}>
          <button style={tabStyle("ready")} onClick={() => setTab("ready")}>
            Готово к отгрузке
            {ready.length > 0 && (
              <span style={{ marginLeft: 6, background: "#10b98130", color: "#10b981", borderRadius: 10, padding: "0 6px", fontSize: 11 }}>
                {ready.length}
              </span>
            )}
          </button>
          <button style={tabStyle("history")} onClick={() => setTab("history")}>История отгрузок</button>
        </div>

        {fetching ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Загрузка...</div>
        ) : tab === "ready" ? (

          ready.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
                <div style={{ color: "var(--text-muted)", fontSize: 15 }}>Нет продукции готовой к отгрузке</div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>Продукция появится после прохождения ОТК</div>
              </div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {ready.map(order => {
                const batches = order.batches ?? [];
                const totalRemaining = batches.reduce((s, b) => s + b.remaining_qty, 0);
                const isOverdue = order.deadline && new Date(order.deadline) < new Date();
                return (
                  <Card key={order.id}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>#{order.id}</span>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{order.product_name}</span>
                          <Badge status={order.status} />
                        </div>
                        <div style={{ display: "flex", gap: 20, fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap", marginBottom: 10 }}>
                          <span>Заказ: <b>{order.planned_qty}</b> шт</span>
                          <span>К отгрузке: <b style={{ color: "#10b981" }}>{totalRemaining}</b> шт</span>
                          {order.deadline && (
                            <span style={{ color: isOverdue ? "#ef4444" : undefined }}>
                              Срок: <b>{new Date(order.deadline).toLocaleDateString("ru")}</b>
                              {isOverdue && " ⚠"}
                            </span>
                          )}
                        </div>

                        {/* Batches breakdown */}
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {batches.map(b => (
                            <div key={b.batch_id} style={{
                              padding: "5px 10px", borderRadius: 6,
                              background: "var(--bg-secondary)", border: "1px solid var(--border)",
                              fontSize: 12,
                            }}>
                              <span style={{ fontFamily: "monospace", color: "var(--text-muted)" }}>{b.batch_id}</span>
                              <span style={{ marginLeft: 8, color: "#10b981", fontWeight: 600 }}>✓ {b.good_qty}</span>
                              {b.shipped_qty > 0 && (
                                <span style={{ marginLeft: 6, color: "#0ea5e9", fontWeight: 600 }}>→ {b.shipped_qty}</span>
                              )}
                              <span style={{ marginLeft: 6, color: b.remaining_qty > 0 ? "#f59e0b" : "#6b7280", fontWeight: 600 }}>
                                ост. {b.remaining_qty}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <Button onClick={() => openShipModal(order)} disabled={totalRemaining === 0}>
                        Оформить отгрузку
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )

        ) : (

          /* History */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Filters */}
            <Card>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label>Дата от</label>
                  <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={{ width: 150 }} />
                </div>
                <div>
                  <label>Дата до</label>
                  <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={{ width: 150 }} />
                </div>
                <div>
                  <label>Изделие</label>
                  <input value={filterProduct} onChange={e => setFilterProduct(e.target.value)} placeholder="Поиск..." style={{ width: 180 }} />
                </div>
                <Button size="sm" onClick={loadHistory}>Применить</Button>
                <Button size="sm" variant="secondary" onClick={() => { setFilterFrom(""); setFilterTo(""); setFilterProduct(""); setTimeout(loadHistory, 0); }}>Сбросить</Button>
              </div>
            </Card>

            {history.length === 0 ? (
              <Card><div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>История отгрузок пуста</div></Card>
            ) : (
              <Card>
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        {["Партия", "Изделие", "Заказ", "Отгружено", "Накладная", "Получатель", "Дата отгрузки", "Кто отгрузил", "Дата проверки ОТК"].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map(h => (
                        <tr key={h.batch_id}>
                          <td style={{ fontFamily: "monospace", fontSize: 12 }}>{h.batch_id}</td>
                          <td style={{ fontWeight: 500 }}>{h.product_name}</td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {h.order_id ? `#${h.order_id}` : "—"}
                          </td>
                          <td style={{ fontWeight: 600, color: "#10b981" }}>{h.shipped_qty} шт</td>
                          <td style={{ fontSize: 12 }}>{(h as {invoice_number?: string}).invoice_number || "—"}</td>
                          <td style={{ fontSize: 12 }}>{(h as {recipient?: string}).recipient || "—"}</td>
                          <td style={{ fontWeight: 600, color: "#0ea5e9" }}>
                            {h.ship_date ? new Date(h.ship_date).toLocaleDateString("ru", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}
                          </td>
                          <td style={{ fontSize: 13 }}>{h.shipper_name || "—"}</td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {h.check_date ? new Date(h.check_date).toLocaleDateString("ru") : "—"}
                          </td>
                          <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{h.maker_name || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Ship modal */}
      <Modal
        open={!!shipOrder}
        onClose={() => setShipOrder(null)}
        title={`Отгрузка — ${shipOrder?.product_name}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShipOrder(null)}>Отмена</Button>
            <Button onClick={doShip} loading={saving}>Подтвердить отгрузку</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {shipError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{shipError}</div>}

          {/* Order info */}
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{shipOrder?.product_name}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
              Заказ #{shipOrder?.id} · {shipOrder?.planned_qty} шт
              {shipOrder?.deadline && ` · Срок: ${new Date(shipOrder.deadline).toLocaleDateString("ru")}`}
            </div>
          </div>

          {/* Shipper */}
          <div>
            <label>Ответственный за отгрузку *</label>
            <input
              value={shipperId}
              onChange={e => setShipperId(e.target.value)}
              placeholder="ФИО или табельный номер"
            />
          </div>

          {/* Invoice + Recipient */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Номер накладной</label>
              <input
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="Напр. НЛ-2026-001"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label>Получатель</label>
              <input
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                placeholder="Организация или ФИО"
              />
            </div>
          </div>

          {/* Batches */}
          {shipItems.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>
                Партии для отгрузки
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {shipItems.map((item, idx) => (
                  <div key={item.batchId} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "var(--bg-secondary)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 13, flex: 1, color: "var(--text-secondary)" }}>{item.batchId}</span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Доступно: <b style={{ color: "#10b981" }}>{item.maxQty}</b> шт</span>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Отгрузить:</label>
                    <input
                      type="number"
                      value={item.qty}
                      onChange={e => {
                        const next = [...shipItems];
                        next[idx] = { ...next[idx], qty: e.target.value };
                        setShipItems(next);
                      }}
                      min="0"
                      max={item.maxQty}
                      style={{ width: 80 }}
                    />
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>шт</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 700, textAlign: "right", color: "#10b981" }}>
                Итого к отгрузке: {shipItems.reduce((s, i) => s + (Number(i.qty) || 0), 0)} шт
              </div>
            </div>
          )}

          {/* Date info */}
          <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 6 }}>
            📅 Дата отгрузки будет зафиксирована автоматически: <b>{new Date().toLocaleDateString("ru", { day: "2-digit", month: "long", year: "numeric" })}</b>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
