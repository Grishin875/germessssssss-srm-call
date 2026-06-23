"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api, Component, Case, FinishedGood, Warehouse, WarehouseStockRow, ComponentRequest } from "../../lib/api";
import { exportToExcel, parseExcelFile, Row as ExcelRow } from "../../lib/excel";
import { toast } from "../../components/ui/Toast";

const IcoPencil = () => (
  <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H7v-3a2 2 0 01.586-1.414z" />
  </svg>
);
const IcoTrash = () => (
  <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4h6v3M4 7h16" />
  </svg>
);
const IcoWarn = () => (
  <svg width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
);

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  warehouse: { label: "Склад", color: "#0ea5e9" },
  smd:       { label: "СМД",   color: "#8b5cf6" },
  engraving: { label: "Гравировка", color: "#f59e0b" },
  "3d_print":{ label: "3D Печать", color: "#10b981" },
  purchase:  { label: "Закупка", color: "#f97316" },
};

function SourceBadge({ source }: { source?: string }) {
  const s = SOURCE_LABELS[source || "warehouse"] ?? SOURCE_LABELS.warehouse;
  return (
    <span style={{
      display: "inline-block",
      fontSize: 11,
      fontWeight: 600,
      padding: "2px 8px",
      borderRadius: 20,
      background: s.color + "22",
      color: s.color,
    }}>{s.label}</span>
  );
}

const TABS = [
  { key: "components",     label: "Компоненты" },
  { key: "warehouses",     label: "Склады" },
  { key: "cases",          label: "Корпуса" },
  { key: "finished_goods", label: "Готовая продукция" },
  { key: "requests",       label: "Заявки (брак)" },
  { key: "analytics",      label: "Аналитика" },
];

const REQ_STATUS_META: Record<string, { label: string; color: string }> = {
  pending:  { label: "Ожидает",  color: "#f59e0b" },
  issued:   { label: "Выдано",   color: "#10b981" },
  rejected: { label: "Отклонено", color: "#ef4444" },
};

const WH_TYPE_META: Record<string, { label: string; color: string }> = {
  main:     { label: "Основной",          color: "#0ea5e9" },
  smd:      { label: "СМД",               color: "#8b5cf6" },
  rea:      { label: "РЭА",               color: "#f59e0b" },
  finished: { label: "Готовая продукция", color: "#10b981" },
  defect:   { label: "Брак",              color: "#ef4444" },
};

export default function WarehousePage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<"components" | "warehouses" | "cases" | "finished_goods" | "requests" | "analytics">("components");

  // ── Components state ──────────────────────────────────────────────────────
  const [components, setComponents] = useState<Component[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [fetching, setFetching] = useState(true);
  const compImportRef = useRef<HTMLInputElement>(null);
  const [importingComp, setImportingComp] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showBatch, setShowBatch] = useState<"incoming" | "writeoff" | null>(null);
  const [editComp, setEditComp] = useState<Component | null>(null);
  const [form, setForm] = useState({
    name: "", stock: "0", category: "Разное", unit: "",
    min_stock: "", comment: "", block: "СМД", source: "warehouse",
  });
  const [batchItems, setBatchItems] = useState([{ name: "", qty: "" }]);
  const [toProduction, setToProduction] = useState(false);
  const [writeoffReason, setWriteoffReason] = useState("other");

  // ── Cases state ───────────────────────────────────────────────────────────
  const [cases, setCases] = useState<Case[]>([]);
  const [casesFetching, setCasesFetching] = useState(false);
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [editCase, setEditCase] = useState<Case | null>(null);
  const [caseForm, setCaseForm] = useState({
    name: "", source: "warehouse", stock: "0", min_stock: "0",
    color: "", material: "", comment: "",
  });
  const [adjustCaseId, setAdjustCaseId] = useState<number | null>(null);
  const [adjustDelta, setAdjustDelta] = useState("");
  const [adjustComment, setAdjustComment] = useState("");

  // ── Finished Goods state ──────────────────────────────────────────────────
  const [finishedGoods, setFinishedGoods] = useState<FinishedGood[]>([]);
  const [fgLoading, setFgLoading] = useState(false);

  // ── Component requests (брак) state ───────────────────────────────────────
  const [compRequests, setCompRequests] = useState<ComponentRequest[]>([]);
  const [reqLoading, setReqLoading] = useState(false);

  const [saving, setSaving] = useState(false);
  const [historyComp, setHistoryComp] = useState<Component | null>(null);
  const [historyOps, setHistoryOps] = useState<import("../../lib/api").Operation[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function openHistory(c: Component) {
    setHistoryComp(c);
    setHistoryLoading(true);
    try {
      const res = await api.getWarehouseOperations({ component_name: c.name, limit: 50 });
      setHistoryOps(res.operations);
    } catch { setHistoryOps([]); }
    setHistoryLoading(false);
  }

  const [error, setError] = useState("");

  // ── Склады (мультисклад) ───────────────────────────────────────────────────
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [whLoading, setWhLoading] = useState(false);
  const [whStock, setWhStock] = useState<WarehouseStockRow[]>([]);
  const [selectedWh, setSelectedWh] = useState<number | null>(null);
  const [whStockLoading, setWhStockLoading] = useState(false);
  const [showWhModal, setShowWhModal] = useState(false);
  const [editWh, setEditWh] = useState<Warehouse | null>(null);
  const [whForm, setWhForm] = useState({ code: "", name: "", warehouse_type: "main", address: "" });
  const [showTransfer, setShowTransfer] = useState(false);
  const [transferForm, setTransferForm] = useState({ component_name: "", from_warehouse_id: "", to_warehouse_id: "", quantity: "", note: "" });

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    loadComponents();
    api.getCategories().then(setCategories).catch(console.error);
    loadCases();
    loadFinishedGoods();
    loadCompRequests();
  }, [user]);

  async function loadFinishedGoods() {
    setFgLoading(true);
    try { setFinishedGoods(await api.getFinishedGoods()); } catch {}
    setFgLoading(false);
  }

  async function loadCompRequests() {
    setReqLoading(true);
    try { setCompRequests(await api.getComponentRequests()); } catch {}
    setReqLoading(false);
  }

  async function issueRequest(id: number) {
    try {
      await api.issueComponentRequest(id);
      toast.success("Компонент выдан, списан со склада");
      loadCompRequests();
      loadComponents();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function rejectRequest(id: number) {
    try {
      await api.rejectComponentRequest(id);
      toast.success("Заявка отклонена");
      loadCompRequests();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function loadComponents() {
    setFetching(true);
    try { setComponents(await api.getComponents()); } catch {}
    setFetching(false);
  }

  async function loadWarehouses() {
    setWhLoading(true);
    try {
      const list = await api.getWarehouses();
      setWarehouses(list);
      setSelectedWh(prev => prev ?? (list[0]?.id ?? null));
    } catch {}
    setWhLoading(false);
  }

  async function loadWhStock(wid: number) {
    setWhStockLoading(true);
    try { setWhStock(await api.getWarehouseStock(wid)); } catch { setWhStock([]); }
    setWhStockLoading(false);
  }

  useEffect(() => {
    if (tab === "warehouses" && user) loadWarehouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, user]);

  useEffect(() => {
    if (selectedWh != null) loadWhStock(selectedWh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWh]);

  async function saveWarehouse() {
    if (!whForm.code.trim() || !whForm.name.trim()) { setError("Код и название обязательны"); return; }
    setSaving(true); setError("");
    try {
      const data = { code: whForm.code.trim(), name: whForm.name.trim(), warehouse_type: whForm.warehouse_type, address: whForm.address || undefined };
      if (editWh) await api.updateWarehouse(editWh.id, data);
      else await api.createWarehouse(data);
      setShowWhModal(false); setEditWh(null);
      setWhForm({ code: "", name: "", warehouse_type: "main", address: "" });
      loadWarehouses();
      toast.success(editWh ? "Склад обновлён" : "Склад создан");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function removeWarehouse(w: Warehouse) {
    if (!confirm(`Удалить склад «${w.name}»?`)) return;
    try {
      await api.deleteWarehouse(w.id);
      if (selectedWh === w.id) setSelectedWh(null);
      loadWarehouses();
      toast.success("Склад удалён");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function doTransfer() {
    const { component_name, from_warehouse_id, to_warehouse_id, quantity } = transferForm;
    if (!component_name.trim() || !from_warehouse_id || !to_warehouse_id || !(Number(quantity) > 0)) {
      setError("Заполните компонент, склады и количество (> 0)"); return;
    }
    if (from_warehouse_id === to_warehouse_id) { setError("Склады совпадают"); return; }
    setSaving(true); setError("");
    try {
      const res = await api.transferStock({
        component_name: component_name.trim(),
        from_warehouse_id: Number(from_warehouse_id),
        to_warehouse_id: Number(to_warehouse_id),
        quantity: Number(quantity),
        note: transferForm.note || undefined,
      });
      setShowTransfer(false);
      setTransferForm({ component_name: "", from_warehouse_id: "", to_warehouse_id: "", quantity: "", note: "" });
      loadWarehouses();
      if (selectedWh != null) loadWhStock(selectedWh);
      toast.success(`Перемещено: ${res.from} → ${res.to}`);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  // ── Excel экспорт/импорт компонентов ───────────────────────────────────────
  function exportComponentsExcel() {
    const rows: ExcelRow[] = components.map(c => ({
      "Название": c.name,
      "Остаток": c.stock ?? 0,
      "Категория": c.category ?? "",
      "Единица": c.unit ?? "",
      "Мин. остаток": c.min_stock ?? "",
      "Блок": c.block ?? "",
      "Комментарий": c.comment ?? "",
    }));
    if (!rows.length) { toast.warning("Нет компонентов для экспорта"); return; }
    exportToExcel(rows, "Склад_компоненты", "Компоненты").then(() => toast.success(`Экспортировано: ${rows.length}`));
  }

  async function onImportComponents(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = "";
    if (!file) return;
    let rows: ExcelRow[];
    try { rows = await parseExcelFile(file); }
    catch { toast.error("Не удалось прочитать файл"); return; }
    const cleaned = rows.filter(r => String(r["Название"] ?? r["name"] ?? "").trim());
    if (!cleaned.length) { toast.error("Нет строк с колонкой «Название»"); return; }
    if (!confirm(`Импортировать ${cleaned.length} компонент(ов)? Новые будут добавлены.`)) return;
    setImportingComp(true);
    let ok = 0, err = 0;
    for (const r of cleaned) {
      try {
        await api.createComponent({
          name: String(r["Название"] ?? r["name"]).trim(),
          stock: Number(r["Остаток"] ?? r["stock"] ?? 0) || 0,
          category: String(r["Категория"] ?? r["category"] ?? "Разное").trim() || "Разное",
          unit: String(r["Единица"] ?? r["unit"] ?? "").trim() || undefined,
          min_stock: r["Мин. остаток"] !== "" && r["Мин. остаток"] != null ? Number(r["Мин. остаток"]) : undefined,
          block: String(r["Блок"] ?? r["block"] ?? "СМД").trim() || "СМД",
          comment: String(r["Комментарий"] ?? r["comment"] ?? "").trim() || undefined,
        } as Partial<Component>);
        ok++;
      } catch { err++; }
    }
    setImportingComp(false);
    if (ok) { toast.success(`Импортировано: ${ok}${err ? `, ошибок: ${err}` : ""}`); loadComponents(); }
    else toast.error(`Импорт не удался (ошибок: ${err})`);
  }

  async function loadCases() {
    setCasesFetching(true);
    try { setCases(await api.getCases()); } catch {}
    setCasesFetching(false);
  }

  async function saveComponent() {
    if (!form.name.trim()) { setError("Название обязательно"); return; }
    setSaving(true); setError("");
    try {
      const data = {
        name: form.name,
        stock: Number(form.stock),
        category: form.category,
        unit: form.unit || undefined,
        min_stock: form.min_stock ? Number(form.min_stock) : undefined,
        comment: form.comment || undefined,
        block: form.block,
        source: form.source,
      };
      if (editComp) await api.updateComponent(editComp.id, data);
      else await api.createComponent(data);
      setShowAdd(false); setEditComp(null);
      setForm({ name: "", stock: "0", category: "Разное", unit: "", min_stock: "", comment: "", block: "СМД", source: "warehouse" });
      loadComponents();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function doBatch() {
    const items = batchItems.filter(i => i.name.trim() && Number(i.qty) > 0).map(i => ({ name: i.name.trim(), qty: Number(i.qty) }));
    if (!items.length) { setError("Добавьте хотя бы один компонент"); return; }
    setSaving(true); setError("");
    try {
      await api.batchOperation(showBatch!, items, undefined, toProduction, showBatch === "writeoff" ? writeoffReason : undefined);
      setShowBatch(null); setBatchItems([{ name: "", qty: "" }]); setToProduction(false);
      loadComponents();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function saveCase() {
    if (!caseForm.name.trim()) { setError("Название обязательно"); return; }
    setSaving(true); setError("");
    try {
      const data = {
        name: caseForm.name,
        source: caseForm.source,
        stock: Number(caseForm.stock),
        min_stock: Number(caseForm.min_stock),
        color: caseForm.color || undefined,
        material: caseForm.material || undefined,
        comment: caseForm.comment || undefined,
      };
      if (editCase) await api.updateCase(editCase.id, data);
      else await api.createCase(data);
      setShowCaseModal(false); setEditCase(null);
      setCaseForm({ name: "", source: "warehouse", stock: "0", min_stock: "0", color: "", material: "", comment: "" });
      loadCases();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function doAdjustCase() {
    if (!adjustCaseId) return;
    setSaving(true); setError("");
    try {
      await api.adjustCaseStock(adjustCaseId, Number(adjustDelta), adjustComment || undefined);
      setAdjustCaseId(null); setAdjustDelta(""); setAdjustComment("");
      loadCases();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  if (loading || !user) return null;

  const filtered = components.filter(c => {
    if (catFilter && c.category !== catFilter) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const belowMin = filtered.filter(c => c.min_stock && c.stock < c.min_stock).length;
  const belowMinCases = cases.filter(c => c.min_stock && c.stock < c.min_stock).length;

  const tabStyle = (key: string): React.CSSProperties => ({
    padding: "8px 20px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
    background: tab === key ? "var(--primary)" : "transparent",
    color: tab === key ? "#fff" : "var(--text-secondary)",
    transition: "all 0.15s",
  });

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h1>Склад</h1>
          {tab === "components" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="ghost" size="sm" onClick={exportComponentsExcel}>⬇ Excel</Button>
              {hasPermission("warehouse.edit") && (
                <>
                  <Button variant="secondary" size="sm" onClick={() => compImportRef.current?.click()} loading={importingComp}>⬆ Импорт</Button>
                  <input ref={compImportRef} type="file" accept=".xlsx,.xls,.csv" onChange={onImportComponents} style={{ display: "none" }} />
                  <Button variant="success" size="sm" onClick={() => { setShowBatch("incoming"); setError(""); }}>Оприходовать</Button>
                  <Button variant="danger" size="sm" onClick={() => { setShowBatch("writeoff"); setError(""); }}>Списать</Button>
                  <Button size="sm" onClick={() => {
                    setShowAdd(true); setEditComp(null);
                    setForm({ name: "", stock: "0", category: "Разное", unit: "", min_stock: "", comment: "", block: "СМД", source: "warehouse" });
                    setError("");
                  }}>Добавить</Button>
                </>
              )}
            </div>
          )}
          {hasPermission("warehouse.edit") && tab === "cases" && (
            <Button size="sm" onClick={() => {
              setShowCaseModal(true); setEditCase(null);
              setCaseForm({ name: "", source: "warehouse", stock: "0", min_stock: "0", color: "", material: "", comment: "" });
              setError("");
            }}>Добавить корпус</Button>
          )}
          {hasPermission("warehouse.edit") && tab === "warehouses" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="secondary" size="sm" onClick={() => {
                setShowTransfer(true); setError("");
                setTransferForm({ component_name: "", from_warehouse_id: String(selectedWh ?? ""), to_warehouse_id: "", quantity: "", note: "" });
              }}>⇄ Переместить</Button>
              <Button size="sm" onClick={() => {
                setShowWhModal(true); setEditWh(null);
                setWhForm({ code: "", name: "", warehouse_type: "main", address: "" });
                setError("");
              }}>Добавить склад</Button>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, background: "var(--bg-secondary)", padding: 4, borderRadius: 10, width: "fit-content" }}>
          {TABS.map(t => (
            <button key={t.key} style={tabStyle(t.key)} onClick={() => setTab(t.key as "components" | "warehouses" | "cases" | "finished_goods" | "requests" | "analytics")}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Components Tab ─────────────────────────────────────────────────── */}
        {tab === "components" && (
          <>
            {belowMin > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13 }}>
                <IcoWarn />
                {belowMin} компонент(ов) ниже минимального остатка
              </div>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск компонента..." style={{ width: 240 }} />
              <select value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                <option value="">Все категории</option>
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <Card>
              {fetching ? (
                <div className="text-center py-12">Загрузка...</div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">Компоненты не найдены</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        {["Название","Категория","Источник","Остаток","Резерв","Доступно","Мин. остаток","Ед.","Блок",""].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(c => {
                        const low = c.min_stock && c.stock < c.min_stock;
                        return (
                          <tr key={c.id} style={low ? { background: "rgba(245,158,11,0.05)" } : undefined}>
                            <td style={{ fontWeight: 500 }}>{c.name}</td>
                            <td>{c.category}</td>
                            <td><SourceBadge source={c.source} /></td>
                            <td style={{ fontWeight: 600, color: low ? "#d97706" : undefined }}>{c.stock}</td>
                            <td style={{ color: c.reserved_qty ? "#f59e0b" : "var(--text-muted)" }}>{c.reserved_qty || "—"}</td>
                            <td style={{ fontWeight: 600 }}>{c.available}</td>
                            <td>{c.min_stock ?? "—"}</td>
                            <td>{c.unit || "—"}</td>
                            <td>{c.block}</td>
                            <td>
                              {hasPermission("warehouse.edit") && (
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    onClick={() => openHistory(c)}
                                    title="История движений"
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  >
                                    <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditComp(c);
                                      setForm({ name: c.name, stock: String(c.stock), category: c.category, unit: c.unit || "", min_stock: c.min_stock ? String(c.min_stock) : "", comment: c.comment || "", block: c.block, source: c.source || "warehouse" });
                                      setShowAdd(true); setError("");
                                    }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  ><IcoPencil /></button>
                                  <button
                                    onClick={async () => { if (confirm("Удалить?")) { await api.deleteComponent(c.id); loadComponents(); } }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  ><IcoTrash /></button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}

        {/* ── Warehouses Tab ────────────────────────────────────────────────── */}
        {tab === "warehouses" && (
          <>
            {whLoading ? (
              <Card><div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка…</div></Card>
            ) : (
              <>
                {/* Карточки складов */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
                  {warehouses.map(w => {
                    const meta = WH_TYPE_META[w.warehouse_type] ?? WH_TYPE_META.main;
                    const active = selectedWh === w.id;
                    return (
                      <div
                        key={w.id}
                        onClick={() => setSelectedWh(w.id)}
                        style={{
                          padding: 16, borderRadius: 12, cursor: "pointer",
                          background: active ? meta.color + "14" : "var(--bg-secondary)",
                          border: `1.5px solid ${active ? meta.color : "var(--border)"}`,
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: meta.color + "22", color: meta.color }}>{meta.label}</span>
                          {hasPermission("warehouse.edit") && (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button title="Изменить" onClick={(e) => { e.stopPropagation(); setEditWh(w); setShowWhModal(true); setWhForm({ code: w.code, name: w.name, warehouse_type: w.warehouse_type, address: w.address || "" }); setError(""); }}
                                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}><IcoPencil /></button>
                              {w.warehouse_type !== "main" && (
                                <button title="Удалить" onClick={(e) => { e.stopPropagation(); removeWarehouse(w); }}
                                  style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ef4444", padding: 2 }}><IcoTrash /></button>
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 15, marginTop: 10 }}>{w.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Код: {w.code}</div>
                        <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                          <div>
                            <div style={{ fontSize: 20, fontWeight: 800 }}>{w.positions_count ?? 0}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>позиций</div>
                          </div>
                          <div>
                            <div style={{ fontSize: 20, fontWeight: 800 }}>{(w.total_quantity ?? 0).toLocaleString("ru")}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>всего</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Остатки выбранного склада */}
                {selectedWh != null && (
                  <Card>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
                      Остатки: {warehouses.find(w => w.id === selectedWh)?.name ?? ""}
                    </div>
                    {whStockLoading ? (
                      <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>Загрузка…</div>
                    ) : whStock.length === 0 ? (
                      <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>На складе нет остатков</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ textAlign: "left", fontSize: 12, color: "var(--text-muted)" }}>
                              <th style={{ padding: "8px 10px" }}>Компонент</th>
                              <th style={{ padding: "8px 10px", textAlign: "right" }}>Остаток</th>
                              <th style={{ padding: "8px 10px", textAlign: "right" }}>Резерв</th>
                              <th style={{ padding: "8px 10px", textAlign: "right" }}>Доступно</th>
                              <th style={{ padding: "8px 10px" }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {whStock.map(r => (
                              <tr key={r.component_name} style={{ borderTop: "1px solid var(--border)" }}>
                                <td style={{ padding: "9px 10px", fontWeight: 600 }}>{r.component_name}</td>
                                <td style={{ padding: "9px 10px", textAlign: "right" }}>{r.quantity.toLocaleString("ru")}</td>
                                <td style={{ padding: "9px 10px", textAlign: "right", color: r.reserved ? "#f59e0b" : "var(--text-muted)" }}>{r.reserved.toLocaleString("ru")}</td>
                                <td style={{ padding: "9px 10px", textAlign: "right", fontWeight: 700 }}>{r.available.toLocaleString("ru")}</td>
                                <td style={{ padding: "9px 10px", textAlign: "right" }}>
                                  {hasPermission("warehouse.edit") && (
                                    <button onClick={() => { setShowTransfer(true); setError(""); setTransferForm({ component_name: r.component_name, from_warehouse_id: String(selectedWh), to_warehouse_id: "", quantity: "", note: "" }); }}
                                      style={{ border: "1px solid var(--border)", background: "transparent", borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", color: "var(--text-secondary)" }}>⇄</button>
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
              </>
            )}
          </>
        )}

        {/* ── Cases Tab ──────────────────────────────────────────────────────── */}
        {tab === "cases" && (
          <>
            {belowMinCases > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: 13 }}>
                <IcoWarn />
                {belowMinCases} корпус(ов) ниже минимального остатка
              </div>
            )}
            <Card>
              {casesFetching ? (
                <div className="text-center py-12">Загрузка...</div>
              ) : cases.length === 0 ? (
                <div className="text-center py-12">Корпусов нет</div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table>
                    <thead>
                      <tr>
                        {["Название","Источник","Цвет","Материал","Остаток","Мин.",""].map(h => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cases.map(c => {
                        const low = c.min_stock && c.stock < c.min_stock;
                        return (
                          <tr key={c.id} style={low ? { background: "rgba(245,158,11,0.05)" } : undefined}>
                            <td style={{ fontWeight: 500 }}>{c.name}</td>
                            <td><SourceBadge source={c.source} /></td>
                            <td>{c.color || "—"}</td>
                            <td>{c.material || "—"}</td>
                            <td style={{ fontWeight: 600, color: low ? "#d97706" : undefined }}>{c.stock}</td>
                            <td>{c.min_stock ?? "—"}</td>
                            <td>
                              {hasPermission("warehouse.edit") && (
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    onClick={() => { setAdjustCaseId(c.id); setAdjustDelta(""); setAdjustComment(""); setError(""); }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, fontSize: 11, fontWeight: 600 }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  >±</button>
                                  <button
                                    onClick={() => {
                                      setEditCase(c);
                                      setCaseForm({ name: c.name, source: c.source, stock: String(c.stock), min_stock: String(c.min_stock ?? 0), color: c.color || "", material: c.material || "", comment: c.comment || "" });
                                      setShowCaseModal(true); setError("");
                                    }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  ><IcoPencil /></button>
                                  <button
                                    onClick={async () => { if (confirm("Удалить корпус?")) { await api.deleteCase(c.id); loadCases(); } }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  ><IcoTrash /></button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}

        {/* ── Finished Goods Tab ─────────────────────────────────────────────── */}
        {tab === "finished_goods" && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Готовая продукция на складе</div>
              <button onClick={loadFinishedGoods} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Обновить
              </button>
            </div>
            {fgLoading ? (
              <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>Загрузка...</div>
            ) : finishedGoods.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📦</div>
                <div>Готовая продукция пока не поступала</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Продукция появится здесь после завершения этапа «Склад» в заказе</div>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      {["Продукт","Годных","Брак","Всего","Обновлено"].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {finishedGoods.map(fg => (
                      <tr key={fg.id}>
                        <td style={{ fontWeight: 600 }}>{fg.product_name}</td>
                        <td style={{ color: "#10b981", fontWeight: 600 }}>{fg.good_qty}</td>
                        <td style={{ color: fg.defect_qty > 0 ? "#ef4444" : "var(--text-muted)" }}>{fg.defect_qty}</td>
                        <td style={{ fontWeight: 600 }}>{fg.total_qty}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{fg.updated_at ? new Date(fg.updated_at).toLocaleString("ru") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 20 }}>
                  <div style={{ padding: "14px 18px", borderRadius: 10, background: "#10b98114", border: "1px solid #10b98130" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#10b981" }}>{finishedGoods.reduce((s, f) => s + f.good_qty, 0)}</div>
                    <div style={{ fontSize: 12, color: "#10b981", fontWeight: 600, marginTop: 2 }}>Всего годных</div>
                  </div>
                  <div style={{ padding: "14px 18px", borderRadius: 10, background: "#ef444414", border: "1px solid #ef444430" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#ef4444" }}>{finishedGoods.reduce((s, f) => s + f.defect_qty, 0)}</div>
                    <div style={{ fontSize: 12, color: "#ef4444", fontWeight: 600, marginTop: 2 }}>Всего брака</div>
                  </div>
                  <div style={{ padding: "14px 18px", borderRadius: 10, background: "#6366f114", border: "1px solid #6366f130" }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#6366f1" }}>{finishedGoods.length}</div>
                    <div style={{ fontSize: 12, color: "#6366f1", fontWeight: 600, marginTop: 2 }}>Наименований</div>
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* ── Component Requests Tab (брак) ──────────────────────────────────── */}
        {tab === "requests" && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Заявки на компоненты (брак)</div>
              <button onClick={loadCompRequests} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
                <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Обновить
              </button>
            </div>
            {reqLoading ? (
              <div className="text-center py-12">Загрузка...</div>
            ) : compRequests.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Заявок нет</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      {["Дата","Заказ","Компонент","Кол-во","Причина","Запросил","Статус",""].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {compRequests.map(r => {
                      const meta = REQ_STATUS_META[r.status] ?? { label: r.status_label || r.status, color: "var(--text-muted)" };
                      return (
                        <tr key={r.id}>
                          <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{r.created_at ? new Date(r.created_at).toLocaleString("ru") : "—"}</td>
                          <td>
                            <button
                              onClick={() => router.push(`/orders/${r.order_id}`)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", padding: 0, fontWeight: 600 }}
                            >#{r.order_id}</button>
                          </td>
                          <td style={{ fontWeight: 500 }}>{r.component_name}</td>
                          <td style={{ fontWeight: 600 }}>{r.qty}</td>
                          <td style={{ maxWidth: 240, color: "var(--text-secondary)" }}>{r.reason || "—"}</td>
                          <td>{r.requested_by_name || "—"}</td>
                          <td>
                            <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: meta.color + "22", color: meta.color }}>
                              {r.status_label || meta.label}
                            </span>
                            {r.status === "issued" && r.issued_by_name && (
                              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Выдал: {r.issued_by_name}</div>
                            )}
                          </td>
                          <td>
                            {r.status === "pending" && hasPermission("warehouse.edit") && (
                              <div style={{ display: "flex", gap: 6 }}>
                                <Button variant="success" size="sm" onClick={() => issueRequest(r.id)}>Выдать</Button>
                                <Button variant="danger" size="sm" onClick={() => rejectRequest(r.id)}>Отклонить</Button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── Analytics Tab ──────────────────────────────────────────────────── */}
        {tab === "analytics" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              <div style={{ padding: "16px 20px", borderRadius: 12, background: "#ef444414", border: "1px solid #ef444430" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#ef4444" }}>{components.filter(c => c.min_stock && c.stock === 0).length}</div>
                <div style={{ fontSize: 13, color: "#ef4444", fontWeight: 600 }}>Полностью отсутствуют</div>
              </div>
              <div style={{ padding: "16px 20px", borderRadius: 12, background: "#f59e0b14", border: "1px solid #f59e0b30" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#f59e0b" }}>{components.filter(c => c.min_stock && c.stock > 0 && c.stock < c.min_stock).length}</div>
                <div style={{ fontSize: 13, color: "#f59e0b", fontWeight: 600 }}>Ниже минимума</div>
              </div>
              <div style={{ padding: "16px 20px", borderRadius: 12, background: "#10b98114", border: "1px solid #10b98130" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#10b981" }}>{components.filter(c => !c.min_stock || c.stock >= c.min_stock).length}</div>
                <div style={{ fontSize: 13, color: "#10b981", fontWeight: 600 }}>В норме</div>
              </div>
            </div>
            {components.filter(c => c.min_stock && c.stock < c.min_stock).length === 0 ? (
              <Card><div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Все компоненты в норме ✓</div></Card>
            ) : (
              <Card>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Требуют пополнения</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {components
                    .filter(c => c.min_stock && c.stock < c.min_stock)
                    .sort((a, b) => (a.stock / (a.min_stock || 1)) - (b.stock / (b.min_stock || 1)))
                    .map(c => {
                      const pct = c.min_stock ? Math.round((c.stock / c.min_stock) * 100) : 100;
                      const deficit = (c.min_stock || 0) - c.stock;
                      const color = c.stock === 0 ? "#ef4444" : "#f59e0b";
                      return (
                        <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: 10, background: "var(--bg-secondary)", border: `1px solid ${color}33` }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{c.category} · {c.unit || "шт"}</div>
                            <div style={{ marginTop: 6, height: 4, borderRadius: 2, background: "var(--border)", overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 2 }} />
                            </div>
                          </div>
                          <div style={{ textAlign: "right", flexShrink: 0 }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color }}>{c.stock} / {c.min_stock}</div>
                            <div style={{ fontSize: 12, color, marginTop: 2 }}>дефицит: {deficit}</div>
                          </div>
                          {hasPermission("warehouse.edit") && (
                            <button
                              onClick={() => { setShowBatch("incoming"); setError(""); setBatchItems([{ name: c.name, qty: String(deficit) }]); }}
                              style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: color, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                            >
                              Оприходовать
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {/* Warehouse create/edit modal */}
      <Modal
        open={showWhModal}
        onClose={() => { setShowWhModal(false); setEditWh(null); setError(""); }}
        title={editWh ? "Редактировать склад" : "Добавить склад"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowWhModal(false); setEditWh(null); }}>Отмена</Button>
            <Button onClick={saveWarehouse} loading={saving}>{editWh ? "Сохранить" : "Создать"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>Код *</label>
            <input value={whForm.code} onChange={e => setWhForm({ ...whForm, code: e.target.value })} placeholder="напр. SMD" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Название *</label>
            <input value={whForm.name} onChange={e => setWhForm({ ...whForm, name: e.target.value })} placeholder="Склад СМД" style={{ width: "100%" }} />
          </div>
          <div>
            <label>Тип склада</label>
            <select value={whForm.warehouse_type} onChange={e => setWhForm({ ...whForm, warehouse_type: e.target.value })} style={{ width: "100%" }}>
              {Object.entries(WH_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label>Адрес</label>
            <input value={whForm.address} onChange={e => setWhForm({ ...whForm, address: e.target.value })} style={{ width: "100%" }} />
          </div>
        </div>
      </Modal>

      {/* Transfer modal */}
      <Modal
        open={showTransfer}
        onClose={() => { setShowTransfer(false); setError(""); }}
        title="Перемещение между складами"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowTransfer(false)}>Отмена</Button>
            <Button onClick={doTransfer} loading={saving}>Переместить</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>Компонент *</label>
            <input list="wh-comp-list" value={transferForm.component_name} onChange={e => setTransferForm({ ...transferForm, component_name: e.target.value })} placeholder="Название компонента" style={{ width: "100%" }} />
            <datalist id="wh-comp-list">
              {components.map(c => <option key={c.id} value={c.name} />)}
            </datalist>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label>Откуда *</label>
              <select value={transferForm.from_warehouse_id} onChange={e => setTransferForm({ ...transferForm, from_warehouse_id: e.target.value })} style={{ width: "100%" }}>
                <option value="">— склад —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Куда *</label>
              <select value={transferForm.to_warehouse_id} onChange={e => setTransferForm({ ...transferForm, to_warehouse_id: e.target.value })} style={{ width: "100%" }}>
                <option value="">— склад —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Количество *</label>
            <input type="number" value={transferForm.quantity} onChange={e => setTransferForm({ ...transferForm, quantity: e.target.value })} style={{ width: "100%" }} />
          </div>
          <div>
            <label>Примечание</label>
            <input value={transferForm.note} onChange={e => setTransferForm({ ...transferForm, note: e.target.value })} style={{ width: "100%" }} />
          </div>
        </div>
      </Modal>

      {/* Add/Edit component modal */}
      <Modal
        open={showAdd}
        onClose={() => { setShowAdd(false); setEditComp(null); setError(""); }}
        title={editComp ? "Редактировать компонент" : "Добавить компонент"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowAdd(false); setEditComp(null); }}>Отмена</Button>
            <Button onClick={saveComponent} loading={saving}>{editComp ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          {[
            { label: "Название *", key: "name", type: "text" },
            { label: "Остаток", key: "stock", type: "number" },
            { label: "Мин. остаток", key: "min_stock", type: "number" },
            { label: "Единица", key: "unit", type: "text" },
            { label: "Комментарий", key: "comment", type: "text" },
          ].map(f => (
            <div key={f.key}>
              <label>{f.label}</label>
              <input type={f.type} value={(form as Record<string, string>)[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />
            </div>
          ))}
          <div>
            <label>Категория</label>
            <input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} list="cats-list" />
            <datalist id="cats-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
          <div>
            <label>Блок</label>
            <select value={form.block} onChange={e => setForm({ ...form, block: e.target.value })}>
              {["СМД","ТХТ","Прочее"].map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label>Источник</label>
            <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      {/* Batch modal */}
      <Modal
        open={!!showBatch}
        onClose={() => { setShowBatch(null); setError(""); }}
        title={showBatch === "incoming" ? "Оприходование" : "Списание"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowBatch(null)}>Отмена</Button>
            <Button onClick={doBatch} loading={saving}>{showBatch === "incoming" ? "Оприходовать" : "Списать"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          {batchItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                {i === 0 && <label>Компонент</label>}
                <input
                  value={item.name}
                  onChange={e => { const n = [...batchItems]; n[i].name = e.target.value; setBatchItems(n); }}
                  list="comp-list"
                  placeholder="Название компонента"
                />
              </div>
              <div style={{ width: 100 }}>
                {i === 0 && <label>Кол-во</label>}
                <input
                  type="number"
                  value={item.qty}
                  onChange={e => { const n = [...batchItems]; n[i].qty = e.target.value; setBatchItems(n); }}
                  placeholder="0"
                  min="0"
                />
              </div>
              {batchItems.length > 1 && (
                <button
                  onClick={() => setBatchItems(batchItems.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", paddingBottom: 8, fontSize: 16 }}
                >×</button>
              )}
            </div>
          ))}
          <datalist id="comp-list">{components.map(c => <option key={c.id} value={c.name} />)}</datalist>
          <Button variant="ghost" size="sm" onClick={() => setBatchItems([...batchItems, { name: "", qty: "" }])}>
            + Добавить строку
          </Button>
          {showBatch === "writeoff" && (
            <>
              <div>
                <label>Причина списания</label>
                <select value={writeoffReason} onChange={e => setWriteoffReason(e.target.value)}>
                  <option value="production">В запасы производства</option>
                  <option value="issued">Выдано сотруднику</option>
                  <option value="defect">Брак</option>
                  <option value="other">Другое</option>
                </select>
              </div>
              {writeoffReason === "production" && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
                  <input type="checkbox" checked={toProduction} onChange={e => setToProduction(e.target.checked)} style={{ width: 15, height: 15 }} />
                  Зачислить в запасы производства
                </label>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Add/Edit case modal */}
      <Modal
        open={showCaseModal}
        onClose={() => { setShowCaseModal(false); setEditCase(null); setError(""); }}
        title={editCase ? "Редактировать корпус" : "Добавить корпус"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowCaseModal(false); setEditCase(null); }}>Отмена</Button>
            <Button onClick={saveCase} loading={saving}>{editCase ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          {[
            { label: "Название *", key: "name", type: "text" },
            { label: "Остаток", key: "stock", type: "number" },
            { label: "Мин. остаток", key: "min_stock", type: "number" },
            { label: "Цвет", key: "color", type: "text" },
            { label: "Материал", key: "material", type: "text" },
            { label: "Комментарий", key: "comment", type: "text" },
          ].map(f => (
            <div key={f.key}>
              <label>{f.label}</label>
              <input type={f.type} value={(caseForm as Record<string, string>)[f.key]} onChange={e => setCaseForm({ ...caseForm, [f.key]: e.target.value })} />
            </div>
          ))}
          <div>
            <label>Источник</label>
            <select value={caseForm.source} onChange={e => setCaseForm({ ...caseForm, source: e.target.value })}>
              <option value="warehouse">Склад</option>
              <option value="3d_print">3D Печать</option>
              <option value="purchase">Закупка</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Adjust case stock modal */}
      <Modal
        open={adjustCaseId !== null}
        onClose={() => { setAdjustCaseId(null); setError(""); }}
        title="Корректировка остатка корпуса"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjustCaseId(null)}>Отмена</Button>
            <Button onClick={doAdjustCase} loading={saving}>Применить</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>Изменение (+ или −)</label>
            <input type="number" value={adjustDelta} onChange={e => setAdjustDelta(e.target.value)} placeholder="например: 10 или -5" />
          </div>
          <div>
            <label>Комментарий</label>
            <input value={adjustComment} onChange={e => setAdjustComment(e.target.value)} placeholder="Причина корректировки" />
          </div>
        </div>
      </Modal>
      {/* History modal */}
      <Modal
        open={!!historyComp}
        onClose={() => { setHistoryComp(null); setHistoryOps([]); }}
        title={`История — ${historyComp?.name}`}
        size="lg"
      >
        {historyLoading ? (
          <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>Загрузка...</div>
        ) : historyOps.length === 0 ? (
          <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>История операций пуста</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  {["Дата","Тип","Количество","Примечание","Операция ID"].map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {historyOps.map((op, idx) => {
                  const isIn = op.operation_type === "RECEIVE";
                  return (
                    <tr key={idx}>
                      <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{op.created_at ? new Date(op.created_at).toLocaleString("ru") : "—"}</td>
                      <td>
                        <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: isIn ? "#10b98120" : "#ef444420", color: isIn ? "#10b981" : "#ef4444" }}>
                          {op.operation_type === "RECEIVE" ? "Приход" : op.operation_type === "WRITEOFF" ? "Списание" : op.operation_type}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: isIn ? "#10b981" : "#ef4444" }}>{isIn ? "+" : "-"}{op.quantity}</td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 200 }}>{op.note || "—"}</td>
                      <td style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{op.operation_id || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </AppLayout>
  );
}
