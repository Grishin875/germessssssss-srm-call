"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge, PriorityBadge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, MyOrder, OrderStage } from "../../lib/api";
import { useStageTypes } from "../../hooks/useStageTypes";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { toast } from "../../components/ui/Toast";
import { useI18n } from "../../lib/i18n";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:     { label: "Ожидает начала", color: "#f59e0b" },
  in_progress: { label: "В работе",       color: "#0ea5e9" },
  done:        { label: "Выполнено",      color: "#10b981" },
};

export default function MyTasksPage() {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const { labelMap: STAGE_TYPE_LABELS } = useStageTypes();
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [fetching, setFetching] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);
  const [submittingOtk, setSubmittingOtk] = useState<number | null>(null);
  const [transferModal, setTransferModal] = useState<{ order: MyOrder; stage: OrderStage } | null>(null);
  const [transferQty, setTransferQty] = useState("");
  const [transferSaving, setTransferSaving] = useState(false);
  const [otkModal, setOtkModal] = useState<MyOrder | null>(null);
  const [otkPhoto, setOtkPhoto] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (user) load(); }, [user]);

  useAutoRefresh(() => { load(); }, 30000, !!user && !transferModal && !otkModal);

  async function load() {
    setFetching(true);
    try { setOrders(await api.getMyOrders()); } catch {}
    setFetching(false);
  }

  async function handleStart(order: MyOrder, stage: OrderStage) {
    setActionId(stage.id);
    try {
      await api.startStage(order.id, stage.id);
      await load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setActionId(null);
  }

  async function handleComplete(order: MyOrder, stage: OrderStage) {
    if (!confirm(`Завершить этап "${stage.stage_name || stage.stage_type}"?`)) return;
    setActionId(stage.id);
    try {
      await api.completeStage(order.id, stage.id);
      await load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setActionId(null);
  }

  async function handleSubmitOtk() {
    if (!otkModal) return;
    setSubmittingOtk(otkModal.id);
    try {
      await api.submitOtk(otkModal.id, otkPhoto.trim() || undefined);
      setOtkModal(null);
      setOtkPhoto("");
      await load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSubmittingOtk(null);
  }

  async function handleTransfer() {
    if (!transferModal || !transferQty) return;
    setTransferSaving(true);
    try {
      await api.transferStage(transferModal.order.id, transferModal.stage.id, Number(transferQty));
      setTransferModal(null);
      setTransferQty("");
      await load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setTransferSaving(false);
  }

  if (loading || !user) return null;

  // Показываем заказы где есть незавершённые этапы ИЛИ все выполнены но ещё не сданы в ОТК
  const activeOrders = orders.filter(o =>
    o.my_stages.length > 0 && o.status !== "На проверке ОТК"
  );

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{t("nav.my_tasks")}</h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              Заказы где вам назначены этапы
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={load}>Обновить</Button>
        </div>

        {fetching ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Загрузка...</div>
        ) : activeOrders.length === 0 ? (
          <Card>
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Нет активных заданий</div>
              <div style={{ fontSize: 13 }}>Когда менеджер назначит вас на этап — заказ появится здесь</div>
            </div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {activeOrders.map(order => {
              const activeStages = order.my_stages.filter(s => s.status !== "done");
              const doneStages = order.my_stages.filter(s => s.status === "done");
              const isOverdue = order.deadline && new Date(order.deadline) < new Date();

              return (
                <Card key={order.id}>
                  {/* Order header */}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-muted)", background: "var(--bg-secondary)", padding: "2px 8px", borderRadius: 5 }}>
                        #{order.id}
                      </span>
                      <span style={{ fontWeight: 700, fontSize: 17 }}>{order.product_name}</span>
                      <Badge status={order.status} />
                      <PriorityBadge priority={order.priority} />
                    </div>
                    <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap" }}>
                      <span>{order.planned_qty} шт</span>
                      {order.deadline && (
                        <span style={{ color: isOverdue ? "#ef4444" : "var(--text-secondary)", fontWeight: isOverdue ? 600 : 400 }}>
                          {isOverdue ? "⚠ " : ""}Срок: {new Date(order.deadline).toLocaleDateString("ru")}
                        </span>
                      )}
                      {order.comment && (
                        <span style={{ color: "var(--text-muted)" }}>{order.comment}</span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                      <span>Мои этапы</span>
                      <span>{doneStages.length} / {order.my_stages.length} выполнено</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: "var(--border)", overflow: "hidden" }}>
                      <div style={{
                        height: "100%", borderRadius: 4, background: "#10b981",
                        width: `${order.my_stages.length > 0 ? (doneStages.length / order.my_stages.length) * 100 : 0}%`,
                        transition: "width 0.3s",
                      }} />
                    </div>
                  </div>

                  {/* Active stages */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {activeStages.map(stage => {
                      const typeInfo = STAGE_TYPE_LABELS[stage.stage_type] ?? { label: stage.stage_type, color: "#6b7280" };
                      const statusInfo = STATUS_LABELS[stage.status] ?? STATUS_LABELS.pending;
                      const isLoading = actionId === stage.id;

                      return (
                        <div key={stage.id} style={{
                          display: "flex", gap: 12, alignItems: "flex-start",
                          padding: "12px 14px", borderRadius: 10,
                          background: "var(--bg-secondary)",
                          border: `1px solid ${stage.status === "in_progress" ? typeInfo.color + "44" : "var(--border)"}`,
                        }}>
                          {/* Stage color bar */}
                          <div style={{ width: 3, borderRadius: 3, alignSelf: "stretch", background: typeInfo.color, flexShrink: 0, minHeight: 40 }} />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                              <span style={{ fontWeight: 600, fontSize: 14 }}>{stage.stage_name || typeInfo.label}</span>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 20, background: typeInfo.color + "20", color: typeInfo.color }}>
                                {typeInfo.label}
                              </span>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 20, background: statusInfo.color + "20", color: statusInfo.color }}>
                                {statusInfo.label}
                              </span>
                            </div>

                            {/* Instructions */}
                            {stage.instructions && (
                              <div style={{
                                marginBottom: 10, padding: "8px 12px", borderRadius: 8,
                                background: "#0ea5e910", border: "1px solid #0ea5e930",
                                fontSize: 13, color: "var(--text-secondary)", whiteSpace: "pre-wrap",
                              }}>
                                <div style={{ fontSize: 11, fontWeight: 600, color: "#0ea5e9", marginBottom: 4 }}>ИНСТРУКЦИЯ</div>
                                {stage.instructions}
                              </div>
                            )}

                            {/* Components */}
                            {stage.components && stage.components.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                                {stage.components.slice(0, 6).map((c, i) => (
                                  <span key={i} style={{
                                    fontSize: 11, padding: "2px 7px", borderRadius: 5,
                                    background: "var(--bg-primary)", border: "1px solid var(--border)",
                                    color: "var(--text-secondary)",
                                  }}>{c.name} × {c.qty}</span>
                                ))}
                                {stage.components.length > 6 && (
                                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>+{stage.components.length - 6} ещё</span>
                                )}
                              </div>
                            )}

                            {/* Actions */}
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {stage.status === "pending" && (
                                <Button size="sm" onClick={() => handleStart(order, stage)} loading={isLoading}>
                                  Начать работу
                                </Button>
                              )}
                              {stage.status === "in_progress" && (
                                <>
                                  {/* Кнопка передачи если нужно фиксировать */}
                                  {stage.transfer_qty === 1 && !stage.transferred_qty && (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => { setTransferModal({ order, stage }); setTransferQty(String(order.planned_qty)); }}
                                    >
                                      Передать следующему
                                    </Button>
                                  )}
                                  {stage.transferred_qty && (
                                    <span style={{ fontSize: 12, color: "#10b981", alignSelf: "center" }}>
                                      → Передано: {stage.transferred_qty} шт
                                    </span>
                                  )}
                                  <Button size="sm" variant="success" onClick={() => handleComplete(order, stage)} loading={isLoading}>
                                    Завершить этап
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Done stages (collapsed) */}
                    {doneStages.length > 0 && (
                      <div style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 4 }}>
                        ✓ Выполнено: {doneStages.map(s => s.stage_name || STAGE_TYPE_LABELS[s.stage_type]?.label || s.stage_type).join(", ")}
                      </div>
                    )}

                    {/* Сдать в ОТК когда все этапы выполнены */}
                    {activeStages.length === 0 && doneStages.length > 0 && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
                        <Button onClick={() => { setOtkModal(order); setOtkPhoto(""); }}>
                          Сдать в ОТК
                        </Button>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          Все этапы выполнены
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Transfer modal */}
      <Modal
        open={!!transferModal}
        onClose={() => { setTransferModal(null); setTransferQty(""); }}
        title={`Передача следующему этапу`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setTransferModal(null); setTransferQty(""); }}>Отмена</Button>
            <Button onClick={handleTransfer} loading={transferSaving}>Подтвердить передачу</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 600 }}>{transferModal?.stage.stage_name || transferModal?.stage.stage_type}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
              Заказ #{transferModal?.order.id} — {transferModal?.order.product_name}
            </div>
          </div>
          <div>
            <label>Количество переданных штук *</label>
            <input
              type="number"
              value={transferQty}
              onChange={e => setTransferQty(e.target.value)}
              min="1"
              max={transferModal?.order.planned_qty}
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              План: {transferModal?.order.planned_qty} шт
            </div>
          </div>
        </div>
      </Modal>

      {/* Submit to OTK modal */}
      <Modal
        open={!!otkModal}
        onClose={() => { setOtkModal(null); setOtkPhoto(""); }}
        title={`Сдать в ОТК — #${otkModal?.id} ${otkModal?.product_name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setOtkModal(null); setOtkPhoto(""); }}>Отмена</Button>
            <Button onClick={handleSubmitOtk} loading={submittingOtk === otkModal?.id}>Сдать в ОТК</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label>Фото готового изделия (необязательно)</label>
            <input
              value={otkPhoto}
              onChange={e => setOtkPhoto(e.target.value)}
              placeholder="Вставьте ссылку на фото..."
            />
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Загрузите фото в облако и вставьте ссылку, либо оставьте пустым
            </div>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
