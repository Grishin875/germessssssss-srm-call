"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge, PriorityBadge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, Order, OtkBatch, OtkReport, RegulationProblem } from "../../lib/api";
import { useAutoRefresh } from "../../lib/useAutoRefresh";
import { useStageTypes } from "../../hooks/useStageTypes";
import { toast } from "../../components/ui/Toast";

function fmt(d: Date) { return d.toISOString().slice(0, 10); }

export default function OtkPage() {
  const { user, loading } = useAuth();
  const { labelMap: STAGE_TYPE_LABELS } = useStageTypes();
  const router = useRouter();

  const [tab, setTab] = useState<"pending" | "batches" | "regulations" | "reports">("pending");

  // Order-level OTK (main workflow)
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [ordFetching, setOrdFetching] = useState(true);
  const [returnModal, setReturnModal] = useState<Order | null>(null);
  const [returnComment, setReturnComment] = useState("");
  const [returnPhoto, setReturnPhoto] = useState("");
  const [returnStageType, setReturnStageType] = useState("");
  const [actionSaving, setActionSaving] = useState<number | null>(null);
  const [returnSaving, setReturnSaving] = useState(false);

  // Batch-level OTK (technical quality check)
  const [batches, setBatches] = useState<OtkBatch[]>([]);
  const [fetchingBatches, setFetchingBatches] = useState(true);
  const [checkModal, setCheckModal] = useState<OtkBatch | null>(null);
  const [result, setResult] = useState<1 | 2 | 3>(1);
  const [goodQty, setGoodQty] = useState("");
  const [defectQty, setDefectQty] = useState("");
  const [defectComment, setDefectComment] = useState("");
  const [reworkStageType, setReworkStageType] = useState("");
  const [otkId, setOtkId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [regProducts, setRegProducts] = useState<string[]>([]);
  const [regProduct, setRegProduct] = useState("");
  const [regProblems, setRegProblems] = useState<RegulationProblem[]>([]);
  const [regFetching, setRegFetching] = useState(false);

  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  const [reportFrom, setReportFrom] = useState(fmt(weekAgo));
  const [reportTo, setReportTo] = useState(fmt(today));
  const [report, setReport] = useState<OtkReport | null>(null);
  const [reportFetching, setReportFetching] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    if (tab === "pending" && user.role !== "operator_otk") loadOrders();
    if (tab === "batches") loadBatches();
    if (tab === "regulations") api.getRegulationProducts().then(setRegProducts).catch(console.error);
  }, [user, tab]);

  // Оператор ОТК сразу грузит партии
  useEffect(() => {
    if (user?.role === "operator_otk") {
      setTab("batches");
      loadBatches();
    }
  }, [user]);

  useAutoRefresh(() => {
    if (tab === "pending" && user?.role !== "operator_otk") loadOrders();
    if (tab === "batches") loadBatches();
  }, 30000, !!user && !returnModal && !checkModal);

  async function loadOrders() {
    setOrdFetching(true);
    try {
      const data = await api.getOrders("На проверке ОТК");
      setPendingOrders(data);
    } catch {}
    setOrdFetching(false);
  }

  async function loadBatches() {
    setFetchingBatches(true);
    try {
      setBatches(await api.getOtkBatches("Принята"));
    } catch {}
    setFetchingBatches(false);
  }

  async function acceptOrder(order: Order) {
    setActionSaving(order.id);
    try {
      await api.updateOrder(order.id, { status: "Готов к отгрузке" });
      loadOrders();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setActionSaving(null);
  }

  async function doReturnOrder() {
    if (!returnModal || !returnComment.trim()) return;
    setReturnSaving(true);
    try {
      const res = await api.returnRework(returnModal.id, {
        comment: returnComment,
        rejection_photo_url: returnPhoto || undefined,
        rework_stage_type: returnStageType || undefined,
      });
      if (res?.rework_stage_id) toast.success("Возвращено исполнителю на доработку");
      else toast.info("Заказ возвращён на доработку (этап для возврата не найден — назначьте вручную)");
      setReturnModal(null);
      setReturnComment("");
      setReturnPhoto("");
      setReturnStageType("");
      loadOrders();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setReturnSaving(false);
  }

  async function forceCloseOrder(order: Order) {
    if (!confirm(`Принудительно завершить заказ #${order.id}? Это действие необратимо.`)) return;
    setActionSaving(order.id);
    try {
      await api.updateOrder(order.id, { status: "Завершен" });
      loadOrders();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setActionSaving(null);
  }

  async function selectRegProduct(product: string) {
    setRegProduct(product);
    if (!product) { setRegProblems([]); return; }
    setRegFetching(true);
    setRegProblems(await api.getRegulationProblems(product));
    setRegFetching(false);
  }

  async function loadReport() {
    setReportFetching(true);
    try { setReport(await api.getOtkReports(reportFrom, reportTo)); } catch { setReport(null); }
    setReportFetching(false);
  }

  async function doCheck() {
    if (!checkModal || !otkId.trim()) { setError("Укажите ID проверяющего"); return; }
    if (result === 3 && !defectComment.trim()) { setError("Укажите комментарий для критичного брака"); return; }
    setSaving(true); setError("");
    try {
      const body: Record<string, unknown> = { batchId: checkModal.batch_id, otkId: otkId.trim(), result };
      if (result === 2) { body.good_qty = Number(goodQty); body.defect_qty = Number(defectQty); body.records = []; }
      if (result === 3) body.defect_comment = defectComment;
      // Возврат брака на конкретный отдел (если ОТК выбрал)
      if ((result === 2 || result === 3) && reworkStageType) body.rework_stage_type = reworkStageType;
      await api.otkCheck(body);
      setCheckModal(null); setOtkId(""); setResult(1); setGoodQty(""); setDefectQty(""); setDefectComment(""); setReworkStageType("");
      loadBatches();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  if (loading || !user) return null;
  const isAdmin = user.role === "admin" || user.role === "manager";
  const isOtkOperator = user.role === "operator_otk";

  const TABS = [
    { key: "pending",     label: "На проверке ОТК",  show: user.role !== "operator_otk" },
    { key: "batches",     label: "Проверка партий",  show: true },
    { key: "regulations", label: "Регламенты",       show: true },
    { key: "reports",     label: "Отчёты",           show: user.role !== "operator_otk" },
  ] as const;

  const resultOptions: { v: 1 | 2 | 3; label: string; color: string; bg: string }[] = [
    { v: 1, label: "Всё годно",        color: "#059669", bg: "rgba(16,185,129,0.08)" },
    { v: 2, label: "Частичный брак",   color: "#d97706", bg: "rgba(245,158,11,0.08)" },
    { v: 3, label: "Критичный брак",   color: "#dc2626", bg: "rgba(239,68,68,0.08)"  },
  ];

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0 }}>ОТК</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>Отдел технического контроля</p>
          </div>
          {(tab === "pending" || tab === "batches") && (
            <Button variant="secondary" size="sm" onClick={tab === "pending" ? loadOrders : loadBatches}>Обновить</Button>
          )}
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 10, padding: 4, gap: 2, width: "fit-content" }}>
          {TABS.filter(t => t.show).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "7px 16px", fontSize: 13, fontWeight: 500, borderRadius: 7,
                border: "none", cursor: "pointer", transition: "all 0.15s",
                background: tab === t.key ? "var(--primary)" : "none",
                color: tab === t.key ? "#fff" : "var(--text-secondary)",
                letterSpacing: "-0.005em",
              }}
            >
              {t.label}
              {t.key === "pending" && pendingOrders.length > 0 && (
                <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.25)", borderRadius: 10, padding: "0 6px", fontSize: 11 }}>
                  {pendingOrders.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Orders pending OTK ─────────────────────────────────────────────── */}
        {tab === "pending" && (
          ordFetching ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--text-muted)" }}>Загрузка...</div>
          ) : pendingOrders.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
                <div style={{ color: "var(--text-muted)", fontSize: 15 }}>Нет заказов на проверке</div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 6 }}>Заказы появятся когда операторы сдадут продукцию</div>
              </div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {pendingOrders.map(order => {
                const isOverdue = order.deadline && new Date(order.deadline) < new Date();
                return (
                  <Card key={order.id}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        {/* Title */}
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                          <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>#{order.id}</span>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{order.product_name}</span>
                          <PriorityBadge priority={order.priority} />
                          <Badge status={order.status} />
                        </div>

                        {/* Details */}
                        <div style={{ display: "flex", gap: 20, fontSize: 13, color: "var(--text-secondary)", flexWrap: "wrap", marginBottom: 10 }}>
                          <span>Кол-во: <b>{order.planned_qty}</b> шт</span>
                          {order.assigned_department && <span>Отдел: <b>{order.assigned_department}</b></span>}
                          {order.assigned_operator_name && <span>Оператор: <b>{order.assigned_operator_name}</b></span>}
                          {order.deadline && (
                            <span style={{ color: isOverdue ? "#ef4444" : undefined }}>
                              Срок: <b>{new Date(order.deadline).toLocaleDateString("ru")}</b>
                              {isOverdue && " (просрочен)"}
                            </span>
                          )}
                        </div>

                        {order.comment && (
                          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8, padding: "6px 10px", background: "var(--bg-secondary)", borderRadius: 6 }}>
                            {order.comment}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
                        <Button
                          size="sm"
                          variant="success"
                          onClick={() => acceptOrder(order)}
                          loading={actionSaving === order.id}
                        >
                          ✓ Принять
                        </Button>
                        <Button
                          size="sm"
                          variant="warning"
                          onClick={() => { setReturnModal(order); setReturnComment(""); setReturnPhoto(""); setReturnStageType(""); }}
                        >
                          ↩ На доработку
                        </Button>
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => forceCloseOrder(order)}
                            loading={actionSaving === order.id}
                          >
                            ⚡ Закрыть принудительно
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => router.push(`/orders/${order.id}`)}>
                          Открыть
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )
        )}

        {/* ── Batch-level quality check ──────────────────────────────────────── */}
        {tab === "batches" && (
          <Card>
            {fetchingBatches ? (
              <div className="text-center py-12">Загрузка...</div>
            ) : batches.length === 0 ? (
              <div className="text-center py-12">Партии не найдены</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      {["ID партии","Изделие","Тип","Выпущено","Годных","Брак","Статус","Действия"].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map(b => (
                      <tr key={b.batch_id}>
                        <td className="font-mono" style={{ fontSize: 12 }}>{b.batch_id}</td>
                        <td style={{ fontWeight: 500 }}>{b.product_name}</td>
                        <td>{b.production_type}</td>
                        <td>{b.released_qty}</td>
                        <td style={{ color: "#059669", fontWeight: 500 }}>{b.good_qty ?? "—"}</td>
                        <td style={{ color: "var(--danger)", fontWeight: 500 }}>{b.defect_qty ?? "—"}</td>
                        <td><Badge status={b.status} /></td>
                        <td>
                          {b.status === "Принята" && (
                            <Button size="sm" onClick={() => {
                              setCheckModal(b); setResult(1);
                              setGoodQty(String(b.released_qty)); setDefectQty("0");
                              setDefectComment(""); setOtkId(""); setError("");
                            }}>
                              Проверить
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* Regulations */}
        {tab === "regulations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Card>
              <div>
                <label>Изделие</label>
                <select value={regProduct} onChange={e => selectRegProduct(e.target.value)}>
                  <option value="">— Выберите изделие —</option>
                  {regProducts.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </Card>
            {!regProduct && <div className="text-center py-12">Выберите изделие</div>}
            {regProduct && regFetching && <div className="text-center py-12">Загрузка...</div>}
            {regProduct && !regFetching && regProblems.length === 0 && (
              <div className="text-center py-12">Регламенты не найдены</div>
            )}
            {regProduct && !regFetching && regProblems.map(rp => (
              <Card key={rp.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <p style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{rp.problem}</p>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{rp.solution}</p>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Reports */}
        {tab === "reports" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <Card>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
                <div>
                  <label>От</label>
                  <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} style={{ width: 160 }} />
                </div>
                <div>
                  <label>До</label>
                  <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} style={{ width: 160 }} />
                </div>
                <Button onClick={loadReport} loading={reportFetching}>Сформировать</Button>
              </div>
            </Card>

            {reportFetching && <div className="text-center py-12">Загрузка...</div>}
            {!reportFetching && report && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                  {[
                    { label: "Партии",   value: report.summary.total_batches },
                    { label: "Годных",   value: report.summary.total_good },
                    { label: "Брак",     value: report.summary.total_defect },
                    { label: "Качество", value: `${report.summary.quality_rate.toFixed(1)}%` },
                  ].map(c => (
                    <div key={c.label} style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 20px", textAlign: "center" }}>
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8, fontWeight: 500 }}>{c.label}</p>
                      <p style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.02em" }}>{c.value}</p>
                    </div>
                  ))}
                </div>
                <Card>
                  {report.batches.length === 0 ? (
                    <div className="text-center py-12">Нет данных за период</div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table>
                        <thead>
                          <tr>
                            {["ID","Изделие","Тип","Выпущено","Годных","Брак","Статус","Дата проверки"].map(h => (
                              <th key={h}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {report.batches.map(b => (
                            <tr key={b.batch_id}>
                              <td className="font-mono" style={{ fontSize: 12 }}>{b.batch_id}</td>
                              <td style={{ fontWeight: 500 }}>{b.product_name}</td>
                              <td>{b.production_type}</td>
                              <td>{b.released_qty}</td>
                              <td style={{ color: "#059669", fontWeight: 500 }}>{b.good_qty ?? "—"}</td>
                              <td style={{ color: "var(--danger)", fontWeight: 500 }}>{b.defect_qty ?? "—"}</td>
                              <td><Badge status={b.status} /></td>
                              <td>{b.check_date ? b.check_date.slice(0, 10) : "—"}</td>
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
        )}
      </div>

      {/* Return to rework modal */}
      <Modal
        open={!!returnModal}
        onClose={() => { setReturnModal(null); setReturnPhoto(""); setReturnStageType(""); }}
        title={`Вернуть на доработку — #${returnModal?.id}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setReturnModal(null); setReturnPhoto(""); }}>Отмена</Button>
            <Button
              variant="warning"
              onClick={doReturnOrder}
              loading={returnSaving}
              disabled={!returnComment.trim()}
            >
              Вернуть на доработку
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "#f59e0b10", border: "1px solid #f59e0b30" }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{returnModal?.product_name}</div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
              Заказ #{returnModal?.id} · {returnModal?.planned_qty} шт
            </div>
          </div>
          <div>
            <label>Причина возврата / комментарий для оператора *</label>
            <textarea
              value={returnComment}
              onChange={e => setReturnComment(e.target.value)}
              rows={3}
              placeholder="Опишите что нужно исправить..."
            />
          </div>
          <div>
            <label>Вернуть на отдел</label>
            <select value={returnStageType} onChange={e => setReturnStageType(e.target.value)}>
              <option value="">Авто (последний этап перед ОТК)</option>
              {Object.entries(STAGE_TYPE_LABELS)
                .filter(([k]) => k !== "otk")
                .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Указанный отдел переделает свою часть и снова сдаст в ОТК.
            </div>
          </div>
          <div>
            <label>Фото брака (необязательно)</label>
            <input
              value={returnPhoto}
              onChange={e => setReturnPhoto(e.target.value)}
              placeholder="Вставьте ссылку на фото брака..."
            />
          </div>
        </div>
      </Modal>

      {/* Batch OTK check modal */}
      <Modal
        open={!!checkModal}
        onClose={() => setCheckModal(null)}
        title={`Проверка ОТК — ${checkModal?.batch_id}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCheckModal(null)}>Отмена</Button>
            <Button onClick={doCheck} loading={saving}>Подтвердить</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>Табельный номер проверяющего *</label>
            <input value={otkId} onChange={e => setOtkId(e.target.value)} />
          </div>
          <div>
            <label style={{ marginBottom: 10 }}>Результат проверки</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {resultOptions.map(({ v, label, color, bg }) => (
                <label key={v} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 9,
                  border: `1.5px solid ${result === v ? color : "var(--border)"}`,
                  background: result === v ? bg : "none", cursor: "pointer", transition: "all 0.12s",
                }}>
                  <input type="radio" name="result" value={v} checked={result === v} onChange={() => setResult(v)} style={{ width: 15, height: 15, accentColor: color }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color }}>{label}</span>
                </label>
              ))}
            </div>
          </div>
          {result === 2 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label>Годных</label><input type="number" value={goodQty} onChange={e => setGoodQty(e.target.value)} min="0" /></div>
              <div><label>Брак</label><input type="number" value={defectQty} onChange={e => setDefectQty(e.target.value)} min="0" /></div>
            </div>
          )}
          {result === 3 && (
            <div>
              <label>Комментарий для старшего оператора *</label>
              <textarea value={defectComment} onChange={e => setDefectComment(e.target.value)} rows={3} />
            </div>
          )}
          {(result === 2 || result === 3) && (
            <div style={{ marginTop: 4 }}>
              <label>Вернуть брак на отдел</label>
              <select value={reworkStageType} onChange={e => setReworkStageType(e.target.value)}>
                <option value="">Авто (последний этап перед ОТК)</option>
                {Object.entries(STAGE_TYPE_LABELS)
                  .filter(([k]) => k !== "otk")
                  .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                Указанный отдел переделает свою часть и снова сдаст в ОТК.
              </div>
            </div>
          )}
        </div>
      </Modal>
    </AppLayout>
  );
}
