"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge, PriorityBadge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, Order, Recipe, Component, User, RecipeStage, ProductCatalogItem, SystemRoleItem } from "../../lib/api";
import { useStageTypes } from "../../hooks/useStageTypes";
import { usePriorities } from "../../hooks/usePriorities";
import { StagesBuilder, StageRow } from "../../components/ui/StagesBuilder";
import { ROLE_LABELS } from "../../lib/roles";
import { exportToExcel, parseExcelFile, downloadTemplate, Row as ExcelRow } from "../../lib/excel";
import { toast } from "../../components/ui/Toast";
import { KanbanBoard } from "../../components/ui/KanbanBoard";
import { CalendarView } from "../../components/ui/CalendarView";
import { SkeletonTable } from "../../components/ui/Skeleton";
import { EmptyState } from "../../components/ui/EmptyState";
import { useI18n } from "../../lib/i18n";

function ProductSelect({ value, onChange, products }: {
  value: string; onChange: (v: string) => void; products: string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filtered = products.filter(p => p.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input value={query} onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} placeholder="Выберите изделие из рецептуры…" />
      {open && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg, #fff)", border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, zIndex: 9999, maxHeight: 220, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
          {filtered.map(p => (
            <div key={p} onMouseDown={() => { setQuery(p); onChange(p); setOpen(false); }}
              style={{ padding: "8px 12px", cursor: "pointer", fontSize: 14 }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-secondary, #f9fafb)")}
              onMouseLeave={e => (e.currentTarget.style.background = "")}>{p}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const { user, loading, hasPermission } = useAuth();
  const { t } = useI18n();
  const { byCode: stageByCode, stageTypes } = useStageTypes();
  const { priorities } = usePriorities();
  const STAGE_TYPE_COLORS: Record<string, string> = Object.fromEntries(
    ["smd","assembly","3d_print","engraving","case","warehouse"].map(c => [c, stageByCode(c).color])
  );
  const router = useRouter();

  const [orders, setOrders] = useState<Order[]>([]);
  const [fetching, setFetching] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [allRecipes, setAllRecipes] = useState<Recipe[]>([]);
  const [allComponents, setAllComponents] = useState<Component[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [catalog, setCatalog] = useState<ProductCatalogItem[]>([]);
  const [systemRoles, setSystemRoles] = useState<SystemRoleItem[]>([]);
  const [customFieldDefs, setCustomFieldDefs] = useState<import("../../lib/api").CustomFieldDef[]>([]);
  const [cfField, setCfField] = useState("");
  const [cfValue, setCfValue] = useState("");

  // Раздел A: фильтры, сортировка, колонки, избранное, пагинация, превью
  const [deptFilter, setDeptFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<string>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  const [kanbanGroupBy, setKanbanGroupBy] = useState<"status" | "department" | "priority">("status");
  const ALL_COLS = ["fav", "id", "product", "qty", "priority", "progress", "deadline", "status", "tags", "department", "created"];
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(ALL_COLS));
  const [showColSettings, setShowColSettings] = useState(false);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  const [orderTemplates, setOrderTemplates] = useState<{ name: string; form: typeof form }[]>([]);
  useEffect(() => {
    try {
      const vc = localStorage.getItem("germess_order_cols");
      if (vc) setVisibleCols(new Set(JSON.parse(vc)));
      const fav = localStorage.getItem("germess_order_favs");
      if (fav) setFavorites(new Set(JSON.parse(fav)));
      const ot = localStorage.getItem("germess_order_templates");
      if (ot) setOrderTemplates(JSON.parse(ot));
    } catch {}
  }, []);
  function toggleCol(c: string) {
    setVisibleCols(s => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); localStorage.setItem("germess_order_cols", JSON.stringify([...n])); return n; });
  }
  function toggleFav(oid: number) {
    setFavorites(s => { const n = new Set(s); n.has(oid) ? n.delete(oid) : n.add(oid); localStorage.setItem("germess_order_favs", JSON.stringify([...n])); return n; });
  }
  function setSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ product_name: "", planned_qty: "", priority: "Обычный", deadline: "", comment: "", assigned_department: "" });
  const [managers, setManagers] = useState<string[]>([]);
  const [stageAssignments, setStageAssignments] = useState<Record<number, string>>({});
  const [skippedStages, setSkippedStages] = useState<Set<number>>(new Set());
  const [productStages, setProductStages] = useState<RecipeStage[]>([]);
  const [productRole, setProductRole] = useState<string | null>(null);
  const [loadingStages, setLoadingStages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [extraStages, setExtraStages] = useState<StageRow[]>([]);
  // Канонический маршрут по ТЗ (12 этапов)
  const [useCanonical, setUseCanonical] = useState(false);
  const [canonFlags, setCanonFlags] = useState({ needs_smd: true, is_receiver: false, needs_assembly: true });

  // Excel импорт
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importRows, setImportRows] = useState<ExcelRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0, errors: 0 });

  // Массовый выбор заказов
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Сохранённые фильтры
  const [savedFilters, setSavedFilters] = useState<{ name: string; status: string; search: string }[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("germess_saved_filters");
      if (raw) setSavedFilters(JSON.parse(raw));
    } catch {}
  }, []);
  function persistFilters(list: { name: string; status: string; search: string }[]) {
    setSavedFilters(list);
    localStorage.setItem("germess_saved_filters", JSON.stringify(list));
  }
  function saveCurrentFilter() {
    if (!statusFilter && !search.trim()) { toast.warning("Нечего сохранять — задайте фильтр"); return; }
    const name = prompt("Название фильтра:", statusFilter || search || "Фильтр");
    if (!name?.trim()) return;
    const next = [...savedFilters.filter(f => f.name !== name.trim()), { name: name.trim(), status: statusFilter, search }];
    persistFilters(next);
    toast.success(`Фильтр «${name.trim()}» сохранён`);
  }

  // Вид отображения: таблица / канбан / календарь
  const [view, setView] = useState<"table" | "kanban" | "calendar">("table");
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  useEffect(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem("germess_orders_view") : null;
    if (v === "kanban" || v === "table" || v === "calendar") setView(v);
  }, []);
  function switchView(v: "table" | "kanban" | "calendar") { setView(v); localStorage.setItem("germess_orders_view", v); }

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => {
    if (!user) return;
    load();
    api.getRecipes().then(setAllRecipes).catch(console.error);
    api.getComponents().then(setAllComponents).catch(console.error);
    api.getUsers().then(setAllUsers).catch(console.error);
    api.getCatalog({ active_only: true }).then(setCatalog).catch(console.error);
    api.getSystemRoles().then(r => setSystemRoles(r.filter(x => x.is_active))).catch(console.error);
    api.getCustomFieldDefs().then(setCustomFieldDefs).catch(console.error);
  }, [user]);

  // Перезагрузка при изменении фильтра по кастомному полю (серверный фильтр)
  useEffect(() => {
    if (!user) return;
    load();
  }, [cfField, cfValue, showArchived]);

  useEffect(() => {
    if (!form.product_name || !allRecipes.find(r => r.product_name === form.product_name)) {
      setProductStages([]); setStageAssignments({}); setProductRole(null); setSkippedStages(new Set()); return;
    }
    setLoadingStages(true);
    // Префилл признаков канонического маршрута из каталога изделия
    api.getCatalog({ q: form.product_name }).then(items => {
      const it = items.find(i => i.name === form.product_name);
      if (it) setCanonFlags({
        needs_smd: it.needs_smd !== false,
        is_receiver: it.is_receiver === true,
        needs_assembly: it.needs_assembly !== false,
      });
    }).catch(() => {});
    api.getProductStages(form.product_name)
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setProductStages(data as RecipeStage[]);
          setProductRole(null);
        } else {
          const d = data as { stages: RecipeStage[]; assigned_role?: string };
          setProductStages(d.stages || []);
          setProductRole(d.assigned_role || null);
        }
        setStageAssignments({});
        setSkippedStages(new Set());
      })
      .catch(() => { setProductStages([]); setProductRole(null); })
      .finally(() => setLoadingStages(false));
  }, [form.product_name]);

  async function load() {
    setFetching(true);
    try {
      const cf = cfField && cfValue.trim() ? { field: Number(cfField), value: cfValue.trim() } : undefined;
      const base = "Создан,В работе,На проверке ОТК,Доработка,Ожидает компонентов,Готов к отгрузке,Отменен";
      const statuses = showArchived ? base + ",Завершен,Завершён,Выполнен" : base;
      const data = await api.getOrders(undefined, undefined, statuses, cf);
      setOrders(data);
    } catch {}
    setFetching(false);
  }

  async function createOrder() {
    if (!form.product_name.trim() || !form.planned_qty) { setError("Заполните обязательные поля"); return; }
    setSaving(true); setError("");
    try {
      // Назначения только для НЕ пропущенных этапов
      const activeAssignments = Object.fromEntries(
        Object.entries(stageAssignments).filter(([sid, v]) => v && !skippedStages.has(Number(sid)))
      );
      const firstAssignment = Object.values(activeAssignments).find(v => v) || "";
      const payload: Record<string, unknown> = {
        ...form,
        planned_qty: Number(form.planned_qty),
        assigned_operator_id: firstAssignment || undefined,
        stage_assignments: Object.keys(activeAssignments).length > 0 ? activeAssignments : undefined,
        skipped_stage_ids: skippedStages.size > 0 ? Array.from(skippedStages) : undefined,
      };
      if (managers.length > 0) payload.managers = managers;
      if (!payload.assigned_operator_id) delete payload.assigned_operator_id;
      if (!payload.stage_assignments) delete payload.stage_assignments;
      if (!payload.skipped_stage_ids) delete payload.skipped_stage_ids;
      if (useCanonical) {
        payload.use_canonical_route = true;
        payload.needs_smd = canonFlags.needs_smd;
        payload.is_receiver = canonFlags.is_receiver;
        payload.needs_assembly = canonFlags.needs_assembly;
      }
      if (extraStages.length > 0) {
        (payload as Record<string, unknown>).extra_stages = extraStages.map(s => ({
          stage_type: s.stage_type,
          stage_name: s.stage_name || s.stage_type,
          assigned_user_id: null,
          sort_order: s.sort_order,
          depends_on_previous: s.depends_on_previous,
          required_role: s.required_role || null,
          components: s.components ?? [],
        }));
      }
      await api.createOrder(payload as Partial<Order>);
      setShowCreate(false);
      setForm({ product_name: "", planned_qty: "", priority: "Обычный", deadline: "", comment: "", assigned_department: "" }); setManagers([]);
      setStageAssignments({}); setProductStages([]); setProductRole(null); setExtraStages([]); setSkippedStages(new Set());
      setUseCanonical(false); setCanonFlags({ needs_smd: true, is_receiver: false, needs_assembly: true });
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  // ── Excel экспорт/импорт ──────────────────────────────────────────────────
  function exportExcel() {
    const rows: ExcelRow[] = filtered.map(o => ({
      "ID": o.id,
      "Изделие": o.product_name,
      "План, шт": o.planned_qty,
      "Факт, шт": o.actual_qty ?? 0,
      "Статус": o.status,
      "Приоритет": o.priority,
      "Срок": o.deadline ? new Date(o.deadline).toLocaleDateString("ru") : "",
      "Отдел": o.assigned_department ?? "",
      "Оператор": o.assigned_operator_name ?? "",
      "Создан": new Date(o.created_at).toLocaleString("ru"),
      "Комментарий": o.comment ?? "",
    }));
    if (!rows.length) { toast.warning("Нет заказов для экспорта"); return; }
    exportToExcel(rows, "Заказы", "Заказы").then(() => toast.success(`Экспортировано: ${rows.length}`));
  }

  function importTemplate() {
    downloadTemplate(
      ["Изделие", "Количество", "Приоритет", "Срок (ГГГГ-ММ-ДД)", "Отдел", "Комментарий"],
      "Шаблон_импорта_заказов",
      { "Изделие": "Плата управления", "Количество": 10, "Приоритет": "Обычный", "Срок (ГГГГ-ММ-ДД)": "2026-07-01", "Отдел": "", "Комментарий": "" }
    );
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = "";
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      const cleaned = rows.filter(r => String(r["Изделие"] ?? r["product_name"] ?? "").trim());
      if (!cleaned.length) { toast.error("В файле не найдено строк с колонкой «Изделие»"); return; }
      setImportRows(cleaned);
      setImportProgress({ done: 0, total: cleaned.length, errors: 0 });
    } catch {
      toast.error("Не удалось прочитать файл. Поддерживаются .xlsx и .csv");
    }
  }

  async function runImport() {
    if (!importRows.length) return;
    setImporting(true);
    let done = 0, errors = 0;
    const priorities = new Set(["Обычный", "Низкий", "Высокий", "Срочный"]);
    for (const r of importRows) {
      try {
        const name = String(r["Изделие"] ?? r["product_name"] ?? "").trim();
        const qty = Number(r["Количество"] ?? r["planned_qty"] ?? 0);
        if (!name || !qty || qty <= 0) throw new Error("bad");
        const prRaw = String(r["Приоритет"] ?? r["priority"] ?? "Обычный").trim();
        const deadlineRaw = String(r["Срок (ГГГГ-ММ-ДД)"] ?? r["Срок"] ?? r["deadline"] ?? "").trim();
        const payload: Partial<Order> = {
          product_name: name,
          planned_qty: qty,
          priority: priorities.has(prRaw) ? prRaw : "Обычный",
          assigned_department: String(r["Отдел"] ?? r["assigned_department"] ?? "").trim() || undefined,
          comment: String(r["Комментарий"] ?? r["comment"] ?? "").trim() || undefined,
        };
        if (deadlineRaw && /^\d{4}-\d{2}-\d{2}/.test(deadlineRaw)) payload.deadline = deadlineRaw;
        await api.createOrder(payload);
        done++;
      } catch { errors++; }
      setImportProgress({ done, total: importRows.length, errors });
    }
    setImporting(false);
    setImportRows([]);
    if (done) toast.success(`Импортировано заказов: ${done}${errors ? `, ошибок: ${errors}` : ""}`);
    else toast.error(`Импорт не удался (ошибок: ${errors})`);
    load();
  }

  // ── Kanban: смена статуса перетаскиванием ──────────────────────────────────
  async function changeOrderStatus(orderId: number, newStatus: string) {
    const ord = orders.find(o => o.id === orderId);
    if (!ord || ord.status === newStatus) return;
    const prev = ord.status;
    // Оптимистичное обновление
    setOrders(list => list.map(o => o.id === orderId ? { ...o, status: newStatus } : o));
    try {
      await api.updateOrder(orderId, { status: newStatus });
      toast.success(`Заказ #${orderId}: ${newStatus}`);
    } catch (e: unknown) {
      setOrders(list => list.map(o => o.id === orderId ? { ...o, status: prev } : o));
      toast.error(e instanceof Error ? e.message : "Не удалось сменить статус");
    }
  }

  // ── Массовые операции ──────────────────────────────────────────────────────
  function toggleSelect(id: number) {
    setSelectedIds(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll(ids: number[]) {
    setSelectedIds(s => ids.every(id => s.has(id)) ? new Set() : new Set(ids));
  }
  async function bulkSetStatus(newStatus: string) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`Сменить статус у ${ids.length} заказ(ов) на «${newStatus}»?`)) return;
    setBulkBusy(true);
    let ok = 0, err = 0;
    for (const id of ids) {
      try { await api.updateOrder(id, { status: newStatus }); ok++; } catch { err++; }
    }
    setBulkBusy(false);
    setSelectedIds(new Set());
    if (ok) toast.success(`Обновлено: ${ok}${err ? `, ошибок: ${err}` : ""}`);
    else toast.error("Не удалось обновить");
    load();
  }
  function bulkExport() {
    const rows: ExcelRow[] = filtered.filter(o => selectedIds.has(o.id)).map(o => ({
      "ID": o.id, "Изделие": o.product_name, "План, шт": o.planned_qty,
      "Статус": o.status, "Приоритет": o.priority,
      "Срок": o.deadline ? new Date(o.deadline).toLocaleDateString("ru") : "",
      "Отдел": o.assigned_department ?? "",
    }));
    if (!rows.length) return;
    exportToExcel(rows, "Заказы_выбранные", "Заказы").then(() => toast.success(`Экспортировано: ${rows.length}`));
  }
  async function bulkPatch(patch: Partial<Order>, label: string) {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`${label} для ${ids.length} заказ(ов)?`)) return;
    setBulkBusy(true);
    let ok = 0, err = 0;
    for (const id of ids) { try { await api.updateOrder(id, patch); ok++; } catch { err++; } }
    setBulkBusy(false); setSelectedIds(new Set());
    if (ok) toast.success(`Готово: ${ok}${err ? `, ошибок: ${err}` : ""}`); else toast.error("Не удалось");
    load();
  }
  async function bulkCancel() {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!confirm(`Отменить ${ids.length} заказ(ов)? Действие необратимо.`)) return;
    setBulkBusy(true);
    let ok = 0, err = 0;
    for (const id of ids) { try { await api.deleteOrder(id); ok++; } catch { err++; } }
    setBulkBusy(false); setSelectedIds(new Set());
    if (ok) toast.success(`Отменено: ${ok}${err ? `, ошибок: ${err}` : ""}`); else toast.error("Не удалось");
    load();
  }
  async function updateTags(o: Order, tags: string[]) {
    const json = JSON.stringify(tags);
    setOrders(list => list.map(x => x.id === o.id ? { ...x, tags: json } : x));
    setPreviewOrder(p => p && p.id === o.id ? { ...p, tags: json } : p);
    try { await api.updateOrder(o.id, { tags: json }); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); load(); }
  }
  async function duplicateOrder(o: Order) {
    try {
      await api.createOrder({
        product_name: o.product_name, planned_qty: o.planned_qty,
        priority: o.priority, deadline: o.deadline,
        comment: o.comment, assigned_department: o.assigned_department,
      });
      toast.success(`Создана копия заказа «${o.product_name}»`);
      load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  function saveOrderTemplate() {
    if (!form.product_name.trim()) { toast.warning("Заполните форму заказа"); return; }
    const name = prompt("Название шаблона заказа:", form.product_name);
    if (!name?.trim()) return;
    const next = [...orderTemplates.filter(t => t.name !== name.trim()), { name: name.trim(), form: { ...form } }];
    setOrderTemplates(next);
    localStorage.setItem("germess_order_templates", JSON.stringify(next));
    toast.success("Шаблон заказа сохранён");
  }
  function applyOrderTemplate(name: string) {
    const t = orderTemplates.find(x => x.name === name);
    if (t) setForm({ ...t.form });
  }
  function printOrderCard(o: Order) {
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) return;
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] || c));
    w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Заказ №${o.id}</title>
    <style>body{font-family:'Segoe UI',Arial,sans-serif;margin:32px;color:#111}h1{margin:0 0 4px}.muted{color:#666;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:16px}td{padding:8px 10px;border-bottom:1px solid #ddd;font-size:14px}td:first-child{color:#666;width:40%}
    @media print{.noprint{display:none}}</style></head><body>
    <div class="noprint" style="margin-bottom:16px"><button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:9px 18px;border-radius:8px;cursor:pointer">🖨 Печать</button></div>
    <h1>Заказ №${o.id}</h1><div class="muted">Печать: ${new Date().toLocaleString("ru")}</div>
    <table>
      <tr><td>Изделие</td><td><b>${esc(o.product_name)}</b></td></tr>
      <tr><td>Количество</td><td>${o.planned_qty} шт</td></tr>
      <tr><td>Статус</td><td>${esc(o.status)}</td></tr>
      <tr><td>Приоритет</td><td>${esc(o.priority)}</td></tr>
      <tr><td>Срок</td><td>${o.deadline ? esc(new Date(o.deadline).toLocaleDateString("ru")) : "—"}</td></tr>
      <tr><td>Отдел</td><td>${esc(o.assigned_department || "—")}</td></tr>
      <tr><td>Оператор</td><td>${esc(o.assigned_operator_name || "—")}</td></tr>
      <tr><td>Создан</td><td>${esc(new Date(o.created_at).toLocaleString("ru"))}</td></tr>
      <tr><td>Комментарий</td><td>${esc(o.comment || "—")}</td></tr>
    </table><script>setTimeout(()=>window.print(),300)</script></body></html>`);
    w.document.close();
  }

  const productNames = useMemo(() => {
    const fromCatalog = catalog.map(c => c.name);
    const fromRecipes = allRecipes.map(r => r.product_name);
    return [...new Set([...fromCatalog, ...fromRecipes])].sort();
  }, [catalog, allRecipes]);

  function getUsersForStage(stage: RecipeStage): User[] {
    if (!stage.required_role) return allUsers.filter(u => u.is_active);
    return allUsers.filter(u => u.is_active && u.role === stage.required_role);
  }

  const demandRows = useMemo(() => {
    const qty = Number(form.planned_qty);
    if (!form.product_name.trim() || !qty || qty <= 0) return [];
    const recipeRows = allRecipes.filter(r => r.product_name === form.product_name);
    if (!recipeRows.length) return [];
    const stockMap: Record<string, number> = {};
    allComponents.forEach(c => { stockMap[c.name] = c.stock ?? 0; });
    return recipeRows.map(r => {
      const required = Math.ceil(r.norm * qty);
      const available = stockMap[r.warehouse_component_name || r.component_name] ?? stockMap[r.component_name] ?? 0;
      return { component_name: r.component_name, required, available, shortage: Math.max(0, required - available) };
    });
  }, [form.product_name, form.planned_qty, allRecipes, allComponents]);

  if (loading || !user) return null;

  const departments = useMemo(() => [...new Set(orders.map(o => o.assigned_department).filter(Boolean) as string[])].sort(), [orders]);
  const operators = useMemo(() => [...new Set(orders.map(o => o.assigned_operator_name).filter(Boolean) as string[])].sort(), [orders]);

  const filtered = useMemo(() => {
    const arr = orders.filter(o => {
      if (statusFilter && o.status !== statusFilter) return false;
      if (search && !o.product_name.toLowerCase().includes(search.toLowerCase()) && !String(o.id).includes(search)) return false;
      if (deptFilter && o.assigned_department !== deptFilter) return false;
      if (operatorFilter && o.assigned_operator_name !== operatorFilter) return false;
      if (dateFrom && new Date(o.created_at) < new Date(dateFrom)) return false;
      if (dateTo && new Date(o.created_at) > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      // Избранные — всегда сверху
      const fa = favorites.has(a.id) ? 1 : 0, fb = favorites.has(b.id) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      let va: string | number = "", vb: string | number = "";
      switch (sortKey) {
        case "id": va = a.id; vb = b.id; break;
        case "product": va = a.product_name.toLowerCase(); vb = b.product_name.toLowerCase(); break;
        case "qty": va = a.planned_qty; vb = b.planned_qty; break;
        case "priority": va = a.priority || ""; vb = b.priority || ""; break;
        case "status": va = a.status; vb = b.status; break;
        case "deadline": va = a.deadline || "9999"; vb = b.deadline || "9999"; break;
        case "progress": va = (a.stages_total ? (a.stages_done || 0) / a.stages_total : -1); vb = (b.stages_total ? (b.stages_done || 0) / b.stages_total : -1); break;
        default: va = a.created_at; vb = b.created_at;
      }
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    return arr;
  }, [orders, statusFilter, search, deptFilter, operatorFilter, dateFrom, dateTo, sortKey, sortDir, favorites]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = filtered.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  const hasShortage = demandRows.some(r => r.shortage > 0);
  const hasAssignment = Object.values(stageAssignments).some(v => v);

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1>{t("orders.title")}</h1>
          {hasPermission("orders.create") && (
            <Button onClick={() => {
              setShowCreate(true); setError("");
              setForm({ product_name: "", planned_qty: "", priority: "Обычный", deadline: "", comment: "", assigned_department: "" }); setManagers([]);
              setStageAssignments({}); setProductStages([]); setProductRole(null); setExtraStages([]); setSkippedStages(new Set());
            }}>{t("orders.create")}</Button>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("orders.search_ph")} style={{ width: 260 }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t("orders.all_active")}</option>
            {["Создан","В работе","На проверке ОТК","Доработка","Ожидает компонентов","Готов к отгрузке","Отменен"].map(s => <option key={s}>{s}</option>)}
          </select>
          {/* Сохранённые фильтры */}
          {savedFilters.length > 0 && (
            <select
              value=""
              onChange={e => {
                const f = savedFilters.find(x => x.name === e.target.value);
                if (f) { setStatusFilter(f.status); setSearch(f.search); }
              }}
              style={{ maxWidth: 180 }}
            >
              <option value="">★ Сохранённые…</option>
              {savedFilters.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          )}
          {/* Фильтр по кастомному полю */}
          {customFieldDefs.length > 0 && (
            <>
              <select value={cfField} onChange={e => { setCfField(e.target.value); if (!e.target.value) setCfValue(""); }} style={{ maxWidth: 170 }}>
                <option value="">Доп. поле…</option>
                {customFieldDefs.map(d => <option key={d.id} value={String(d.id)}>{d.label}</option>)}
              </select>
              {cfField && (
                (() => {
                  const def = customFieldDefs.find(d => String(d.id) === cfField);
                  return def?.field_type === "select" ? (
                    <select value={cfValue} onChange={e => setCfValue(e.target.value)} style={{ maxWidth: 150 }}>
                      <option value="">— значение —</option>
                      {def.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input value={cfValue} onChange={e => setCfValue(e.target.value)} placeholder="значение…" style={{ width: 140 }} />
                  );
                })()
              )}
            </>
          )}
          <Button variant="ghost" size="sm" onClick={saveCurrentFilter} title="Сохранить текущий фильтр">★ Сохранить</Button>
          {(statusFilter || search || cfField) && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(""); setSearch(""); setCfField(""); setCfValue(""); }}>✕ Сброс</Button>
          )}
          {/* Переключатель вида */}
          <div style={{ display: "flex", gap: 2, background: "var(--bg-tertiary)", borderRadius: 8, padding: 3 }}>
            {([["table", "☰ " + t("orders.view_table")], ["kanban", "▦ " + t("orders.view_kanban")], ["calendar", "▤ " + t("orders.view_calendar")]] as ["table" | "kanban" | "calendar", string][]).map(([v, lbl]) => (
              <button key={v} onClick={() => switchView(v)} style={{
                padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 13, fontWeight: 600, transition: "all 0.15s",
                background: view === v ? "var(--bg-secondary)" : "transparent",
                color: view === v ? "var(--primary)" : "var(--text-secondary)",
                boxShadow: view === v ? "var(--shadow-sm)" : "none",
              }}>{lbl}</button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={exportExcel}>⬇ Excel</Button>
            <Button variant="ghost" size="sm" onClick={() => {
              const params = new URLSearchParams();
              if (statusFilter) params.set("status", statusFilter);
              if (search) params.set("search", search);
              window.open(`/api/orders/export${params.toString() ? `?${params}` : ""}`, "_blank");
            }}>⬇ CSV</Button>
            {hasPermission("orders.create") && (
              <Button variant="secondary" size="sm" onClick={() => importInputRef.current?.click()}>⬆ Импорт Excel</Button>
            )}
            <input ref={importInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onImportFile} style={{ display: "none" }} />
          </div>
        </div>

        {/* Вторая строка фильтров */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
          {departments.length > 0 && (
            <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={{ maxWidth: 160 }}>
              <option value="">{t("orders.all_depts")}</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          {operators.length > 0 && (
            <select value={operatorFilter} onChange={e => setOperatorFilter(e.target.value)} style={{ maxWidth: 170 }}>
              <option value="">{t("orders.all_ops")}</option>
              {operators.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}
          <span style={{ color: "var(--text-muted)" }}>Создан:</span>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="с" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="по" />
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", color: showArchived ? "var(--primary)" : "var(--text-muted)", fontWeight: showArchived ? 600 : 400 }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} style={{ width: 14, height: 14 }} />
            🗄 Архив
          </label>
          {(deptFilter || operatorFilter || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setDeptFilter(""); setOperatorFilter(""); setDateFrom(""); setDateTo(""); }}>✕</Button>
          )}
          {view === "table" && (
            <Button variant="ghost" size="sm" onClick={() => setShowColSettings(true)} style={{ marginLeft: "auto" }}>⚙ {t("orders.columns")}</Button>
          )}
          {view === "kanban" && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--text-muted)" }}>Группировка:</span>
              <select value={kanbanGroupBy} onChange={e => setKanbanGroupBy(e.target.value as typeof kanbanGroupBy)}>
                <option value="status">по статусу</option>
                <option value="department">по отделу</option>
                <option value="priority">по приоритету</option>
              </select>
            </div>
          )}
          <span style={{ color: "var(--text-muted)" }}>{t("orders.found")}: {filtered.length}</span>
        </div>

        {/* Панель массовых действий */}
        {view === "table" && selectedIds.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderRadius: 10, background: "var(--primary-light)", border: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Выбрано: {selectedIds.size}</span>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>Статус:</span>
            {["В работе", "На проверке ОТК", "Готов к отгрузке", "Завершен"].map(s => (
              <Button key={s} size="sm" variant="secondary" disabled={bulkBusy} onClick={() => bulkSetStatus(s)}>{s}</Button>
            ))}
            <select disabled={bulkBusy} value="" onChange={e => e.target.value && bulkPatch({ priority: e.target.value }, `Приоритет «${e.target.value}»`)} style={{ maxWidth: 130 }}>
              <option value="">Приоритет…</option>
              {priorities.filter(p => p.is_active).map(p => <option key={p.code} value={p.label}>{p.label}</option>)}
            </select>
            <select disabled={bulkBusy} value="" onChange={e => e.target.value && bulkPatch({ assigned_department: e.target.value }, `Отдел «${e.target.value}»`)} style={{ maxWidth: 130 }}>
              <option value="">Отдел…</option>
              {departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={bulkExport}>⬇ Excel</Button>
            {hasPermission("orders.delete") && (
              <Button size="sm" variant="danger" disabled={bulkBusy} onClick={bulkCancel}>Отменить</Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())} style={{ marginLeft: "auto" }}>Снять выбор</Button>
          </div>
        )}

        {view === "table" ? (
        <Card>
          {fetching ? <SkeletonTable rows={8} cols={7} /> : filtered.length === 0 ? (
            <EmptyState icon="📋" title={t("orders.not_found")}
              description={statusFilter || search || deptFilter || cfField ? "Измените или сбросьте фильтры." : "Создайте первый заказ на производство."}
              action={hasPermission("orders.create") ? <Button onClick={() => { setShowCreate(true); setError(""); }}>{t("orders.create")}</Button> : undefined}
            />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox"
                        checked={paged.length > 0 && paged.every(o => selectedIds.has(o.id))}
                        onChange={() => toggleSelectAll(paged.map(o => o.id))}
                        style={{ cursor: "pointer", width: 15, height: 15 }} />
                    </th>
                    {visibleCols.has("fav") && <th style={{ width: 28 }}></th>}
                    {([
                      ["id", "ID"], ["product", "Изделие"], ["qty", "Кол-во"], ["priority", "Приоритет"],
                      ["progress", "Прогресс"], ["deadline", "Срок"], ["status", "Статус"], ["tags", "Метки"],
                      ["department", "Отдел"], ["created", "Создан"],
                    ] as [string, string][]).filter(([k]) => visibleCols.has(k)).map(([k, label]) => {
                      const sortable = ["id", "product", "qty", "priority", "progress", "deadline", "status", "created"].includes(k);
                      const skey = k === "product" ? "product" : k === "created" ? "created_at" : k;
                      return (
                        <th key={k} onClick={sortable ? () => setSort(skey) : undefined} style={{ cursor: sortable ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}>
                          {label}{sortable && sortKey === skey ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </th>
                      );
                    })}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(o => {
                    const isOverdue = o.deadline && !["Завершен","Завершён","Выполнен","Отменен","Отменён"].includes(o.status)
                      && new Date(o.deadline) < new Date();
                    const sel = selectedIds.has(o.id);
                    const tags: string[] = (() => { try { return JSON.parse(o.tags || "[]"); } catch { return []; } })();
                    const pct = o.stages_total ? Math.round((o.stages_done || 0) / o.stages_total * 100) : null;
                    return (
                    <tr key={o.id} style={{ ...(isOverdue ? { background: "var(--danger-light)" } : {}), ...(sel ? { background: "var(--primary-light)" } : {}) }}>
                      <td><input type="checkbox" checked={sel} onChange={() => toggleSelect(o.id)} style={{ cursor: "pointer", width: 15, height: 15 }} /></td>
                      {visibleCols.has("fav") && (
                        <td><button onClick={() => toggleFav(o.id)} title="В избранное" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, color: favorites.has(o.id) ? "#f59e0b" : "var(--border)" }}>{favorites.has(o.id) ? "★" : "☆"}</button></td>
                      )}
                      {visibleCols.has("id") && <td className="font-mono">#{o.id}</td>}
                      {visibleCols.has("product") && <td style={{ fontWeight: 500 }}>{o.product_name}</td>}
                      {visibleCols.has("qty") && <td>{o.planned_qty} шт</td>}
                      {visibleCols.has("priority") && <td><PriorityBadge priority={o.priority} /></td>}
                      {visibleCols.has("progress") && (
                        <td style={{ minWidth: 90 }}>
                          {pct == null ? <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span> : (
                            <div title={`${o.stages_done}/${o.stages_total} этапов`}>
                              <div style={{ height: 6, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                                <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#10b981" : "var(--primary)" }} />
                              </div>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{pct}%</span>
                            </div>
                          )}
                        </td>
                      )}
                      {visibleCols.has("deadline") && (
                        <td style={isOverdue ? { color: "#ef4444", fontWeight: 600 } : undefined}>
                          {isOverdue && "⚠ "}{o.deadline ? new Date(o.deadline).toLocaleDateString("ru") : "—"}
                        </td>
                      )}
                      {visibleCols.has("status") && (
                        <td>
                          <Badge status={o.status} />
                          {o.status === "Доработка" && o.otk_comment && (
                            <div style={{ fontSize: 11, color: "#ef4444", marginTop: 2, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.otk_comment}>⚠ {o.otk_comment}</div>
                          )}
                          {o.status === "Ожидает компонентов" && (
                            <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 2 }}>⏳ Нет компонентов</div>
                          )}
                        </td>
                      )}
                      {visibleCols.has("tags") && (
                        <td>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                            {tags.map(t => <span key={t} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "var(--primary-light)", color: "var(--primary-text)" }}>{t}</span>)}
                          </div>
                        </td>
                      )}
                      {visibleCols.has("department") && <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{o.assigned_department || "—"}</td>}
                      {visibleCols.has("created") && <td>{new Date(o.created_at).toLocaleDateString("ru")}</td>}
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Button variant="ghost" size="sm" onClick={() => setPreviewOrder(o)} title="Быстрый просмотр">👁</Button>
                        {hasPermission("orders.create") && <Button variant="ghost" size="sm" onClick={() => duplicateOrder(o)} title="Дублировать">⎘</Button>}
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/orders/${o.id}`)}>Открыть</Button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Пагинация */}
              {totalPages > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 14 }}>
                  <Button size="sm" variant="ghost" disabled={pageClamped <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>← Назад</Button>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Стр. {pageClamped} из {totalPages}</span>
                  <Button size="sm" variant="ghost" disabled={pageClamped >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Вперёд →</Button>
                </div>
              )}
            </div>
          )}
        </Card>
        ) : view === "kanban" ? (
          <KanbanBoard
            orders={filtered}
            fetching={fetching}
            canEdit={hasPermission("orders.edit")}
            dragId={dragId}
            dragOverCol={dragOverCol}
            onDragStart={setDragId}
            onDragEnd={() => { setDragId(null); setDragOverCol(null); }}
            onDragOverCol={setDragOverCol}
            groupBy={kanbanGroupBy}
            onDrop={(val) => {
              if (dragId != null) {
                if (kanbanGroupBy === "status") changeOrderStatus(dragId, val);
                else if (kanbanGroupBy === "priority") { api.updateOrder(dragId, { priority: val }).then(() => { toast.success(`Приоритет: ${val}`); load(); }).catch(() => toast.error("Ошибка")); }
                else if (kanbanGroupBy === "department") { const v = val === "—" ? "" : val; api.updateOrder(dragId, { assigned_department: v }).then(() => { toast.success(`Отдел: ${val}`); load(); }).catch(() => toast.error("Ошибка")); }
              }
              setDragId(null); setDragOverCol(null);
            }}
            onOpen={(oid) => router.push(`/orders/${oid}`)}
          />
        ) : (
          <Card>
            <CalendarView orders={filtered} onOpen={(oid) => router.push(`/orders/${oid}`)} />
          </Card>
        )}
      </div>

      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setError(""); }}
        title={t("orders.create")}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Отмена</Button>
            <Button onClick={createOrder} loading={saving}>{t("orders.create")}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}

          {/* Шаблоны заказов */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", borderRadius: 8, background: "var(--bg-secondary)" }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Шаблон:</span>
            {orderTemplates.length > 0 ? (
              <select value="" onChange={e => e.target.value && applyOrderTemplate(e.target.value)} style={{ maxWidth: 200 }}>
                <option value="">выбрать…</option>
                {orderTemplates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            ) : <span style={{ fontSize: 12, color: "var(--text-muted)" }}>нет сохранённых</span>}
            <Button size="sm" variant="ghost" onClick={saveOrderTemplate}>★ Сохранить текущий</Button>
            {orderTemplates.length > 0 && (
              <button onClick={() => {
                const name = prompt("Удалить шаблон — введите название:");
                if (name) { const next = orderTemplates.filter(t => t.name !== name.trim()); setOrderTemplates(next); localStorage.setItem("germess_order_templates", JSON.stringify(next)); }
              }} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>🗑</button>
            )}
          </div>

          <div>
            <label>Изделие *</label>
            <ProductSelect value={form.product_name} onChange={v => setForm(f => ({ ...f, product_name: v }))} products={productNames} />
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label>Количество *</label>
              <input type="number" value={form.planned_qty} onChange={e => setForm(f => ({ ...f, planned_qty: e.target.value }))} placeholder="0" min="1" />
            </div>
            <div style={{ flex: 1 }}>
              <label>Приоритет</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {priorities.filter(p => p.is_active).sort((a,b) => b.sort_weight - a.sort_weight).map(p => <option key={p.code} value={p.label}>{p.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label>Срок выполнения</label>
            <input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} />
          </div>

          <div>
            <label>Комментарий</label>
            <textarea value={form.comment} onChange={e => setForm(f => ({ ...f, comment: e.target.value }))} rows={2} />
          </div>

          {/* Руководители проекта — кому пойдёт заказ. Только они печатают наряд и закрывают заказ. */}
          <div>
            <label>Руководители проекта {managers.length > 0 && <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· выбрано {managers.length}</span>}</label>
            <div style={{ maxHeight: 150, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6 }}>
              {allUsers.filter(u => u.is_active).length === 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 6 }}>Нет пользователей</div>}
              {allUsers.filter(u => u.is_active).map(u => {
                const id = String(u.id);
                const checked = managers.includes(id);
                return (
                  <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", cursor: "pointer", fontSize: 13, borderRadius: 6 }}>
                    <input type="checkbox" checked={checked}
                      onChange={() => setManagers(m => checked ? m.filter(x => x !== id) : [...m, id])} />
                    <span>{u.full_name || u.username}</span>
                    {(u.role === "admin" || u.role === "manager") && <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>{ROLE_LABELS[u.role] || u.role}</span>}
                  </label>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Печать наряда и закрытие заказа доступны только руководителям проекта (или администратору).</div>
          </div>

          {/* Канонический маршрут по ТЗ (12 этапов) */}
          <div style={{ padding: "12px 14px", borderRadius: 10, background: useCanonical ? "var(--primary-light)" : "var(--bg-secondary)", border: `1px solid ${useCanonical ? "color-mix(in srgb, var(--primary) 45%, transparent)" : "var(--border)"}` }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={useCanonical} onChange={e => setUseCanonical(e.target.checked)} />
              <span style={{ fontWeight: 600, fontSize: 13.5 }}>Маршрут по ТЗ (12 этапов)</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>распределение → СМД → AOI → … → отгрузка</span>
            </label>
            {useCanonical && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={canonFlags.needs_smd} onChange={e => setCanonFlags(f => ({ ...f, needs_smd: e.target.checked }))} />
                    Блок СМД (монтаж + AOI + гравировка)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={canonFlags.is_receiver} onChange={e => setCanonFlags(f => ({ ...f, is_receiver: e.target.checked }))} />
                    Приёмник (после СМД — прошивка)
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, cursor: "pointer", opacity: canonFlags.is_receiver ? 0.5 : 1 }}>
                    <input type="checkbox" checked={canonFlags.needs_assembly} disabled={canonFlags.is_receiver} onChange={e => setCanonFlags(f => ({ ...f, needs_assembly: e.target.checked }))} />
                    Сборка РЭА (склад РЭА → выдача → сборка → ОТК)
                  </label>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8 }}>
                  Этапы построятся автоматически по признакам изделия. Гейты AOI и ОТК возвращают брак на предыдущий этап.
                </div>
              </div>
            )}
          </div>

          {/* Этапы маршрута и назначение исполнителя */}
          {!useCanonical && form.product_name && productNames.includes(form.product_name) && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8 }}>
                  Этапы маршрута и исполнители
                </span>
                {productStages.length > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {productStages.length - skippedStages.size} из {productStages.length} включено
                  </span>
                )}
              </div>

              {loadingStages ? (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Загрузка...</div>
              ) : productStages.length > 0 ? (
                // Есть этапы — по каждому тумблер включения + исполнитель
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {productStages.map(stage => {
                    const color = STAGE_TYPE_COLORS[stage.stage_type] ?? "#6b7280";
                    const usersForStage = getUsersForStage(stage);
                    const enabled = !skippedStages.has(stage.id);
                    const toggle = () => setSkippedStages(prev => {
                      const next = new Set(prev);
                      if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id);
                      return next;
                    });
                    return (
                      <div key={stage.id} style={{
                        padding: "10px 14px", borderRadius: 10,
                        background: enabled ? "var(--bg-secondary)" : "var(--bg-tertiary)",
                        border: `1px solid ${enabled ? color + "33" : "var(--border)"}`,
                        opacity: enabled ? 1 : 0.6, transition: "opacity 0.15s, border-color 0.15s",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: enabled ? 8 : 0 }}>
                          <div style={{ width: 3, height: 20, borderRadius: 2, background: enabled ? color : "var(--text-muted)", flexShrink: 0 }} />
                          <span style={{ fontWeight: 600, fontSize: 14, textDecoration: enabled ? "none" : "line-through", color: enabled ? "var(--text)" : "var(--text-muted)" }}>
                            {stage.stage_name}
                          </span>
                          {stage.required_role && (
                            <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 7px", borderRadius: 20, background: color + "20", color }}>
                              {ROLE_LABELS[stage.required_role] ?? stage.required_role}
                            </span>
                          )}
                          {/* Тумблер включения этапа */}
                          <button
                            type="button"
                            onClick={toggle}
                            title={enabled ? "Пропустить этап в этом заказе" : "Включить этап"}
                            style={{
                              marginLeft: "auto", flexShrink: 0, position: "relative",
                              width: 38, height: 22, borderRadius: 99, border: "none", cursor: "pointer",
                              background: enabled ? color : "var(--border)", transition: "background 0.15s", padding: 0,
                            }}
                          >
                            <span style={{
                              position: "absolute", top: 2, left: enabled ? 18 : 2,
                              width: 18, height: 18, borderRadius: "50%", background: "#fff",
                              transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                            }} />
                          </button>
                        </div>
                        {enabled && (
                          <select
                            value={stageAssignments[stage.id] ?? ""}
                            onChange={e => setStageAssignments(prev => ({ ...prev, [stage.id]: e.target.value }))}
                            style={{ width: "100%" }}
                          >
                            <option value="">— Назначить позже —</option>
                            {usersForStage.map(u => (
                              <option key={u.id} value={String(u.id)}>
                                {u.full_name || u.username} ({ROLE_LABELS[u.role] ?? u.role})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : productRole ? (
                // Нет этапов но есть роль — один выбор
                <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                    {ROLE_LABELS[productRole] ?? productRole}
                  </div>
                  <select
                    value={stageAssignments[0] ?? ""}
                    onChange={e => setStageAssignments({ 0: e.target.value })}
                    style={{ width: "100%" }}
                  >
                    <option value="">— Назначить позже —</option>
                    {allUsers.filter(u => u.is_active && u.role === productRole).map(u => (
                      <option key={u.id} value={String(u.id)}>{u.full_name || u.username}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 12px", background: "var(--bg-secondary)", borderRadius: 8 }}>
                  Задайте этапы в рецептуре — тогда здесь появится выбор исполнителя
                </div>
              )}

              {hasAssignment && (
                <div style={{ fontSize: 12, color: "#10b981", padding: "6px 10px", background: "#10b98110", borderRadius: 6, marginTop: 8 }}>
                  ✓ Исполнитель увидит заказ в «Мои заказы» и сам запустит его
                </div>
              )}
            </div>
          )}

          {/* Конструктор маршрута */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
              Дополнительные этапы маршрута
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
              Этапы сверх рецептуры — ОТК, склад, упаковка и т.д. Можно задавать параллельные отделы.
            </div>
            <StagesBuilder
              stages={extraStages}
              onChange={setExtraStages}
              stageTypes={stageTypes}
              systemRoles={systemRoles}
              availableComponents={allRecipes
                .filter(r => r.product_name === form.product_name)
                .map(r => r.component_name)
                .filter((v, i, a) => a.indexOf(v) === i)
                .sort()}
            />
          </div>

          {/* Проверка компонентов */}
          {demandRows.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>
                Проверка компонентов
              </div>
              <div style={{ padding: "8px 12px", borderRadius: 8, marginBottom: 8, background: hasShortage ? "#ef444415" : "#10b98115", border: `1px solid ${hasShortage ? "#ef444440" : "#10b98140"}`, fontSize: 13, fontWeight: 600, color: hasShortage ? "#ef4444" : "#10b981" }}>
                {hasShortage ? "⚠ Не хватает компонентов — заказ будет создан в статусе «Ожидает компонентов»" : "✓ Компонентов достаточно"}
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["Компонент","Нужно","На складе","Дефицит"].map(h => <th key={h} style={{ textAlign: "left", padding: "3px 8px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {demandRows.map(r => {
                      const ok = r.shortage === 0;
                      return (
                        <tr key={r.component_name} style={{ background: ok ? "" : "#ef444408" }}>
                          <td style={{ padding: "4px 8px", fontSize: 13, fontWeight: 500 }}>{r.component_name}</td>
                          <td style={{ padding: "4px 8px", fontSize: 13 }}>{r.required}</td>
                          <td style={{ padding: "4px 8px", fontSize: 13, color: ok ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{r.available}</td>
                          <td style={{ padding: "4px 8px", fontSize: 13, fontWeight: 700, color: ok ? "#10b981" : "#ef4444" }}>{ok ? "—" : `−${r.shortage}`}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Модалка предпросмотра импорта из Excel */}
      <Modal
        open={importRows.length > 0}
        onClose={() => { if (!importing) setImportRows([]); }}
        title="Импорт заказов из Excel"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportRows([])} disabled={importing}>Отмена</Button>
            <Button onClick={runImport} loading={importing}>
              {importing ? `Импорт ${importProgress.done}/${importProgress.total}…` : `Импортировать ${importRows.length}`}
            </Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Найдено строк: <b style={{ color: "var(--text-primary)" }}>{importRows.length}</b>. Проверьте данные перед импортом.
            Каждая строка создаст заказ. Колонки: <code>Изделие</code>, <code>Количество</code>, <code>Приоритет</code>, <code>Срок</code>, <code>Отдел</code>, <code>Комментарий</code>.
          </div>
          {importing && (
            <div style={{ height: 6, borderRadius: 4, background: "var(--bg-tertiary)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(importProgress.done / Math.max(importProgress.total, 1)) * 100}%`, background: "var(--primary)", transition: "width 0.2s" }} />
            </div>
          )}
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>{["Изделие", "Кол-во", "Приоритет", "Срок", "Отдел"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", position: "sticky", top: 0, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {importRows.slice(0, 50).map((r, i) => {
                  const name = String(r["Изделие"] ?? r["product_name"] ?? "");
                  const qty = Number(r["Количество"] ?? r["planned_qty"] ?? 0);
                  const bad = !name.trim() || !qty || qty <= 0;
                  return (
                    <tr key={i} style={{ background: bad ? "#ef444410" : "" }}>
                      <td style={{ padding: "5px 10px", fontWeight: 500 }}>{name || <span style={{ color: "#ef4444" }}>— пусто —</span>}</td>
                      <td style={{ padding: "5px 10px", color: bad ? "#ef4444" : "" }}>{qty || "—"}</td>
                      <td style={{ padding: "5px 10px" }}>{String(r["Приоритет"] ?? r["priority"] ?? "Обычный")}</td>
                      <td style={{ padding: "5px 10px" }}>{String(r["Срок (ГГГГ-ММ-ДД)"] ?? r["Срок"] ?? r["deadline"] ?? "")}</td>
                      <td style={{ padding: "5px 10px" }}>{String(r["Отдел"] ?? r["assigned_department"] ?? "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {importRows.length > 50 && (
              <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>… и ещё {importRows.length - 50} строк</div>
            )}
          </div>
          <button onClick={importTemplate} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--primary)", cursor: "pointer", fontSize: 13, padding: 0 }}>
            ↓ Скачать шаблон Excel
          </button>
        </div>
      </Modal>

      {/* Настройка колонок */}
      <Modal open={showColSettings} onClose={() => setShowColSettings(false)} title="Видимые колонки"
        footer={<Button onClick={() => setShowColSettings(false)}>Готово</Button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {([["fav","Избранное"],["id","ID"],["product","Изделие"],["qty","Количество"],["priority","Приоритет"],["progress","Прогресс"],["deadline","Срок"],["status","Статус"],["tags","Метки"],["department","Отдел"],["created","Создан"]] as [string,string][]).map(([k,label]) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={visibleCols.has(k)} onChange={() => toggleCol(k)} style={{ width: 15, height: 15 }} />
              {label}
            </label>
          ))}
        </div>
      </Modal>

      {/* Быстрый просмотр (drawer) */}
      {previewOrder && (
        <div onClick={() => setPreviewOrder(null)} style={{ position: "fixed", inset: 0, zIndex: 1500, background: "rgba(0,0,0,0.35)", display: "flex", justifyContent: "flex-end" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "min(420px, 92vw)", height: "100%", background: "var(--bg-primary)", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)", padding: 24, overflowY: "auto", animation: "slideInRight 0.2s ease" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>Заказ #{previewOrder.id}</h2>
              <button onClick={() => setPreviewOrder(null)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "var(--text-muted)" }}>×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              {([
                ["Изделие", previewOrder.product_name],
                ["Количество", `${previewOrder.planned_qty} шт`],
                ["Статус", <Badge key="s" status={previewOrder.status} />],
                ["Приоритет", <PriorityBadge key="p" priority={previewOrder.priority} />],
                ["Прогресс", previewOrder.stages_total ? `${previewOrder.stages_done}/${previewOrder.stages_total} этапов` : "—"],
                ["Срок", previewOrder.deadline ? new Date(previewOrder.deadline).toLocaleDateString("ru") : "—"],
                ["Отдел", previewOrder.assigned_department || "—"],
                ["Оператор", previewOrder.assigned_operator_name || "—"],
                ["Создан", new Date(previewOrder.created_at).toLocaleString("ru")],
                ["Комментарий", previewOrder.comment || "—"],
              ] as [string, React.ReactNode][]).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                  <span style={{ color: "var(--text-muted)" }}>{k}</span>
                  <span style={{ fontWeight: 500, textAlign: "right" }}>{v}</span>
                </div>
              ))}
            </div>
            {previewOrder.status === "Доработка" && previewOrder.otk_comment && (
              <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "#ef444415", color: "#ef4444", fontSize: 13 }}>⚠ {previewOrder.otk_comment}</div>
            )}
            {/* Метки/теги */}
            {hasPermission("orders.edit") && (() => {
              const tags: string[] = (() => { try { return JSON.parse(previewOrder.tags || "[]"); } catch { return []; } })();
              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>Метки</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {tags.map(t => (
                      <span key={t} style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "var(--primary-light)", color: "var(--primary-text)", display: "flex", alignItems: "center", gap: 4 }}>
                        {t}<button onClick={() => updateTags(previewOrder, tags.filter(x => x !== t))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary-text)", fontSize: 13, padding: 0 }}>×</button>
                      </span>
                    ))}
                    <input
                      placeholder="+ метка, Enter"
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const v = (e.target as HTMLInputElement).value.trim();
                          if (v && !tags.includes(v)) updateTags(previewOrder, [...tags, v]);
                          (e.target as HTMLInputElement).value = "";
                        }
                      }}
                      style={{ width: 120, fontSize: 12, padding: "3px 8px" }}
                    />
                  </div>
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
              <Button size="sm" onClick={() => router.push(`/orders/${previewOrder.id}`)}>Открыть полностью</Button>
              <Button size="sm" variant="secondary" onClick={() => printOrderCard(previewOrder)}>🖨 Печать</Button>
              {hasPermission("orders.create") && <Button size="sm" variant="ghost" onClick={() => { duplicateOrder(previewOrder); setPreviewOrder(null); }}>⎘ Дублировать</Button>}
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
