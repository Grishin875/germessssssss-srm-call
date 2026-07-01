"use client";
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api, Recipe, RecipeCase, RecipeStage, Case, Component, SystemRoleItem } from "../../lib/api";
import { useStageTypes } from "../../hooks/useStageTypes";
import { StagesBuilder, StageRow, newStageRow } from "../../components/ui/StagesBuilder";
import { exportToExcel, parseExcelFile, Row as ExcelRow } from "../../lib/excel";
import { toast } from "../../components/ui/Toast";

type CompRow = { component_name: string; warehouse_component_name: string; norm: string; designator: string; board_side: string };
const emptyRow = (): CompRow => ({ component_name: "", warehouse_component_name: "", norm: "", designator: "", board_side: "" });

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

const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
  warehouse: { label: "Склад",       color: "#0ea5e9" },
  smd:       { label: "СМД",         color: "#8b5cf6" },
  engraving: { label: "Гравировка",  color: "#f59e0b" },
  "3d_print":{ label: "3D Печать",   color: "#10b981" },
  purchase:  { label: "Закупка",     color: "#f97316" },
  product:   { label: "Под-изделие", color: "#ec4899" },  // полуфабрикат своего производства
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

function StockBadge({ stock }: { stock?: number }) {
  const n = stock ?? 0;
  const color = n > 10 ? "#10b981" : n > 0 ? "#f59e0b" : "#ef4444";
  return <span style={{ fontWeight: 600, color, fontSize: 13 }}>{n}</span>;
}

function ComponentSearch({ value, onChange, components }: {
  value: string;
  onChange: (name: string) => void;
  components: Component[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Пока меню открыто — держим позицию актуальной при скролле/ресайзе (fixed-координаты «стареют»).
  useEffect(() => {
    if (!open) return;
    const onMove = () => updatePosition();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function updatePosition() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const GAP = 8, MENU_MAX = 220;
    // Ширина не больше вьюпорта; left зажат так, чтобы меню не уезжало за правый край.
    const width = Math.min(Math.max(rect.width, 260), window.innerWidth - 2 * GAP);
    const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP));
    // Если снизу мало места — раскрываем вверх.
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    const openUp = below < Math.min(MENU_MAX, 160) && above > below;
    const maxHeight = Math.max(120, Math.min(MENU_MAX, (openUp ? above : below) - GAP));
    setDropdownStyle({
      position: "fixed",
      left,
      width,
      zIndex: 99999,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 2 } : { top: rect.bottom + 2 }),
      background: "var(--bg-secondary, #fff)",
      border: "1px solid var(--border, #e5e7eb)",
      borderRadius: 6,
      maxHeight,
      overflowY: "auto",
      boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
    });
  }

  const filtered = components
    .filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 25);

  const dropdown = open && filtered.length > 0 ? createPortal(
    <div style={dropdownStyle} onMouseDown={e => e.preventDefault()}>
      {filtered.map(c => {
        const qty = c.stock ?? 0;
        const qColor = qty > 10 ? "#10b981" : qty > 0 ? "#f59e0b" : "#ef4444";
        return (
          <div
            key={c.id}
            onMouseDown={() => { setQuery(c.name); onChange(c.name); setOpen(false); }}
            style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-secondary, #f9fafb)")}
            onMouseLeave={e => (e.currentTarget.style.background = "")}
          >
            <span style={{ flex: 1 }}>{c.name}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: qColor, whiteSpace: "nowrap" }}>{qty} шт</span>
          </div>
        );
      })}
    </div>,
    document.body
  ) : null;

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); updatePosition(); }}
        onFocus={() => { setOpen(true); updatePosition(); }}
        placeholder="Поиск по складу…"
        style={{ fontSize: 13, minWidth: 180 }}
      />
      {dropdown}
    </div>
  );
}

function CompRowsTable({ rows, setRows, showBoardSide, components }: {
  rows: CompRow[];
  setRows: React.Dispatch<React.SetStateAction<CompRow[]>>;
  showBoardSide: boolean;
  components: Component[];
}) {
  const upd = (i: number, field: keyof CompRow, v: string) =>
    setRows(r => { const n = [...r]; n[i] = { ...n[i], [field]: v }; return n; });
  const addRow = () => setRows(r => [...r, emptyRow()]);
  const filled = rows.filter(r => r.component_name.trim() && r.norm).length;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["#", "Компонент (склад) *", "Норма *", "Десигн.", ...(showBoardSide ? ["Сторона"] : []), ""].map(h => (
                <th key={h} style={{ textAlign: "left", padding: "3px 6px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              // Enter в строке (кроме поля поиска компонента) — добавить новую строку
              const onEnter = (e: React.KeyboardEvent) => {
                if (e.key === "Enter") { e.preventDefault(); if (i === rows.length - 1) addRow(); }
              };
              return (
              <tr key={i}>
                <td style={{ padding: "3px 6px", width: 20, fontSize: 12, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{i + 1}</td>
                <td style={{ padding: "3px 4px" }}>
                  <ComponentSearch
                    value={row.component_name}
                    onChange={v => upd(i, "component_name", v)}
                    components={components}
                  />
                </td>
                <td style={{ padding: "3px 4px", width: 80 }}>
                  <input type="number" value={row.norm} onChange={e => upd(i, "norm", e.target.value)}
                    onKeyDown={onEnter}
                    min="0" step="0.001" placeholder="1" style={{ fontSize: 13, width: 70 }} />
                </td>
                <td style={{ padding: "3px 4px", width: 90 }}>
                  <input value={row.designator} onChange={e => upd(i, "designator", e.target.value)}
                    onKeyDown={onEnter}
                    placeholder="R1, C2…" style={{ fontSize: 13, width: 80 }} />
                </td>
                {showBoardSide && (
                  <td style={{ padding: "3px 4px", width: 90 }}>
                    <select value={row.board_side} onChange={e => upd(i, "board_side", e.target.value)}
                      style={{ fontSize: 13, width: 80 }}>
                      <option value="">—</option>
                      <option value="TOP">TOP</option>
                      <option value="BOTTOM">BOTTOM</option>
                    </select>
                  </td>
                )}
                <td style={{ padding: "3px 4px", width: 28 }}>
                  {rows.length > 1 && (
                    <button onClick={() => setRows(r => r.filter((_, j) => j !== i))}
                      title="Удалить строку"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
                      onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                    ><IcoTrash /></button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 12 }}>
        <button
          onClick={addRow}
          style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "none", cursor: "pointer" }}
        >+ Добавить компонент</button>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {filled} из {rows.length} заполнено · <kbd style={{ fontSize: 10, padding: "1px 5px", borderRadius: 4, background: "var(--bg-tertiary)", border: "1px solid var(--border)" }}>Enter</kbd> — новая строка
        </span>
      </div>
    </div>
  );
}

export default function RecipesPage() {
  const { user, loading, hasPermission } = useAuth();
  const { stageTypes, labelMap: STAGE_TYPE_LABELS_HOOK } = useStageTypes();
  const router = useRouter();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeCases, setRecipeCases] = useState<RecipeCase[]>([]);
  const [recipeStages, setRecipeStages] = useState<RecipeStage[]>([]);
  const [allCases, setAllCases] = useState<Case[]>([]);
  const [catalog, setCatalog] = useState<import("../../lib/api").ProductCatalogItem[]>([]);
  const recipeImportRef = useRef<HTMLInputElement>(null);
  const [importingRecipe, setImportingRecipe] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (product: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(product)) next.delete(product); else next.add(product);
    return next;
  });

  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Recipe form
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<Recipe | null>(null);
  const [form, setForm] = useState({
    component_name: "", product_name: "", norm: "",
    production_type: "SMD", source: "warehouse",
    warehouse_component_name: "", designator: "", board_side: "",
    stage_id: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // RecipeCase form
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [editRCase, setEditRCase] = useState<RecipeCase | null>(null);
  const [rcForm, setRcForm] = useState({ product_name: "", case_name: "", source: "warehouse", qty: "1", comment: "" });

  // RecipeStage form
  const [showStageModal, setShowStageModal] = useState(false);
  const [editRStage, setEditRStage] = useState<RecipeStage | null>(null);
  const [rsForm, setRsForm] = useState({ product_name: "", stage_name: "", stage_type: "assembly", sort_order: "0", description: "", instructions: "", required_role: "", depends_on_previous: "1", transfer_qty: "0", output_name: "" });

  // System roles for stage form
  const [systemRoles, setSystemRoles] = useState<SystemRoleItem[]>([]);

  // Create Product (multi-component) form
  const [allComponents, setAllComponents] = useState<Component[]>([]);
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [cpProductName, setCpProductName] = useState("");
  const [productType, setProductType] = useState("SMD");
  const [cpDepartments, setCpDepartments] = useState<string[]>(["SMD"]);
  const [cpRows, setCpRows] = useState<CompRow[]>([emptyRow()]);
  const [cpStages, setCpStages] = useState<StageRow[]>([]);
  const [cpSaving, setCpSaving] = useState(false);
  const [cpError, setCpError] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    load();
    api.getCases().then(setAllCases).catch(console.error);
    api.getComponents().then(setAllComponents).catch(console.error);
    api.getSystemRoles().then(r => setSystemRoles(r.filter(x => x.is_active))).catch(console.error);
  }, [user]);

  async function load() {
    setFetching(true);
    try {
      const [r, rc, rs, cat] = await Promise.all([api.getRecipes(), api.getRecipeCases(), api.getRecipeStages(), api.getCatalog({ active_only: true }).catch(() => [])]);
      setRecipes(r);
      setRecipeCases(rc);
      setRecipeStages(rs);
      setCatalog(cat);
    } catch {}
    setFetching(false);
  }

  // ── Excel экспорт/импорт рецептур (строки компонент↔изделие) ────────────────
  function exportRecipesExcel() {
    const rows: ExcelRow[] = recipes.map(r => ({
      "Изделие": r.product_name,
      "Компонент": r.component_name,
      "Норма": r.norm,
      "Тип производства": r.production_type,
      "Компонент склада": r.warehouse_component_name ?? "",
      "Позиция (designator)": r.designator ?? "",
      "Сторона платы": r.board_side ?? "",
    }));
    if (!rows.length) { toast.warning("Нет рецептур для экспорта"); return; }
    exportToExcel(rows, "Рецептуры", "Рецептуры").then(() => toast.success(`Экспортировано: ${rows.length}`));
  }

  async function onImportRecipes(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) e.target.value = "";
    if (!file) return;
    let rows: ExcelRow[];
    try { rows = await parseExcelFile(file); }
    catch { toast.error("Не удалось прочитать файл"); return; }
    const cleaned = rows.filter(r =>
      String(r["Изделие"] ?? r["product_name"] ?? "").trim() &&
      String(r["Компонент"] ?? r["component_name"] ?? "").trim()
    );
    if (!cleaned.length) { toast.error("Нужны колонки «Изделие» и «Компонент»"); return; }
    if (!confirm(`Импортировать ${cleaned.length} строк рецептуры?`)) return;
    setImportingRecipe(true);
    let ok = 0, err = 0;
    for (const r of cleaned) {
      try {
        await api.createRecipe({
          product_name: String(r["Изделие"] ?? r["product_name"]).trim(),
          component_name: String(r["Компонент"] ?? r["component_name"]).trim(),
          norm: Number(r["Норма"] ?? r["norm"] ?? 1) || 1,
          production_type: String(r["Тип производства"] ?? r["production_type"] ?? "SMD").trim() || "SMD",
          warehouse_component_name: String(r["Компонент склада"] ?? r["warehouse_component_name"] ?? "").trim() || undefined,
          designator: String(r["Позиция (designator)"] ?? r["designator"] ?? "").trim() || undefined,
          board_side: String(r["Сторона платы"] ?? r["board_side"] ?? "").trim() || undefined,
        } as Partial<Recipe>);
        ok++;
      } catch { err++; }
    }
    setImportingRecipe(false);
    if (ok) { toast.success(`Импортировано строк: ${ok}${err ? `, ошибок: ${err}` : ""}`); load(); }
    else toast.error(`Импорт не удался (ошибок: ${err})`);
  }

  async function save() {
    if (!form.component_name.trim() || !form.product_name.trim() || !form.norm) {
      setError("Заполните обязательные поля"); return;
    }
    setSaving(true); setError("");
    try {
      const data = {
        ...form,
        norm: Number(form.norm),
        board_side: form.board_side || undefined,
        warehouse_component_name: form.warehouse_component_name || undefined,
        designator: form.designator || undefined,
        stage_id: form.stage_id ? Number(form.stage_id) : null,
      };
      if (editItem) await api.updateRecipe(editItem.id, data);
      else await api.createRecipe(data);
      setShowAdd(false); setEditItem(null);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  const PRODUCTION_TYPE_TO_ROLE: Record<string, string> = {
    "SMD": "operator_smd",
    "Сборка": "montažnik",
    "3D Печать": "operator_3d",
    "Гравировка": "operator_engraving",
  };

  const PRODUCTION_TYPE_TO_STAGE: Record<string, string> = {
    "SMD": "smd",
    "Сборка": "assembly",
    "3D Печать": "3d_print",
    "Гравировка": "engraving",
  };

  const STAGE_TO_PRODUCTION_TYPE: Record<string, string> = {
    "smd": "SMD",
    "assembly": "Сборка",
    "3d_print": "3D Печать",
    "engraving": "Гравировка",
  };

  // Порядок отделов в маршруте: подготовительные → финальная сборка
  const DEPT_ROUTE_ORDER = ["SMD", "3D Печать", "Гравировка", "Сборка"];
  const PREP_DEPTS = ["SMD", "3D Печать", "Гравировка"];

  function buildStagesFromDepartments(depts: string[]): StageRow[] {
    const ordered = DEPT_ROUTE_ORDER.filter(d => depts.includes(d));
    const preps = ordered.filter(d => PREP_DEPTS.includes(d));
    return ordered.map(dept => {
      const stageType = PRODUCTION_TYPE_TO_STAGE[dept] || "assembly";
      // Подготовительные отделы — параллельная группа (одинаковый sort_order),
      // сборка идёт следом и ждёт их завершения
      const isPrep = PREP_DEPTS.includes(dept);
      const parallel = isPrep && preps.length > 1;
      return {
        ...newStageRow(stageType, isPrep ? 0 : (preps.length > 0 ? 1 : 0)),
        stage_name: dept,
        required_role: PRODUCTION_TYPE_TO_ROLE[dept] || "",
        depends_on_previous: parallel ? 0 : 1,
      };
    });
  }

  function toggleDepartment(dept: string) {
    setCpDepartments(prev => {
      const next = prev.includes(dept) ? prev.filter(d => d !== dept) : [...prev, dept];
      if (next.length === 0) return prev; // минимум один отдел
      const ordered = DEPT_ROUTE_ORDER.filter(d => next.includes(d));
      setProductType(ordered[0]);
      setCpStages(buildStagesFromDepartments(next));
      return next;
    });
  }

  async function saveProduct() {
    if (!cpProductName.trim()) { setCpError("Введите название изделия"); return; }
    if (!cpDepartments.length) { setCpError("Выберите хотя бы один отдел-исполнитель"); return; }
    const validRows = cpRows.filter(r => r.component_name.trim() && r.norm);
    if (!validRows.length) { setCpError("Добавьте хотя бы один компонент"); return; }
    setCpSaving(true); setCpError("");
    try {
      const pname = cpProductName.trim();
      // Build component → stage_type mapping from stage assignments
      const componentStageMap: Record<string, string> = {};
      cpStages.forEach(s => {
        (s.components ?? []).forEach(cname => { componentStageMap[cname] = s.stage_type; });
      });
      // 1. Save components
      await Promise.all(validRows.map(row => {
        const cname = row.component_name.trim();
        const stageType = componentStageMap[cname];
        const prodType = (stageType && STAGE_TO_PRODUCTION_TYPE[stageType]) || productType;
        return api.createRecipe({
          component_name: cname,
          product_name: pname,
          norm: Number(row.norm),
          production_type: prodType,
          source: "warehouse",
          warehouse_component_name: row.warehouse_component_name || undefined,
          designator: row.designator || undefined,
          board_side: stageType === "smd" ? (row.board_side || undefined) : undefined,
        });
      }));
      // 2. Save stages
      const validStages = cpStages.filter(s => s.stage_type);
      await Promise.all(validStages.map(s => api.createRecipeStage({
        product_name: pname,
        stage_name: s.stage_name.trim() || s.stage_type,
        stage_type: s.stage_type,
        sort_order: s.sort_order,
        required_role: s.required_role || undefined,
        depends_on_previous: s.depends_on_previous,
      })));
      setShowCreateProduct(false);
      setCpProductName(""); setCpRows([emptyRow()]); setProductType("SMD"); setCpStages([]);
      setCpDepartments(["SMD"]);
      load();
    } catch (e: unknown) { setCpError(e instanceof Error ? e.message : "Ошибка"); }
    setCpSaving(false);
  }

  async function saveRecipeStage() {
    if (!rsForm.stage_name.trim() || !rsForm.product_name) { setError("Заполните обязательные поля"); return; }
    setSaving(true); setError("");
    try {
      const data = {
        product_name: rsForm.product_name,
        stage_name: rsForm.stage_name.trim(),
        stage_type: rsForm.stage_type,
        sort_order: Number(rsForm.sort_order),
        description: rsForm.description || undefined,
        instructions: rsForm.instructions || undefined,
        required_role: rsForm.required_role || undefined,
        depends_on_previous: Number(rsForm.depends_on_previous),
        transfer_qty: Number(rsForm.transfer_qty),
        output_name: rsForm.output_name.trim(),   // "" очищает результат этапа
      };
      if (editRStage) await api.updateRecipeStage(editRStage.id, data);
      else await api.createRecipeStage(data);
      setShowStageModal(false); setEditRStage(null);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function saveRecipeCase() {
    if (!rcForm.case_name || !rcForm.product_name) { setError("Заполните обязательные поля"); return; }
    setSaving(true); setError("");
    try {
      const data = { product_name: rcForm.product_name, case_name: rcForm.case_name, source: rcForm.source, qty: Number(rcForm.qty), comment: rcForm.comment || undefined };
      if (editRCase) await api.updateRecipeCase(editRCase.id, data);
      else await api.createRecipeCase(data);
      setShowCaseModal(false); setEditRCase(null);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  if (loading || !user) return null;

  // Изделия = из рецептур + из каталога (двусторонняя связь рецептура↔каталог)
  const products = [...new Set([...recipes.map(r => r.product_name), ...catalog.map(c => c.name)])].sort();
  const types = [...new Set(recipes.map(r => r.production_type))];

  const filtered = recipes.filter(r => {
    if (productFilter && r.product_name !== productFilter) return false;
    if (typeFilter && r.production_type !== typeFilter) return false;
    if (search && !r.component_name.toLowerCase().includes(search.toLowerCase()) && !r.product_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const grouped: Record<string, Recipe[]> = {};
  filtered.forEach(r => { (grouped[r.product_name] = grouped[r.product_name] || []).push(r); });
  // Каталожные изделия без рецептуры показываем пустыми карточками (реверс каталог→рецептура),
  // если они проходят активные фильтры по изделию.
  if (!search && !typeFilter) {
    catalog.forEach(c => {
      if (productFilter && c.name !== productFilter) return;
      if (!(c.name in grouped)) grouped[c.name] = [];
    });
  }

  const rcByProduct: Record<string, RecipeCase[]> = {};
  recipeCases.forEach(rc => { (rcByProduct[rc.product_name] = rcByProduct[rc.product_name] || []).push(rc); });

  const rsByProduct: Record<string, RecipeStage[]> = {};
  recipeStages.forEach(rs => { (rsByProduct[rs.product_name] = rsByProduct[rs.product_name] || []).push(rs); });

  const STAGE_TYPE_LABELS: Record<string, { label: string; color: string }> = { ...STAGE_TYPE_LABELS_HOOK, other: { label: "Прочее", color: "#6b7280" } };

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h1>Рецептура</h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button variant="ghost" size="sm" onClick={exportRecipesExcel}>⬇ Excel</Button>
            {hasPermission("recipes.edit") && (
              <>
                <Button variant="secondary" size="sm" onClick={() => recipeImportRef.current?.click()} loading={importingRecipe}>⬆ Импорт</Button>
                <input ref={recipeImportRef} type="file" accept=".xlsx,.xls,.csv" onChange={onImportRecipes} style={{ display: "none" }} />
              </>
            )}
          {hasPermission("recipes.edit") && (
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={() => {
                setShowCreateProduct(true);
                setCpProductName(""); setCpRows([emptyRow()]); setCpError(""); setProductType("SMD");
                setCpDepartments(["SMD"]);
                setCpStages(buildStagesFromDepartments(["SMD"]));
              }}>Создать продукт</Button>
              <Button variant="secondary" onClick={() => {
                setShowAdd(true); setEditItem(null);
                setForm({ component_name: "", product_name: "", norm: "", production_type: "SMD", source: "warehouse", warehouse_component_name: "", designator: "", board_side: "", stage_id: "" });
                setError("");
              }}>+ Компонент</Button>
            </div>
          )}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..." style={{ width: 220 }} />
          <select value={productFilter} onChange={e => setProductFilter(e.target.value)}>
            <option value="">Все изделия</option>
            {products.map(p => <option key={p}>{p}</option>)}
          </select>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">Все типы</option>
            {types.map(t => <option key={t}>{t}</option>)}
          </select>
          {Object.keys(grouped).length > 1 && (
            <button
              onClick={() => {
                const all = Object.keys(grouped);
                setCollapsed(prev => prev.size >= all.length ? new Set() : new Set(all));
              }}
              style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "1px solid var(--border)", borderRadius: 8, padding: "0 14px", height: 36, cursor: "pointer" }}
            >
              {collapsed.size >= Object.keys(grouped).length ? "Развернуть все" : "Свернуть все"}
            </button>
          )}
        </div>

        {/* Content */}
        {fetching ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Рецепты не найдены</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {Object.entries(grouped).map(([product, items]) => {
              const productCases = rcByProduct[product] || [];
              return (
                <Card key={product} title={product} actions={
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {(rsByProduct[product] || []).length > 0 && (
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{(rsByProduct[product] || []).length} этап.</span>
                    )}
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{items.length} комп.</span>
                    {hasPermission("recipes.edit") && (<>
                      <button
                        onClick={() => {
                          setRsForm({ product_name: product, stage_name: "", stage_type: "assembly", sort_order: "0", description: "", instructions: "", required_role: "", depends_on_previous: "1", transfer_qty: "0", output_name: "" });
                          setEditRStage(null); setShowStageModal(true); setError("");
                        }}
                        style={{ fontSize: 12, fontWeight: 600, color: "#8b5cf6", background: "none", border: "none", cursor: "pointer" }}
                      >+ Этап</button>
                      <button
                        onClick={() => {
                          setRcForm({ product_name: product, case_name: "", source: "warehouse", qty: "1", comment: "" });
                          setEditRCase(null); setShowCaseModal(true); setError("");
                        }}
                        style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "none", cursor: "pointer" }}
                      >+ Корпус</button>
                      <button
                        onClick={async () => {
                          const nn = prompt("Новое название изделия:", product);
                          if (nn === null) return;
                          const t = nn.trim();
                          if (!t || t === product) return;
                          try {
                            await api.renameProduct(product, t);
                            toast.success("Изделие переименовано");
                            load();
                          } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
                        }}
                        title="Переименовать изделие (каскадно во всех таблицах)"
                        style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)", background: "none", border: "none", cursor: "pointer" }}
                      >✎ Переименовать</button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Удалить изделие «${product}» полностью? Будут удалены все компоненты, этапы, корпуса и запись в каталоге. Действие необратимо.`)) return;
                          try {
                            const r = await api.deleteProductFull(product);
                            const d = r.deleted || {};
                            toast.success(`Изделие удалено (компонентов: ${d.recipes ?? 0}, этапов: ${d.stages ?? 0}, корпусов: ${d.cases ?? 0})`);
                            load();
                          } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
                        }}
                        title="Удалить изделие полностью"
                        style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", background: "none", border: "none", cursor: "pointer" }}
                      >🗑 Продукт</button>
                    </>)}
                    <button
                      onClick={() => toggleCollapse(product)}
                      title={collapsed.has(product) ? "Развернуть" : "Свернуть"}
                      style={{ display: "flex", alignItems: "center", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
                    >
                      <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24"
                        style={{ transform: collapsed.has(product) ? "rotate(-90deg)" : "none", transition: "transform 0.18s" }}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                }>
                  {collapsed.has(product) ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      {(rsByProduct[product] || []).sort((a, b) => a.sort_order - b.sort_order).map(rs => {
                        const st = STAGE_TYPE_LABELS[rs.stage_type] ?? STAGE_TYPE_LABELS.other;
                        return (
                          <span key={rs.id} style={{ fontSize: 11, fontWeight: 600, padding: "2px 9px", borderRadius: 20, background: st.color + "1c", color: st.color }}>
                            {rs.stage_name}
                          </span>
                        );
                      })}
                      {(rsByProduct[product] || []).length === 0 && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Свёрнуто · {items.length} компонентов</span>
                      )}
                    </div>
                  ) : (<>
                  {/* Stages for this product */}
                  {(rsByProduct[product] || []).length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Этапы производства</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {(rsByProduct[product] || []).sort((a, b) => a.sort_order - b.sort_order).map(rs => {
                          const st = STAGE_TYPE_LABELS[rs.stage_type] ?? STAGE_TYPE_LABELS.other;
                          return (
                            <div key={rs.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: st.color + "14", border: `1px solid ${st.color}44`, fontSize: 13 }}>
                              <span style={{ width: 20, height: 20, borderRadius: "50%", background: st.color + "33", color: st.color, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{rs.sort_order}</span>
                              <span style={{ fontWeight: 500 }}>{rs.stage_name}</span>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: st.color + "22", color: st.color }}>{st.label}</span>
                              {rs.depends_on_previous === 0 && (
                                <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe" }}>⟂ параллельно</span>
                              )}
                              {rs.required_role && (
                                <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>
                                  {systemRoles.find(r => r.code === rs.required_role)?.label || rs.required_role}
                                </span>
                              )}
                              {rs.output_name && (
                                <span title="Результат этапа — станет входом следующего" style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 10, background: "#8b5cf618", color: "#7c3aed" }}>
                                  → 📦 {rs.output_name}
                                </span>
                              )}
                              {rs.description && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{rs.description}</span>}
                              {hasPermission("recipes.edit") && (<>
                                <button
                                  title="Редактировать этап"
                                  onClick={() => {
                                    setEditRStage(rs);
                                    setRsForm({
                                      product_name: rs.product_name, stage_name: rs.stage_name,
                                      stage_type: rs.stage_type, sort_order: String(rs.sort_order ?? 0),
                                      description: rs.description || "", instructions: rs.instructions || "",
                                      required_role: rs.required_role || "",
                                      depends_on_previous: String(rs.depends_on_previous ?? 1),
                                      transfer_qty: String(rs.transfer_qty ?? 0),
                                      output_name: rs.output_name || "",
                                    });
                                    setShowStageModal(true); setError("");
                                  }}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
                                  onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                                  onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                ><IcoPencil /></button>
                                <button
                                  onClick={async () => { if (confirm("Удалить этап?")) { await api.deleteRecipeStage(rs.id); load(); } }}
                                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
                                  onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
                                  onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                ><IcoTrash /></button>
                              </>)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Cases for this product */}
                  {productCases.length > 0 && (
                    <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {productCases.map(rc => (
                        <div key={rc.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: "var(--bg-secondary)", border: "1px solid var(--border)", fontSize: 13 }}>
                          <span style={{ fontWeight: 500 }}>{rc.case_name}</span>
                          <SourceBadge source={rc.source} />
                          <span style={{ color: "var(--text-muted)" }}>× {rc.qty}</span>
                          {hasPermission("recipes.edit") && (
                            <button
                              onClick={async () => { if (confirm("Удалить корпус из рецепта?")) { await api.deleteRecipeCase(rc.id); load(); } }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}
                              onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
                              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                            ><IcoTrash /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Components table */}
                  <div style={{ overflowX: "auto" }}>
                    <table>
                      <thead>
                        <tr>
                          {["Компонент","Норма","Тип","Этап","Источник","Склад","Десигнатор","Сторона","Остаток",""].map(h => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.map(r => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 500 }}>{r.component_name}</td>
                            <td>{r.norm}</td>
                            <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.production_type}</td>
                            <td style={{ fontSize: 12 }}>
                              {(() => {
                                const st = r.stage_id ? (rsByProduct[r.product_name] || []).find(s => s.id === r.stage_id) : null;
                                return st
                                  ? <span style={{ fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 10, background: "var(--primary-light)", color: "var(--primary-text)" }}>{st.sort_order}. {st.stage_name}</span>
                                  : <span style={{ color: "var(--text-muted)" }}>авто</span>;
                              })()}
                            </td>
                            <td><SourceBadge source={r.source} /></td>
                            <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.warehouse_component_name || "—"}</td>
                            <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.designator || "—"}</td>
                            <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.board_side || "—"}</td>
                            <td><StockBadge stock={r.stock_on_warehouse} /></td>
                            <td>
                              {hasPermission("recipes.edit") && (
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    onClick={() => {
                                      setEditItem(r);
                                      setForm({ component_name: r.component_name, product_name: r.product_name, norm: String(r.norm), production_type: r.production_type, source: r.source || "warehouse", warehouse_component_name: r.warehouse_component_name || "", designator: r.designator || "", board_side: r.board_side || "", stage_id: r.stage_id && (rsByProduct[r.product_name] || []).some(s => s.id === r.stage_id) ? String(r.stage_id) : "" });
                                      setShowAdd(true); setError("");
                                    }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  ><IcoPencil /></button>
                                  <button
                                    onClick={async () => { if (confirm("Удалить?")) { await api.deleteRecipe(r.id); load(); } }}
                                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                                  ><IcoTrash /></button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>)}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Product modal */}
      <Modal
        open={showCreateProduct}
        onClose={() => { setShowCreateProduct(false); setCpError(""); }}
        title="Создать продукт"
        size="2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreateProduct(false)}>Отмена</Button>
            <Button onClick={saveProduct} loading={cpSaving}>Создать</Button>
          </>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {cpError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{cpError}</div>}
          <div>
            <label>Название изделия *</label>
            <input value={cpProductName} onChange={e => setCpProductName(e.target.value)} placeholder="Например: ГМ-10" />
          </div>

          {/* Отделы-исполнители — мультивыбор */}
          <div>
            <label>Отделы-исполнители * <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(можно несколько — маршрут соберётся автоматически)</span></label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 8 }}>
              {[
                { value: "SMD",        label: "СМД",        icon: "🔬", color: "#8b5cf6", desc: "Поверхностный монтаж" },
                { value: "Сборка",     label: "Монтаж",     icon: "🔧", color: "#0ea5e9", desc: "Финальная сборка" },
                { value: "3D Печать",  label: "3D Печать",  icon: "🖨️", color: "#10b981", desc: "Печать деталей" },
                { value: "Гравировка", label: "Гравировка", icon: "✒️", color: "#f59e0b", desc: "Нанесение маркировки" },
              ].map(opt => {
                const active = cpDepartments.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleDepartment(opt.value)}
                    style={{
                      position: "relative", textAlign: "left", padding: "12px 14px",
                      borderRadius: 10,
                      border: `1.5px solid ${active ? opt.color : "var(--border)"}`,
                      background: active
                        ? `color-mix(in srgb, ${opt.color} 12%, transparent)`
                        : "var(--bg-secondary)",
                      cursor: "pointer",
                      transition: "box-shadow 0.15s ease, border-color 0.15s ease, background 0.15s ease",
                      boxShadow: active ? "var(--shadow-sm)" : "var(--shadow-sm)",
                    }}
                    onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = opt.color + "88"; }}
                    onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
                  >
                    {active && (
                      <span style={{
                        position: "absolute", top: 8, right: 8, width: 18, height: 18, borderRadius: "50%",
                        background: opt.color, color: "#fff", fontSize: 11, fontWeight: 700,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>✓</span>
                    )}
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{opt.icon}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: active ? opt.color : "var(--text)", marginBottom: 2 }}>{opt.label}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{opt.desc}</div>
                  </button>
                );
              })}
            </div>
            {/* Превью маршрута */}
            {cpDepartments.length > 1 && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10,
                padding: "8px 12px", borderRadius: 8, background: "var(--primary-light)", fontSize: 12.5,
              }}>
                <span style={{ fontWeight: 600, color: "var(--primary-text)" }}>Маршрут:</span>
                {DEPT_ROUTE_ORDER.filter(d => cpDepartments.includes(d)).map((d, i, arr) => (
                  <span key={d} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600, color: "var(--text)" }}>{d}</span>
                    {PREP_DEPTS.includes(d) && i > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: "#eff6ff", color: "#3b82f6" }}>⟂</span>
                    )}
                    {i < arr.length - 1 && <span style={{ color: "var(--text-muted)" }}>→</span>}
                  </span>
                ))}
                <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>⟂ — параллельно</span>
              </div>
            )}
          </div>

          {/* Этапы производства */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Этапы производства</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Укажите какие отделы и в каком порядке работают</span>
            </div>
            <StagesBuilder
              stages={cpStages}
              onChange={setCpStages}
              stageTypes={stageTypes}
              systemRoles={systemRoles}
              availableComponents={cpRows.filter(r => r.component_name.trim()).map(r => r.component_name.trim())}
            />
          </div>

          {/* Компоненты */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background:
                productType === "SMD" ? "#8b5cf6" :
                productType === "Сборка" ? "#0ea5e9" :
                productType === "3D Печать" ? "#10b981" : "#f59e0b"
              }} />
              <span style={{ fontWeight: 700, fontSize: 14 }}>Компоненты</span>
            </div>
            <CompRowsTable
              rows={cpRows} setRows={setCpRows}
              showBoardSide={productType === "SMD" || cpStages.some(s => s.stage_type === "smd")}
              components={allComponents}
            />
          </div>
        </div>
      </Modal>

      {/* Add/Edit recipe modal */}
      <Modal
        open={showAdd}
        onClose={() => { setShowAdd(false); setEditItem(null); setError(""); }}
        title={editItem ? "Редактировать рецепт" : "Добавить рецепт"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowAdd(false); setEditItem(null); }}>Отмена</Button>
            <Button onClick={save} loading={saving}>{editItem ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>Компонент (склад) *</label>
            <ComponentSearch
              value={form.component_name}
              onChange={v => setForm(f => ({ ...f, component_name: v, warehouse_component_name: f.warehouse_component_name || v }))}
              components={allComponents}
            />
          </div>
          <div>
            <label>Изделие *</label>
            <input value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value, stage_id: "" })} />
          </div>
          <div>
            <label>Норма *</label>
            <input type="number" value={form.norm} onChange={e => setForm({ ...form, norm: e.target.value })} min="0" step="0.001" />
          </div>
          <div>
            <label>Компонент на складе</label>
            <ComponentSearch
              value={form.warehouse_component_name}
              onChange={v => setForm(f => ({ ...f, warehouse_component_name: v }))}
              components={allComponents}
            />
          </div>
          <div>
            <label>Десигнатор</label>
            <input value={form.designator} onChange={e => setForm({ ...form, designator: e.target.value })} />
          </div>
          <div>
            <label>Тип производства</label>
            <select value={form.production_type} onChange={e => setForm({ ...form, production_type: e.target.value })}>
              {["SMD","Сборка","Гравировка","3D Печать"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          {(rsByProduct[form.product_name] || []).length > 0 && (
            <div>
              <label>Этап (куда добавляется компонент)</label>
              <select value={form.stage_id} onChange={e => setForm({ ...form, stage_id: e.target.value })}>
                <option value="">— авто (по типу/источнику) —</option>
                {(rsByProduct[form.product_name] || []).sort((a, b) => a.sort_order - b.sort_order).map(s => (
                  <option key={s.id} value={String(s.id)}>{s.sort_order}. {s.stage_name}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                Компонент попадёт в список «что добавить» именно этого этапа.
              </div>
            </div>
          )}
          <div>
            <label>Источник компонента</label>
            <select value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {form.source === "product" && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                В поле «Компонент» укажите название изделия-полуфабриката из каталога —
                оно будет браться с готовой продукции, а на нехватку создастся отдельный под-заказ.
              </div>
            )}
          </div>
          <div>
            <label>Сторона платы</label>
            <select value={form.board_side} onChange={e => setForm({ ...form, board_side: e.target.value })}>
              <option value="">Не указана</option>
              <option value="TOP">TOP (верх)</option>
              <option value="BOTTOM">BOTTOM (низ)</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Add/Edit RecipeStage modal */}
      <Modal
        open={showStageModal}
        onClose={() => { setShowStageModal(false); setEditRStage(null); setError(""); }}
        title={editRStage ? "Редактировать этап" : "Добавить этап производства"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowStageModal(false); setEditRStage(null); }}>Отмена</Button>
            <Button onClick={saveRecipeStage} loading={saving}>{editRStage ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>Изделие</label>
            <input value={rsForm.product_name} readOnly style={{ background: "var(--bg-secondary)", cursor: "default" }} />
          </div>
          <div>
            <label>Название этапа *</label>
            <input value={rsForm.stage_name} onChange={e => setRsForm({ ...rsForm, stage_name: e.target.value })} placeholder="Например: Пайка СМД" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Тип этапа</label>
              <select value={rsForm.stage_type} onChange={e => setRsForm({ ...rsForm, stage_type: e.target.value })}>
                {stageTypes.filter(s => s.is_active).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label>Роль исполнителя</label>
              <select value={rsForm.required_role} onChange={e => setRsForm({ ...rsForm, required_role: e.target.value })}>
                <option value="">— Любой —</option>
                {systemRoles.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Результат этапа (что выходит)</label>
            <input
              value={rsForm.output_name}
              onChange={e => setRsForm({ ...rsForm, output_name: e.target.value })}
              placeholder="Например: Плата запаянная (полуфабрикат)"
            />
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Результат автоматически станет входом следующего этапа: «взять {rsForm.output_name.trim() || "полуфабрикат"} + добавить компоненты этапа».
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Порядок (sort_order)</label>
              <input type="number" value={rsForm.sort_order} onChange={e => setRsForm({ ...rsForm, sort_order: e.target.value })} min="0" />
            </div>
            <div>
              <label>Выполнение</label>
              <select value={rsForm.depends_on_previous} onChange={e => setRsForm({ ...rsForm, depends_on_previous: e.target.value })}>
                <option value="1">Последовательно (ждёт предыдущий)</option>
                <option value="0">Параллельно (одновременно)</option>
              </select>
            </div>
          </div>
          {rsForm.depends_on_previous === "0" && (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: "#eff6ff", border: "1px solid #bfdbfe", fontSize: 12, color: "#1d4ed8" }}>
              💡 <strong>Параллельные этапы:</strong> несколько этапов с одинаковым «Порядком» и «Параллельно» будут выполняться одновременно. Создайте столько этапов с одинаковым sort_order, сколько нужно отделов.
            </div>
          )}
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={rsForm.transfer_qty === "1"}
                onChange={e => setRsForm({ ...rsForm, transfer_qty: e.target.checked ? "1" : "0" })}
                style={{ width: 15, height: 15 }}
              />
              <span>Фиксировать передачу кол-ва следующему этапу</span>
            </label>
          </div>
          <div>
            <label>Краткое описание</label>
            <input value={rsForm.description} onChange={e => setRsForm({ ...rsForm, description: e.target.value })} placeholder="Необязательно" />
          </div>
          <div>
            <label>Инструкция для исполнителя</label>
            <textarea
              value={rsForm.instructions}
              onChange={e => setRsForm({ ...rsForm, instructions: e.target.value })}
              rows={4}
              placeholder="Подробно опишите как выполнять этап: что взять, как собрать, на что обратить внимание..."
            />
          </div>
        </div>
      </Modal>

      {/* Add/Edit RecipeCase modal */}
      <Modal
        open={showCaseModal}
        onClose={() => { setShowCaseModal(false); setEditRCase(null); setError(""); }}
        title={editRCase ? "Редактировать корпус рецепта" : "Добавить корпус к изделию"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowCaseModal(false); setEditRCase(null); }}>Отмена</Button>
            <Button onClick={saveRecipeCase} loading={saving}>{editRCase ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>Изделие</label>
            <input value={rcForm.product_name} readOnly style={{ background: "var(--bg-secondary)", cursor: "default" }} />
          </div>
          <div>
            <label>Корпус *</label>
            <input value={rcForm.case_name} onChange={e => setRcForm({ ...rcForm, case_name: e.target.value })} list="case-list" placeholder="Название корпуса" />
            <datalist id="case-list">{allCases.map(c => <option key={c.id} value={c.name} />)}</datalist>
          </div>
          <div>
            <label>Источник</label>
            <select value={rcForm.source} onChange={e => setRcForm({ ...rcForm, source: e.target.value })}>
              <option value="warehouse">Склад</option>
              <option value="3d_print">3D Печать</option>
              <option value="purchase">Закупка</option>
            </select>
          </div>
          <div>
            <label>Количество</label>
            <input type="number" value={rcForm.qty} onChange={e => setRcForm({ ...rcForm, qty: e.target.value })} min="1" />
          </div>
          <div>
            <label>Комментарий</label>
            <input value={rcForm.comment} onChange={e => setRcForm({ ...rcForm, comment: e.target.value })} />
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
