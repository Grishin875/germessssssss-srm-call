"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { AppLayout } from "../../../components/layout/AppLayout";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Badge, PriorityBadge } from "../../../components/ui/Badge";
import { Modal } from "../../../components/ui/Modal";
import { api, Order, Batch, OtkBatch, OrderStage, Operator, Recipe, Component, CustomFieldDef, StageAssignee } from "../../../lib/api";
import { useStageTypes } from "../../../hooks/useStageTypes";
import { toast } from "../../../components/ui/Toast";
import { printRouteSheet } from "../../../lib/printDoc";
import { StageFlow } from "../../../components/ui/StageFlow";
import { RouteTemplate } from "../../../lib/api";

const STATUS_STAGE: Record<string, { label: string; color: string }> = {
  pending:     { label: "Ожидает",  color: "#6b7280" },
  in_progress: { label: "В работе", color: "#0ea5e9" },
  done:        { label: "Готово",   color: "#10b981" },
  blocked:     { label: "Заблок.",  color: "#f97316" },
  paused:      { label: "Пауза",    color: "#a855f7" },
};

function StageBadge({ status }: { status: string }) {
  const s = STATUS_STAGE[status] ?? STATUS_STAGE.pending;
  return (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 600,
      padding: "2px 8px", borderRadius: 20,
      background: s.color + "22", color: s.color,
    }}>{s.label}</span>
  );
}

const TABS = [
  { key: "info",     label: "Информация" },
  { key: "stages",   label: "Этапы" },
  { key: "batches",  label: "Партии" },
  { key: "comments", label: "Комментарии" },
  { key: "history",  label: "История" },
];

export default function OrderDetailPage() {
  const { user, loading, hasPermission } = useAuth();
  const { labelMap: STAGE_TYPE_LABELS } = useStageTypes();
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);

  const [tab, setTab] = useState<"info" | "stages" | "batches" | "comments" | "history">("info");
  const [auditLog, setAuditLog] = useState<import("../../../lib/api").AuditLogItem[]>([]);
  const [comments, setComments] = useState<import("../../../lib/api").OrderComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentSaving, setCommentSaving] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [customFieldDefs, setCustomFieldDefs] = useState<CustomFieldDef[]>([]);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [customFieldEditing, setCustomFieldEditing] = useState(false);
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<Order & { batches?: Batch[]; otk_batches?: OtkBatch[] } | null>(null);
  const [stages, setStages] = useState<OrderStage[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [allUsers, setAllUsers] = useState<import("../../../lib/api").User[]>([]);
  const [allRecipes, setAllRecipes] = useState<Recipe[]>([]);
  const [allComponents, setAllComponents] = useState<Component[]>([]);
  const [fetching, setFetching] = useState(true);
  const [stagesFetching, setStagesFetching] = useState(false);

  const [showStartModal, setShowStartModal] = useState(false);
  const [starting, setStarting] = useState(false);

  const [assignStage, setAssignStage] = useState<OrderStage | null>(null);
  const [assignOpId, setAssignOpId] = useState("");
  const [availableAssignees, setAvailableAssignees] = useState<{ id: number; username: string; full_name?: string; role: string }[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Мульти-исполнители этапов
  const [stageAssignees, setStageAssignees] = useState<Record<number, StageAssignee[]>>({});
  const [showAddAssignee, setShowAddAssignee] = useState<OrderStage | null>(null);
  const [addAssigneeUserId, setAddAssigneeUserId] = useState("");
  const [addAssigneeQty, setAddAssigneeQty] = useState("");
  const [addAssigneeSaving, setAddAssigneeSaving] = useState(false);

  // Управление этапами
  const [showAddStage, setShowAddStage] = useState(false);
  const [editStageModal, setEditStageModal] = useState<OrderStage | null>(null);
  const [stageForm, setStageForm] = useState({ stage_name: "", stage_type: "assembly", required_role: "", sort_order: "0", instructions: "", next_stage_id: "", est_minutes: "", result_photo: "", checklist: "" });
  const [stageSaving, setStageSaving] = useState(false);

  // Раздел B: drag-reorder, шаблоны маршрутов, пауза
  const [dragStageId, setDragStageId] = useState<number | null>(null);
  const [routeTemplates, setRouteTemplates] = useState<RouteTemplate[]>([]);
  const [pauseModal, setPauseModal] = useState<OrderStage | null>(null);
  const [pauseReason, setPauseReason] = useState("");

  // Маршрутизатор этапов (выбор следующего шага)
  const [routeStage, setRouteStage] = useState<OrderStage | null>(null);
  const [routeExisting, setRouteExisting] = useState<{ id: number; stage_type: string; stage_name: string; status: string; sort_order: number }[]>([]);
  const [routeMode, setRouteMode] = useState<"existing" | "new">("new");
  const [routeExistingId, setRouteExistingId] = useState("");
  const [routeForm, setRouteForm] = useState({ stage_type: "otk", stage_name: "", required_role: "", instructions: "" });
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeSaving, setRouteSaving] = useState(false);

  // Гейты контроля качества (AOI / ОТК) канонического маршрута
  const [gateModal, setGateModal] = useState<OrderStage | null>(null);
  const [gateComment, setGateComment] = useState("");
  const [gateNeedsComp, setGateNeedsComp] = useState(false);
  const [gateSaving, setGateSaving] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  useEffect(() => {
    if (!user || !id) return;
    api.getOrder(id).then(setOrder).catch(console.error).finally(() => setFetching(false));
    api.getOperators().then(setOperators).catch(console.error);
    api.getUsers().then(setAllUsers).catch(console.error);
    api.getRecipes().then(setAllRecipes).catch(console.error);
    api.getComponents().then(setAllComponents).catch(console.error);
    api.getCustomFieldDefs().then(setCustomFieldDefs).catch(console.error);
    api.getOrderCustomFields(id).then(setCustomFieldValues).catch(console.error);
    loadStages();
    loadTemplates();
  }, [user, id]);

  async function loadStages() {
    setStagesFetching(true);
    try {
      const s = await api.getOrderStages(id);
      setStages(s);
      // Load assignees for all stages in parallel
      const entries = await Promise.all(
        s.map(async (st) => {
          try { return [st.id, await api.getStageAssignees(id, st.id)] as [number, StageAssignee[]]; }
          catch { return [st.id, []] as [number, StageAssignee[]]; }
        })
      );
      setStageAssignees(Object.fromEntries(entries));
    } catch {}
    setStagesFetching(false);
  }

  async function openAddAssignee(stage: OrderStage) {
    setShowAddAssignee(stage);
    setAddAssigneeUserId("");
    setAddAssigneeQty(String(order?.planned_qty ?? 0));
    setError("");
    setAvailableAssignees([]);
    setAssigneesLoading(true);
    try { setAvailableAssignees(await api.getAvailableAssignees(id, stage.id)); } catch {}
    setAssigneesLoading(false);
  }

  async function doAddAssignee() {
    if (!showAddAssignee || !addAssigneeUserId) { setError("Выберите исполнителя"); return; }
    setAddAssigneeSaving(true); setError("");
    try {
      const uid = Number(addAssigneeUserId);
      const av = availableAssignees.find(u => u.id === uid);
      const uname = av ? (av.full_name || av.username) : addAssigneeUserId;
      await api.addStageAssignee(id, showAddAssignee.id, { user_id: uid, user_name: uname, qty_planned: Number(addAssigneeQty) || 0 });
      setShowAddAssignee(null);
      await loadStages();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setAddAssigneeSaving(false);
  }

  async function doRemoveAssignee(stage: OrderStage, userId: number) {
    if (!confirm("Убрать исполнителя с этапа?")) return;
    try {
      await api.removeStageAssignee(id, stage.id, userId);
      await loadStages();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function doStartAssigneeWork(stage: OrderStage, userId: number) {
    try {
      await api.startAssigneeWork(id, stage.id, userId);
      await loadStages();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function doCompleteAssigneeWork(stage: OrderStage, userId: number, qtyPlanned: number) {
    const qtyStr = prompt(`Сколько штук выполнено? (план: ${qtyPlanned})`, String(qtyPlanned));
    if (qtyStr === null) return;
    const qty = Number(qtyStr);
    if (isNaN(qty)) { toast.error("Введите число"); return; }
    try {
      await api.completeAssigneeWork(id, stage.id, userId, qty);
      await loadStages();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  const writeoffRows = useMemo(() => {
    if (!order) return [];
    const stockMap: Record<string, number> = {};
    allComponents.forEach(c => { stockMap[c.name] = c.stock ?? 0; });
    const recipes = allRecipes.filter(r => r.product_name === order.product_name);
    return recipes.map(r => {
      const needed = Math.ceil(r.norm * order.planned_qty);
      const warehouseName = r.warehouse_component_name || r.component_name;
      const available = stockMap[warehouseName] ?? stockMap[r.component_name] ?? 0;
      const after = available - needed;
      return { name: r.component_name, production_type: r.production_type, needed, available, after, ok: after >= 0 };
    });
  }, [order, allRecipes, allComponents]);

  async function confirmStart() {
    if (!order) return;
    setStarting(true);
    try {
      await api.startOrder(order.id);
      const o = await api.getOrder(id);
      setOrder(o);
      await loadStages();
      setShowStartModal(false);
      setTab("stages");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setStarting(false);
  }

  async function openAssign(stage: OrderStage) {
    setAssignStage(stage);
    setAssignOpId(stage.assigned_to || "");
    setError("");
    setAvailableAssignees([]);
    setAssigneesLoading(true);
    try { setAvailableAssignees(await api.getAvailableAssignees(id, stage.id)); } catch {}
    setAssigneesLoading(false);
  }

  async function doAssign() {
    if (!assignStage || !assignOpId) { setError("Выберите исполнителя"); return; }
    setSaving(true); setError("");
    try {
      let name = assignOpId;
      const av = availableAssignees.find(u => String(u.id) === assignOpId);
      if (av) {
        name = av.full_name || av.username;
      } else {
        const op = operators.find(o => o.employee_id === assignOpId);
        const usr = allUsers.find(u => String(u.id) === assignOpId);
        name = op?.name ?? usr?.full_name ?? usr?.username ?? assignOpId;
      }
      await api.assignStage(id, assignStage.id, assignOpId, name);
      setAssignStage(null);
      await loadStages();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function handleStartStage(stage: OrderStage) {
    try {
      await api.startStage(id, stage.id);
      await loadStages();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function completeStage(stage: OrderStage, openRouter = false) {
    if (!confirm(`Завершить этап "${stage.stage_name || stage.stage_type}"?`)) return;
    try {
      await api.completeStage(id, stage.id);
      await loadStages();
      // Если у этапа не задан следующий шаг — предложить маршрутизатор
      if (openRouter && !stage.next_stage_id && hasPermission("orders.edit")) {
        openRoute(stage);
      }
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  // ── Гейты контроля качества (AOI / ОТК) ─────────────────────────────
  const GATE_LABEL: Record<string, string> = { aoi: "AOI", otk: "ОТК" };
  async function inspectPass(stage: OrderStage) {
    if (!confirm(`Принять «${stage.stage_name || stage.stage_type}» как годный?`)) return;
    try {
      await api.inspectStage(id, stage.id, { result: "pass" });
      await loadStages();
      api.getOrder(id).then(setOrder).catch(() => {});
      toast.success("Этап принят, маршрут продолжен");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  function openGateFail(stage: OrderStage) {
    setGateModal(stage); setGateComment(""); setGateNeedsComp(false);
  }
  async function submitGateFail() {
    if (!gateModal) return;
    setGateSaving(true);
    try {
      await api.inspectStage(id, gateModal.id, {
        result: "fail",
        comment: gateComment.trim() || undefined,
        needs_components: gateModal.stage_type === "otk" ? gateNeedsComp : undefined,
      });
      setGateModal(null);
      await loadStages();
      api.getOrder(id).then(setOrder).catch(() => {});
      toast.warning("Брак: заказ возвращён на доработку");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    finally { setGateSaving(false); }
  }

  async function openRoute(stage: OrderStage) {
    setRouteStage(stage);
    setRouteExisting([]);
    setRouteExistingId("");
    setRouteForm({ stage_type: "otk", stage_name: "", required_role: "", instructions: "" });
    setError("");
    setRouteLoading(true);
    try {
      const opts = await api.getRouteOptions(id, stage.id);
      setRouteExisting(opts.existing_stages || []);
      // Если есть незавершённые этапы — по умолчанию режим "существующий"
      setRouteMode((opts.existing_stages || []).length > 0 ? "existing" : "new");
      if ((opts.existing_stages || []).length > 0) setRouteExistingId(String(opts.existing_stages[0].id));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setRouteLoading(false);
  }

  async function doRouteNext() {
    if (!routeStage) return;
    if (routeMode === "existing" && !routeExistingId) { setError("Выберите этап"); return; }
    setRouteSaving(true); setError("");
    try {
      if (routeMode === "existing") {
        await api.routeNext(id, routeStage.id, { action: "existing", next_stage_id: Number(routeExistingId) });
      } else {
        await api.routeNext(id, routeStage.id, {
          action: "new",
          stage_type: routeForm.stage_type,
          stage_name: routeForm.stage_name.trim() || undefined,
          required_role: routeForm.required_role || undefined,
          instructions: routeForm.instructions.trim() || undefined,
        });
      }
      setRouteStage(null);
      await loadStages();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setRouteSaving(false);
  }

  async function saveStage() {
    setStageSaving(true);
    try {
      const data = {
        stage_name: stageForm.stage_name.trim(),
        stage_type: stageForm.stage_type,
        required_role: stageForm.required_role || undefined,
        sort_order: Number(stageForm.sort_order),
        instructions: stageForm.instructions || undefined,
        next_stage_id: stageForm.next_stage_id ? Number(stageForm.next_stage_id) : undefined,
        est_minutes: stageForm.est_minutes ? Number(stageForm.est_minutes) : undefined,
        result_photo: stageForm.result_photo || undefined,
      } as Record<string, unknown>;
      // Чек-лист: строки → [{text, done}] с сохранением отметок при редактировании
      const lines = stageForm.checklist.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length || editStageModal) {
        let prev: { text: string; done: boolean }[] = [];
        try { prev = JSON.parse(editStageModal?.checklist || "[]"); } catch {}
        data.checklist = lines.map(text => ({ text, done: prev.find(p => p.text === text)?.done ?? false }));
      }
      if (editStageModal) {
        await api.updateOrderStage(id, editStageModal.id, data as never);
      } else {
        await api.addOrderStage(id, data as never);
      }
      setShowAddStage(false);
      setEditStageModal(null);
      setStageForm({ stage_name: "", stage_type: "assembly", required_role: "", sort_order: "0", instructions: "", next_stage_id: "", est_minutes: "", result_photo: "", checklist: "" });
      await loadStages();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setStageSaving(false);
  }

  async function removeStage(stage: OrderStage) {
    if (!confirm(`Удалить этап "${stage.stage_name || stage.stage_type}"?`)) return;
    try {
      await api.deleteOrderStage(id, stage.id);
      await loadStages();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  function openEditStage(stage: OrderStage) {
    setEditStageModal(stage);
    setStageForm({
      stage_name: stage.stage_name || "",
      stage_type: stage.stage_type,
      required_role: stage.required_role || "",
      sort_order: String(stage.sort_order),
      instructions: stage.instructions || "",
      next_stage_id: stage.next_stage_id ? String(stage.next_stage_id) : "",
      est_minutes: stage.est_minutes ? String(stage.est_minutes) : "",
      result_photo: stage.result_photo || "",
      checklist: (() => { try { return (JSON.parse(stage.checklist || "[]") as { text: string }[]).map(i => i.text).join("\n"); } catch { return ""; } })(),
    });
    setShowAddStage(true);
  }

  // ── Раздел B: reorder / pause / checklist / шаблоны ────────────────────────
  async function doReorderStages(newOrder: number[]) {
    try { setStages(await api.reorderStages(id, newOrder)); toast.success("Порядок этапов обновлён"); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); await loadStages(); }
  }
  function onStageDrop(targetId: number) {
    if (dragStageId == null || dragStageId === targetId) { setDragStageId(null); return; }
    const ids = stages.map(s => s.id);
    const from = ids.indexOf(dragStageId), to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragStageId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDragStageId(null);
    doReorderStages(ids);
  }
  async function doPauseStage() {
    if (!pauseModal) return;
    try {
      await api.pauseStage(id, pauseModal.id, pauseReason.trim());
      setPauseModal(null); setPauseReason("");
      await loadStages();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function doResumeStage(stage: OrderStage) {
    try { await api.resumeStage(id, stage.id); await loadStages(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function toggleChecklistItem(stage: OrderStage, idx: number) {
    let items: { text: string; done: boolean }[] = [];
    try { items = JSON.parse(stage.checklist || "[]"); } catch {}
    if (!items[idx]) return;
    items[idx].done = !items[idx].done;
    try { await api.updateOrderStage(id, stage.id, { checklist: items } as never); await loadStages(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function saveAsTemplate() {
    const name = prompt("Название шаблона маршрута:");
    if (!name?.trim()) return;
    try { await api.createRouteTemplate({ name: name.trim(), from_order_id: id }); toast.success("Шаблон сохранён"); loadTemplates(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function applyTemplate(tid: number) {
    if (!confirm("Добавить этапы из шаблона к заказу?")) return;
    try { setStages(await api.applyRouteTemplate(id, tid)); toast.success("Этапы добавлены"); await loadStages(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function genCanonical() {
    if (stages.length > 0 && !confirm("Заменить текущие этапы каноническим маршрутом по ТЗ (12 этапов)? Признаки изделия берутся из каталога.")) return;
    try {
      const r = await api.generateCanonicalStages(id, { replace: true });
      await loadStages();
      api.getOrder(id).then(setOrder).catch(() => {});
      toast.success(`Маршрут по ТЗ построен: ${r.created} этап(ов)`);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function loadTemplates() {
    try { setRouteTemplates(await api.getRouteTemplates()); } catch {}
  }

  if (loading || !user) return null;
  if (fetching) return <AppLayout><div className="text-center py-20" style={{ color: "var(--text-muted)" }}>Загрузка...</div></AppLayout>;
  if (!order) return <AppLayout><div className="text-center py-20" style={{ color: "var(--text-muted)" }}>Заказ не найден</div></AppLayout>;

  const tabStyle = (key: string): React.CSSProperties => ({
    padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer",
    fontWeight: 600, fontSize: 14, transition: "all 0.15s",
    background: tab === key ? "var(--primary)" : "transparent",
    color: tab === key ? "#fff" : "var(--text-secondary)",
  });

  const hasShortage = writeoffRows.some(r => !r.ok);

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Button variant="ghost" size="sm" onClick={() => router.back()}>← Назад</Button>
          <h1 style={{ margin: 0 }}>{order.product_name}</h1>
          <Badge status={order.status} />
          {order.priority && <PriorityBadge priority={order.priority} />}
          {!!order.otk_attempts && order.otk_attempts > 0 && (
            <span title="Количество возвратов с ОТК" style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 20, background: order.otk_attempts >= 3 ? "#ef444420" : "#f59e0b20", color: order.otk_attempts >= 3 ? "#ef4444" : "#f59e0b" }}>
              ОТК-возвраты: {order.otk_attempts}
            </span>
          )}
          <Button variant="secondary" size="sm" style={{ marginLeft: "auto" }} onClick={() => router.push(`/chat?order=${order.id}`)}>💬 Чат заказа</Button>
          <Button variant="secondary" size="sm" onClick={() => printRouteSheet({
            orderId: order.id,
            productName: order.product_name,
            plannedQty: order.planned_qty,
            priority: order.priority,
            deadline: order.deadline,
            department: order.assigned_department,
            comment: order.comment,
            createdAt: order.created_at,
            stages: stages.map((s, i) => ({
              idx: i + 1,
              name: s.stage_name || STAGE_TYPE_LABELS[s.stage_type]?.label || s.stage_type,
              type: STAGE_TYPE_LABELS[s.stage_type]?.label || s.stage_type,
              status: STATUS_STAGE[s.status]?.label || s.status,
              assignees: (stageAssignees[s.id] ?? []).map(a => a.user_name || `#${a.user_id}`),
            })),
          })}>🖨 Маршрутный лист</Button>
        </div>

        {order.status === "Доработка" && order.otk_comment && (
          <div style={{ padding: "14px 18px", borderRadius: 10, background: "#ef444415", border: "1px solid #ef444440" }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "#ef4444", marginBottom: 4 }}>⚠ Возвращён с ОТК на доработку</div>
            <div style={{ fontSize: 14, color: "var(--text-secondary)" }}>{order.otk_comment}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 4, background: "var(--bg-secondary)", padding: 4, borderRadius: 10, width: "fit-content" }}>
          {TABS.map(t => (
            <button key={t.key} style={tabStyle(t.key)} onClick={() => {
            setTab(t.key as "info" | "stages" | "batches" | "comments" | "history");
            if (t.key === "comments" && comments.length === 0) {
              api.getOrderComments(id).then(setComments).catch(console.error);
            }
            if (t.key === "history" && auditLog.length === 0) {
              api.getAuditLog({ entity_type: "order", entity_id: id, limit: 100 })
                .then(setAuditLog).catch(console.error);
              api.getAuditLog({ entity_type: "stage", limit: 100 })
                .then(rows => setAuditLog(prev => {
                  const orderRows = rows.filter(r => {
                    try { return JSON.parse(r.details || "{}").order_id === id; } catch { return false; }
                  });
                  return [...prev, ...orderRows].sort((a, b) =>
                    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                  );
                })).catch(console.error);
            }
          }}>
              {t.label}
              {t.key === "stages" && stages.length > 0 && (
                <span style={{ marginLeft: 6, background: "rgba(255,255,255,0.3)", borderRadius: 10, padding: "0 5px", fontSize: 11 }}>
                  {stages.filter(s => s.status !== "done").length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Info Tab */}
        {tab === "info" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
            <Card title="Информация о заказе">
              <dl style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
                {([
                  ["ID", `#${order.id}`],
                  ["Изделие", order.product_name],
                  ["Количество", `${order.planned_qty} шт`],
                  ["Фактически", `${order.actual_qty ?? 0} шт`],
                  ["Приоритет", <PriorityBadge key="p" priority={order.priority} />],
                  ["Срок", order.deadline ? new Date(order.deadline).toLocaleDateString("ru") : "—"],
                  ["Отдел", order.assigned_department || "—"],
                  ["Оператор", order.assigned_operator_name || "—"],
                  ["Создан", new Date(order.created_at).toLocaleString("ru")],
                  ["Комментарий", order.comment || "—"],
                ] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                    <dt style={{ color: "var(--text-secondary)" }}>{k}</dt>
                    <dd style={{ fontWeight: 500, textAlign: "right" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <div style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {order.status === "Создан" && hasPermission("orders.start") && (
                  <Button onClick={() => setShowStartModal(true)}>Запустить в работу</Button>
                )}
                {hasPermission("orders.delete") && !["Завершен"].includes(order.status) && (
                  <Button variant="danger" size="sm" onClick={async () => {
                    if (confirm("Отменить заказ?")) { await api.deleteOrder(order.id); router.push("/orders"); }
                  }}>Отменить</Button>
                )}
              </div>
            </Card>

            {customFieldDefs.length > 0 && (
              <Card title="Дополнительные поля">
                <dl style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 14 }}>
                  {customFieldDefs.map(def => {
                    const val = customFieldValues[String(def.id)] ?? "";
                    return (
                      <div key={def.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
                        <dt style={{ color: "var(--text-secondary)" }}>{def.label}</dt>
                        {customFieldEditing ? (
                          def.field_type === "select" ? (
                            <select value={customFieldDraft[String(def.id)] ?? val} onChange={e => setCustomFieldDraft(d => ({ ...d, [def.id]: e.target.value }))} style={{ minWidth: 120 }}>
                              <option value="">—</option>
                              {def.options.map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              type={def.field_type === "date" ? "date" : def.field_type === "number" ? "number" : "text"}
                              value={customFieldDraft[String(def.id)] ?? val}
                              onChange={e => setCustomFieldDraft(d => ({ ...d, [def.id]: e.target.value }))}
                              style={{ minWidth: 120, textAlign: "right" }}
                            />
                          )
                        ) : (
                          <dd style={{ fontWeight: 500, textAlign: "right" }}>{val || "—"}</dd>
                        )}
                      </div>
                    );
                  })}
                </dl>
                {hasPermission("orders.edit") && (
                  <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
                    {customFieldEditing ? (
                      <>
                        <Button size="sm" onClick={async () => {
                          await api.setOrderCustomFields(id, customFieldDraft);
                          setCustomFieldValues(v => ({ ...v, ...customFieldDraft }));
                          setCustomFieldEditing(false);
                        }}>Сохранить</Button>
                        <Button size="sm" variant="secondary" onClick={() => { setCustomFieldEditing(false); setCustomFieldDraft({}); }}>Отмена</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => { setCustomFieldDraft({}); setCustomFieldEditing(true); }}>Редактировать</Button>
                    )}
                  </div>
                )}
              </Card>
            )}
          </div>
        )}

        {/* Stages Tab */}
        {tab === "stages" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Карта маршрута */}
            {stages.length > 0 && (
              <Card title="Маршрут производства">
                <StageFlow stages={stages} labelOf={s => s.stage_name || STAGE_TYPE_LABELS[s.stage_type]?.label || s.stage_type} />
              </Card>
            )}

            {/* Панель действий: шаблоны + добавление */}
            {hasPermission("orders.edit") && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                {routeTemplates.length > 0 && (
                  <select value="" onChange={e => e.target.value && applyTemplate(Number(e.target.value))} style={{ maxWidth: 200 }}>
                    <option value="">Применить шаблон…</option>
                    {routeTemplates.map(t => <option key={t.id} value={t.id}>{t.name} ({t.stages.length})</option>)}
                  </select>
                )}
                {stages.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={saveAsTemplate}>★ Сохранить как шаблон</Button>
                )}
                <Button size="sm" variant="secondary" onClick={genCanonical} title="Построить канонический маршрут по ТЗ (12 этапов)">⚙ Маршрут по ТЗ</Button>
                <Button size="sm" onClick={() => {
                  setEditStageModal(null);
                  setStageForm({ stage_name: "", stage_type: "assembly", required_role: "", sort_order: String(stages.length), instructions: "", next_stage_id: "", est_minutes: "", result_photo: "", checklist: "" });
                  setShowAddStage(true);
                }}>+ Добавить этап</Button>
              </div>
            )}
            {hasPermission("orders.edit") && stages.length > 1 && (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>↕ Перетаскивайте этапы за «⠿», чтобы изменить порядок</div>
            )}

            {stagesFetching ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка этапов...</div>
            ) : stages.length === 0 ? (
              <Card>
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                  <div style={{ marginBottom: 16 }}>Этапы ещё не созданы</div>
                  {hasPermission("orders.start") && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                      <Button size="sm" onClick={async () => {
                        try { setStages(await api.generateOrderStages(id)); } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
                      }}>Сгенерировать из рецептуры</Button>
                      <Button size="sm" variant="secondary" onClick={genCanonical}>⚙ Маршрут по ТЗ</Button>
                    </div>
                  )}
                </div>
              </Card>
            ) : (
              stages.map((stage, idx) => {
                const typeInfo = STAGE_TYPE_LABELS[stage.stage_type] ?? { label: stage.stage_type, color: "#6b7280" };
                const isActive = stage.status === "in_progress" || stage.status === "pending";
                const isMyStage = stage.assigned_to === String(user.id);
                const nextStage = stage.next_stage_id ? stages.find(s => s.id === stage.next_stage_id) : null;
                const myAssignees = stageAssignees[stage.id] ?? [];
                const myAssigneeRow = myAssignees.find(a => a.user_id === user.id);
                const isInAssigneeList = !!myAssigneeRow;
                const canReorder = hasPermission("orders.edit") && stage.status !== "in_progress";
                const checklistItems: { text: string; done: boolean }[] = (() => {
                  try { return JSON.parse(stage.checklist || "[]"); } catch { return []; }
                })();
                const elapsedMin = stage.started_at
                  ? Math.round(((stage.completed_at ? new Date(stage.completed_at) : new Date()).getTime() - new Date(stage.started_at).getTime()) / 60000)
                  : null;
                return (
                  <div
                    key={stage.id}
                    draggable={canReorder}
                    onDragOver={canReorder ? (e) => e.preventDefault() : undefined}
                    onDrop={canReorder ? () => onStageDrop(stage.id) : undefined}
                    style={{ opacity: dragStageId === stage.id ? 0.5 : 1 }}
                  >
                  <Card>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                      {canReorder && (
                        <span
                          onDragStart={() => setDragStageId(stage.id)}
                          onDragEnd={() => setDragStageId(null)}
                          draggable
                          title="Перетащить для изменения порядка"
                          style={{ cursor: "grab", color: "var(--text-muted)", fontSize: 18, lineHeight: "36px", userSelect: "none", flexShrink: 0 }}
                        >⠿</span>
                      )}
                      <div style={{
                        width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: stage.status === "done" ? "#10b98120" : typeInfo.color + "20",
                        color: stage.status === "done" ? "#10b981" : typeInfo.color,
                        fontWeight: 700, fontSize: 14,
                      }}>
                        {stage.status === "done" ? "✓" : idx + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 15 }}>{stage.stage_name || typeInfo.label}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: typeInfo.color + "20", color: typeInfo.color }}>
                            {typeInfo.label}
                          </span>
                          <StageBadge status={stage.status} />
                          {/* Следующий этап */}
                          {nextStage && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              → {nextStage.stage_name || STAGE_TYPE_LABELS[nextStage.stage_type]?.label || nextStage.stage_type}
                            </span>
                          )}
                        </div>
                        {/* Мета: норматив / фактическое время */}
                        {(stage.est_minutes || elapsedMin != null) && (
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                            {stage.est_minutes ? <span>⏱ Норматив: {stage.est_minutes} мин</span> : null}
                            {elapsedMin != null ? (
                              <span style={{ color: stage.est_minutes && elapsedMin > stage.est_minutes ? "#ef4444" : "inherit" }}>
                                {stage.status === "done" ? "Факт" : "Идёт"}: {elapsedMin} мин
                                {stage.est_minutes && elapsedMin > stage.est_minutes ? ` (+${elapsedMin - stage.est_minutes})` : ""}
                              </span>
                            ) : null}
                          </div>
                        )}
                        {/* Причина паузы */}
                        {stage.status === "paused" && (
                          <div style={{ fontSize: 12, color: "#a855f7", marginBottom: 6 }}>
                            ⏸ На паузе{stage.pause_reason ? `: ${stage.pause_reason}` : ""}
                          </div>
                        )}
                        {/* Чек-лист этапа */}
                        {checklistItems.length > 0 && (
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                              Чек-лист: {checklistItems.filter(c => c.done).length}/{checklistItems.length}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                              {checklistItems.map((c, ci) => (
                                <label key={ci} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: hasPermission("orders.edit") ? "pointer" : "default" }}>
                                  <input type="checkbox" checked={c.done} disabled={!hasPermission("orders.edit")} onChange={() => toggleChecklistItem(stage, ci)} style={{ width: 14, height: 14 }} />
                                  <span style={{ textDecoration: c.done ? "line-through" : "none", color: c.done ? "var(--text-muted)" : "inherit" }}>{c.text}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        {/* Фото результата */}
                        {stage.result_photo && (
                          <a href={stage.result_photo} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--primary)", display: "inline-block", marginBottom: 6 }}>📷 Фото результата</a>
                        )}
                        {/* Список исполнителей */}
                        {myAssignees.length > 0 ? (
                          <div style={{ marginBottom: 8 }}>
                            {myAssignees.map(a => {
                              const STATUS_COLOR: Record<string, string> = { pending: "#6b7280", in_progress: "#0ea5e9", done: "#10b981" };
                              const isSelf = a.user_id === user.id;
                              return (
                                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 4, padding: "4px 8px", borderRadius: 8, background: isSelf ? "#f0fdf4" : "var(--bg-secondary)" }}>
                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR[a.status] ?? "#6b7280", flexShrink: 0 }} />
                                  <span style={{ fontWeight: isSelf ? 600 : 400 }}>{a.user_name || `User #${a.user_id}`}</span>
                                  {isSelf && <span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>(вы)</span>}
                                  <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>
                                    {a.qty_done}/{a.qty_planned} шт
                                  </span>
                                  {/* Кнопки исполнителя */}
                                  {isSelf && a.status === "pending" && (
                                    <Button size="sm" onClick={() => doStartAssigneeWork(stage, a.user_id)} style={{ fontSize: 11, padding: "2px 8px" }}>Начать</Button>
                                  )}
                                  {isSelf && a.status === "in_progress" && (
                                    <Button size="sm" variant="success" onClick={() => doCompleteAssigneeWork(stage, a.user_id, a.qty_planned)} style={{ fontSize: 11, padding: "2px 8px" }}>Сдать</Button>
                                  )}
                                  {hasPermission("orders.edit") && a.status !== "in_progress" && (
                                    <button onClick={() => doRemoveAssignee(stage, a.user_id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : stage.assigned_name ? (
                          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 6 }}>
                            Исполнитель: <span style={{ fontWeight: 500, color: "var(--text-primary)" }}>{stage.assigned_name}</span>
                            {isMyStage && <span style={{ marginLeft: 6, fontSize: 11, color: "#10b981", fontWeight: 600 }}>(вы)</span>}
                          </div>
                        ) : (
                          <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 6 }}>Исполнители не назначены</div>
                        )}
                        {stage.components && stage.components.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>Компоненты:</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {stage.components.map((c, ci) => (
                                <span key={ci} style={{
                                  fontSize: 12, padding: "2px 8px", borderRadius: 6,
                                  background: "var(--bg-secondary)", color: "var(--text-secondary)",
                                  border: "1px solid var(--border)",
                                }}>{c.name} × {c.qty}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                          {/* Гейт контроля качества (AOI / ОТК): принять или вернуть брак */}
                          {(stage.stage_type === "aoi" || stage.stage_type === "otk")
                            && (stage.status === "pending" || stage.status === "in_progress")
                            && (hasPermission("otk.view") || user?.role === "admin" || user?.role === "manager" || user?.role === "operator_otk" || isMyStage) && (
                            <>
                              <Button size="sm" variant="success" onClick={() => inspectPass(stage)}>
                                ✓ {GATE_LABEL[stage.stage_type] ?? "Контроль"}: годен
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => openGateFail(stage)}>
                                ✗ Брак
                              </Button>
                            </>
                          )}
                          {/* + Добавить исполнителя */}
                          {isActive && hasPermission("orders.edit") && (
                            <Button size="sm" variant="secondary" onClick={() => openAddAssignee(stage)}>
                              + Исполнитель
                            </Button>
                          )}
                          {/* Старый механизм назначения (primary assignee) */}
                          {isActive && hasPermission("orders.edit") && (
                            <Button size="sm" variant="ghost" onClick={() => openAssign(stage)}>
                              {stage.assigned_to ? "Смен. осн." : "Назначить (осн.)"}
                            </Button>
                          )}
                          {/* Кнопки для пользователя по старому assigned_to (если нет в списке исполнителей) */}
                          {isMyStage && !isInAssigneeList && stage.status === "pending" && (
                            <Button size="sm" onClick={() => handleStartStage(stage)}>Начать работу</Button>
                          )}
                          {((isMyStage && !isInAssigneeList) || hasPermission("orders.edit")) && stage.status === "in_progress" && (
                            <Button size="sm" variant="success" onClick={() => completeStage(stage, true)}>Завершить всё</Button>
                          )}
                          {/* Пауза / возобновление */}
                          {hasPermission("orders.edit") && stage.status === "in_progress" && (
                            <Button size="sm" variant="ghost" onClick={() => { setPauseModal(stage); setPauseReason(""); }}>⏸ Пауза</Button>
                          )}
                          {hasPermission("orders.edit") && stage.status === "paused" && (
                            <Button size="sm" variant="secondary" onClick={() => doResumeStage(stage)}>▶ Возобновить</Button>
                          )}
                          {/* Админ/руководитель может принудительно завершить заблокированный этап
                              (например, этап ОТК, ожидающий повторной сдачи после доработки) */}
                          {hasPermission("orders.edit") && (stage.status === "blocked" || stage.status === "paused") && (
                            <Button size="sm" variant="success" onClick={() => completeStage(stage, true)}>Завершить (админ)</Button>
                          )}
                          {/* Маршрутизатор: выбрать следующий шаг */}
                          {hasPermission("orders.edit") && stage.status === "done" && !stage.next_stage_id && (
                            <Button size="sm" variant="secondary" onClick={() => openRoute(stage)}>→ Следующий шаг</Button>
                          )}
                          {/* Редактировать / Удалить этап */}
                          {hasPermission("orders.edit") && stage.status !== "in_progress" && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => openEditStage(stage)}>Изменить</Button>
                              <Button size="sm" variant="ghost" onClick={() => removeStage(stage)} style={{ color: "var(--danger)" }}>Удалить</Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Batches Tab */}
        {tab === "batches" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
            <Card title="Партии производства">
              {!order.batches || order.batches.length === 0 ? (
                <p style={{ color: "var(--text-muted)", fontSize: 14 }}>Нет партий</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {order.batches.map(b => (
                    <div key={b.batch_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)", borderRadius: 8, padding: "10px 14px" }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>{b.batch_id}</p>
                        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{b.production_type} · {b.planned_qty} шт</p>
                      </div>
                      <Badge status={b.status} />
                    </div>
                  ))}
                </div>
              )}
            </Card>
            {order.otk_batches && order.otk_batches.length > 0 && (
              <Card title="Партии ОТК">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {order.otk_batches.map(b => (
                    <div key={b.batch_id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg-secondary)", borderRadius: 8, padding: "10px 14px" }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>{b.batch_id}</p>
                        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Годных: {b.good_qty ?? 0} · Брак: {b.defect_qty ?? 0}</p>
                      </div>
                      <Badge status={b.status} />
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Comments Tab */}
        {tab === "comments" && (
          <Card title="Комментарии">
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {comments.length === 0 && (
                <div style={{ color: "var(--text-muted)", fontSize: 14, textAlign: "center", padding: "12px 0" }}>
                  Комментариев пока нет
                </div>
              )}
              {comments.map(c => (
                <div key={c.id} style={{
                  padding: "12px 14px", borderRadius: 8, background: "var(--bg-secondary)",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{c.user_name || "—"}</span>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {new Date(c.created_at).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {(user?.role === "admin" || user?.role === "manager" || String(user?.id) === String(c.user_id)) && (
                        <button
                          onClick={async () => {
                            if (!confirm("Удалить комментарий?")) return;
                            await api.deleteOrderComment(id, c.id);
                            setComments(prev => prev.filter(x => x.id !== c.id));
                          }}
                          style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12 }}
                        >✕</button>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{c.text}</div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 4, position: "relative" }}>
                {/* Автодополнение @упоминаний */}
                {mentionQuery !== null && (() => {
                  const matches = allUsers.filter(u => u.is_active &&
                    (u.username.toLowerCase().includes(mentionQuery.toLowerCase()) ||
                     (u.full_name || "").toLowerCase().includes(mentionQuery.toLowerCase()))).slice(0, 6);
                  if (!matches.length) return null;
                  return (
                    <div style={{ position: "absolute", bottom: "100%", left: 0, marginBottom: 6, background: "var(--bg-primary)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 100, minWidth: 220, overflow: "hidden" }}>
                      {matches.map(u => (
                        <div key={u.id} onMouseDown={e => {
                          e.preventDefault();
                          setCommentText(t => t.replace(/@[A-Za-z0-9_.\-]*$/, `@${u.username} `));
                          setMentionQuery(null);
                        }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--bg-secondary)"}
                          onMouseLeave={e => e.currentTarget.style.background = ""}>
                          <span style={{ fontWeight: 600 }}>@{u.username}</span>
                          {u.full_name && <span style={{ color: "var(--text-muted)" }}>{u.full_name}</span>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <textarea
                  value={commentText}
                  onChange={e => {
                    setCommentText(e.target.value);
                    const m = e.target.value.slice(0, e.target.selectionStart ?? e.target.value.length).match(/@([A-Za-z0-9_.\-]*)$/);
                    setMentionQuery(m ? m[1] : null);
                  }}
                  placeholder="Написать комментарий... (@имя — упомянуть)"
                  rows={2}
                  style={{ flex: 1, resize: "vertical" }}
                  onKeyDown={async e => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      if (!commentText.trim() || commentSaving) return;
                      setCommentSaving(true);
                      try {
                        const c = await api.addOrderComment(id, commentText.trim());
                        setComments(prev => [...prev, c]);
                        setCommentText("");
                      } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Ошибка"); }
                      setCommentSaving(false);
                    }
                  }}
                />
                <Button
                  onClick={async () => {
                    if (!commentText.trim() || commentSaving) return;
                    setCommentSaving(true);
                    try {
                      const c = await api.addOrderComment(id, commentText.trim());
                      setComments(prev => [...prev, c]);
                      setCommentText("");
                    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : "Ошибка"); }
                    setCommentSaving(false);
                  }}
                  loading={commentSaving}
                  disabled={!commentText.trim()}
                >Отправить</Button>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Ctrl+Enter для отправки</div>
            </div>
          </Card>
        )}

        {/* History Tab */}
        {tab === "history" && (
          <Card title="История изменений">
            {auditLog.length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: 14, padding: "20px 0", textAlign: "center" }}>
                Нет записей
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {auditLog.map(entry => {
                  const actionLabels: Record<string, string> = {
                    created: "Создан",
                    updated: "Обновлён",
                    status_changed: "Статус изменён",
                    cancelled: "Отменён",
                    started: "Запущен",
                    stage_assigned: "Исполнитель назначен",
                    stage_started: "Этап начат",
                    stage_completed: "Этап завершён",
                  };
                  return (
                    <div key={entry.id} style={{
                      display: "flex", gap: 12, padding: "10px 14px",
                      borderRadius: 8, background: "var(--bg-secondary)",
                      fontSize: 13,
                    }}>
                      <div style={{ flexShrink: 0, width: 120, color: "var(--text-muted)" }}>
                        {new Date(entry.created_at).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div style={{ flexShrink: 0, width: 130, fontWeight: 500 }}>{entry.user_name || "—"}</div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600 }}>{actionLabels[entry.action] || entry.action}</span>
                        {entry.old_value && entry.new_value && (
                          <span style={{ color: "var(--text-secondary)" }}>
                            {" "}· {entry.old_value} → {entry.new_value}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Модалка добавления/редактирования этапа */}
      <Modal
        open={showAddStage}
        onClose={() => { setShowAddStage(false); setEditStageModal(null); }}
        title={editStageModal ? "Редактировать этап" : "Добавить этап"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowAddStage(false); setEditStageModal(null); }}>Отмена</Button>
            <Button onClick={saveStage} loading={stageSaving}>{editStageModal ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label>Название этапа *</label>
            <input value={stageForm.stage_name} onChange={e => setStageForm(f => ({ ...f, stage_name: e.target.value }))} placeholder="Например: Пайка СМД" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Отдел</label>
              <select value={stageForm.stage_type} onChange={e => setStageForm(f => ({ ...f, stage_type: e.target.value }))}>
                {Object.entries(STAGE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label>Роль исполнителя</label>
              <select value={stageForm.required_role} onChange={e => setStageForm(f => ({ ...f, required_role: e.target.value }))}>
                <option value="">— Любой —</option>
                <option value="operator_smd">Оператор СМД</option>
                <option value="montažnik">Монтажник</option>
                <option value="operator_3d">Оператор 3D</option>
                <option value="operator_engraving">Гравёр</option>
                <option value="operator_otk">Оператор ОТК</option>
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Порядок</label>
              <input type="number" value={stageForm.sort_order} onChange={e => setStageForm(f => ({ ...f, sort_order: e.target.value }))} min="0" />
            </div>
            <div>
              <label>Следующий этап (куда идёт после)</label>
              <select value={stageForm.next_stage_id} onChange={e => setStageForm(f => ({ ...f, next_stage_id: e.target.value }))}>
                <option value="">— Не указан —</option>
                {stages
                  .filter(s => !editStageModal || s.id !== editStageModal.id)
                  .map(s => (
                    <option key={s.id} value={String(s.id)}>
                      {s.stage_name || STAGE_TYPE_LABELS[s.stage_type]?.label || s.stage_type}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Норматив времени (мин)</label>
              <input type="number" value={stageForm.est_minutes} onChange={e => setStageForm(f => ({ ...f, est_minutes: e.target.value }))} min="0" placeholder="напр. 60" />
            </div>
            <div>
              <label>Фото результата (URL)</label>
              <input value={stageForm.result_photo} onChange={e => setStageForm(f => ({ ...f, result_photo: e.target.value }))} placeholder="ссылка на фото" />
            </div>
          </div>
          <div>
            <label>Инструкция для исполнителя</label>
            <textarea
              value={stageForm.instructions}
              onChange={e => setStageForm(f => ({ ...f, instructions: e.target.value }))}
              rows={3}
              placeholder="Что нужно сделать..."
            />
          </div>
          <div>
            <label>Чек-лист (по одному пункту на строку)</label>
            <textarea
              value={stageForm.checklist}
              onChange={e => setStageForm(f => ({ ...f, checklist: e.target.value }))}
              rows={3}
              placeholder={"Проверить пайку\nОчистить плату\nТест включения"}
            />
          </div>
        </div>
      </Modal>

      {/* Pause modal */}
      <Modal
        open={pauseModal !== null}
        onClose={() => setPauseModal(null)}
        title={`Пауза этапа «${pauseModal?.stage_name || pauseModal?.stage_type || ""}»`}
        footer={<><Button variant="secondary" onClick={() => setPauseModal(null)}>Отмена</Button><Button onClick={doPauseStage}>Поставить на паузу</Button></>}
      >
        <div>
          <label>Причина паузы</label>
          <textarea value={pauseReason} onChange={e => setPauseReason(e.target.value)} rows={2} placeholder="Напр.: ожидание компонентов, поломка оборудования..." />
        </div>
      </Modal>

      {/* Гейт: возврат брака на доработку */}
      <Modal
        open={gateModal !== null}
        onClose={() => setGateModal(null)}
        title={`Брак на «${gateModal?.stage_name || (gateModal && GATE_LABEL[gateModal.stage_type]) || ""}»`}
        footer={<><Button variant="secondary" onClick={() => setGateModal(null)}>Отмена</Button><Button variant="danger" loading={gateSaving} onClick={submitGateFail}>Вернуть на доработку</Button></>}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            {gateModal?.stage_type === "otk"
              ? "Заказ вернётся в «Сборку РЭА». Опишите причину брака."
              : "Изделие вернётся на «СМД-монтаж» для переделки, затем снова на AOI."}
          </div>
          <div>
            <label>Причина / описание брака</label>
            <textarea value={gateComment} onChange={e => setGateComment(e.target.value)} rows={3} placeholder="Напр.: непропай, смещение компонента, неверная полярность..." />
          </div>
          {gateModal?.stage_type === "otk" && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={gateNeedsComp} onChange={e => setGateNeedsComp(e.target.checked)} />
              Нужны дополнительные компоненты (заказ → «Ожидает компонентов»)
            </label>
          )}
        </div>
      </Modal>

      {/* Start modal */}
      <Modal
        open={showStartModal}
        onClose={() => setShowStartModal(false)}
        title="Запустить в производство"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowStartModal(false)}>Отмена</Button>
            <Button onClick={confirmStart} loading={starting} disabled={hasShortage}>
              {hasShortage ? "Недостаточно компонентов" : "Подтвердить запуск"}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 10, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{order.product_name}</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>{order.planned_qty} шт · <PriorityBadge priority={order.priority} /></div>
            </div>
          </div>
          {writeoffRows.length > 0 ? (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>Будет списано со склада</div>
              <div style={{ padding: "8px 12px", borderRadius: 8, marginBottom: 10, background: hasShortage ? "#ef444415" : "#10b98115", border: `1px solid ${hasShortage ? "#ef444440" : "#10b98140"}`, fontSize: 13, fontWeight: 600, color: hasShortage ? "#ef4444" : "#10b981" }}>
                {hasShortage ? "⚠ Не хватает компонентов — запуск невозможен" : "✓ Компонентов достаточно"}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["Компонент", "Тип", "Спишется", "На складе", "Остаток"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "3px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {writeoffRows.map(r => (
                      <tr key={r.name} style={{ background: r.ok ? "" : "#ef444408" }}>
                        <td style={{ padding: "5px 8px", fontSize: 13, fontWeight: 500 }}>{r.name}</td>
                        <td style={{ padding: "5px 8px", fontSize: 12, color: "var(--text-muted)" }}>{r.production_type}</td>
                        <td style={{ padding: "5px 8px", fontSize: 13 }}>{r.needed}</td>
                        <td style={{ padding: "5px 8px", fontSize: 13, color: r.ok ? "var(--text-secondary)" : "#f59e0b", fontWeight: 500 }}>{r.available}</td>
                        <td style={{ padding: "5px 8px", fontSize: 13, fontWeight: 700, color: r.ok ? "#10b981" : "#ef4444" }}>{r.ok ? `+${r.after}` : r.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 16 }}>Рецептура для этого изделия не найдена</div>
          )}
        </div>
      </Modal>

      {/* Assign modal */}
      {assignStage && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", paddingLeft: 248 }}
          onClick={() => setAssignStage(null)}>
          <div style={{ background: "var(--bg-primary)", borderRadius: 14, padding: 28, minWidth: 360, maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              Назначить исполнителя — {assignStage.stage_name || assignStage.stage_type}
            </h2>
            {error && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 13 }}>{error}</div>}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                Исполнитель
                {assignStage?.required_role && (
                  <span style={{ marginLeft: 8, fontSize: 11, color: "#6366f1", fontWeight: 500 }}>
                    (нужна роль: {assignStage.required_role})
                  </span>
                )}
              </label>
              {assigneesLoading ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>Загрузка...</div>
              ) : (
                <select value={assignOpId} onChange={e => setAssignOpId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— выбрать —</option>
                  {availableAssignees.length > 0 ? (
                    availableAssignees.map(u => (
                      <option key={u.id} value={String(u.id)}>{u.full_name || u.username} ({u.role})</option>
                    ))
                  ) : (
                    <>
                      {operators.map(op => (
                        <option key={op.employee_id} value={op.employee_id}>{op.name} ({op.role})</option>
                      ))}
                    </>
                  )}
                </select>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setAssignStage(null)}>Отмена</Button>
              <Button onClick={doAssign} loading={saving}>Назначить</Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Assignee modal */}
      {showAddAssignee && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", paddingLeft: 248 }}
          onClick={() => setShowAddAssignee(null)}>
          <div style={{ background: "var(--bg-primary)", borderRadius: 14, padding: 28, minWidth: 380, maxWidth: 500, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
            onClick={e => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>
              + Исполнитель — {showAddAssignee.stage_name || showAddAssignee.stage_type}
            </h2>
            {error && <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 13 }}>{error}</div>}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>Исполнитель</label>
              {assigneesLoading ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Загрузка...</div>
              ) : (
                <select value={addAssigneeUserId} onChange={e => setAddAssigneeUserId(e.target.value)} style={{ width: "100%" }}>
                  <option value="">— Выберите —</option>
                  {availableAssignees.map(u => (
                    <option key={u.id} value={String(u.id)}>{u.full_name || u.username} ({u.role})</option>
                  ))}
                </select>
              )}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 13, color: "var(--text-secondary)" }}>Количество (шт)</label>
              <input type="number" min="0" value={addAssigneeQty} onChange={e => setAddAssigneeQty(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setShowAddAssignee(null)}>Отмена</Button>
              <Button onClick={doAddAssignee} loading={addAssigneeSaving}>Добавить</Button>
            </div>
          </div>
        </div>
      )}

      {/* Маршрутизатор этапов — выбор следующего шага */}
      <Modal
        open={!!routeStage}
        onClose={() => setRouteStage(null)}
        title={`Следующий шаг после «${routeStage?.stage_name || routeStage?.stage_type || ""}»`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRouteStage(null)}>Отмена</Button>
            <Button onClick={doRouteNext} loading={routeSaving} disabled={routeLoading}>Направить</Button>
          </>
        }
      >
        {routeLoading ? (
          <div style={{ textAlign: "center", padding: 24, color: "var(--text-muted)" }}>Загрузка вариантов...</div>
        ) : (
          <div className="space-y-3">
            {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 13 }}>{error}</div>}

            {/* Переключатель режима */}
            <div style={{ display: "flex", gap: 4, background: "var(--bg-secondary)", padding: 4, borderRadius: 10 }}>
              {([["existing", "Существующий этап"], ["new", "Новый этап"]] as [typeof routeMode, string][]).map(([m, lbl]) => (
                <button
                  key={m}
                  onClick={() => setRouteMode(m)}
                  disabled={m === "existing" && routeExisting.length === 0}
                  style={{
                    flex: 1, padding: "8px 12px", borderRadius: 8, border: "none",
                    cursor: m === "existing" && routeExisting.length === 0 ? "not-allowed" : "pointer",
                    fontWeight: 600, fontSize: 13, transition: "all 0.15s",
                    opacity: m === "existing" && routeExisting.length === 0 ? 0.4 : 1,
                    background: routeMode === m ? "var(--primary)" : "transparent",
                    color: routeMode === m ? "#fff" : "var(--text-secondary)",
                  }}
                >{lbl}</button>
              ))}
            </div>

            {routeMode === "existing" ? (
              routeExisting.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
                  Нет других незавершённых этапов — создайте новый.
                </div>
              ) : (
                <div>
                  <label>Направить на этап</label>
                  <select value={routeExistingId} onChange={e => setRouteExistingId(e.target.value)}>
                    {routeExisting.map(s => (
                      <option key={s.id} value={String(s.id)}>
                        {s.stage_name || STAGE_TYPE_LABELS[s.stage_type]?.label || s.stage_type}
                        {" · "}{STATUS_STAGE[s.status]?.label ?? s.status}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                    Выбранный этап будет активирован и помечен следующим.
                  </div>
                </div>
              )
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label>Тип этапа</label>
                    <select value={routeForm.stage_type} onChange={e => setRouteForm(f => ({ ...f, stage_type: e.target.value }))}>
                      {Object.entries(STAGE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Роль исполнителя</label>
                    <select value={routeForm.required_role} onChange={e => setRouteForm(f => ({ ...f, required_role: e.target.value }))}>
                      <option value="">— Любой —</option>
                      <option value="operator_smd">Оператор СМД</option>
                      <option value="montažnik">Монтажник</option>
                      <option value="operator_3d">Оператор 3D</option>
                      <option value="operator_engraving">Гравёр</option>
                      <option value="operator_otk">Оператор ОТК</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label>Название этапа</label>
                  <input value={routeForm.stage_name} onChange={e => setRouteForm(f => ({ ...f, stage_name: e.target.value }))} placeholder="Напр.: Контроль ОТК" />
                </div>
                <div>
                  <label>Инструкция</label>
                  <textarea value={routeForm.instructions} onChange={e => setRouteForm(f => ({ ...f, instructions: e.target.value }))} rows={2} placeholder="Что нужно сделать..." />
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
