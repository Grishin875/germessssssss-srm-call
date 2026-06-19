"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { toast } from "../../components/ui/Toast";
import { api, Order } from "../../lib/api";
import { exportToExcel, Row as ExcelRow } from "../../lib/excel";

// Доступные колонки отчёта по заказам
const COLUMNS: { key: keyof Order; label: string; render?: (o: Order) => string | number }[] = [
  { key: "id", label: "ID" },
  { key: "product_name", label: "Изделие" },
  { key: "planned_qty", label: "План, шт" },
  { key: "actual_qty", label: "Факт, шт", render: o => o.actual_qty ?? 0 },
  { key: "status", label: "Статус" },
  { key: "priority", label: "Приоритет" },
  { key: "assigned_department", label: "Отдел", render: o => o.assigned_department ?? "" },
  { key: "assigned_operator_name", label: "Оператор", render: o => o.assigned_operator_name ?? "" },
  { key: "deadline", label: "Срок", render: o => o.deadline ? new Date(o.deadline).toLocaleDateString("ru") : "" },
  { key: "created_at", label: "Создан", render: o => new Date(o.created_at).toLocaleDateString("ru") },
  { key: "comment", label: "Комментарий", render: o => o.comment ?? "" },
];

const ALL_STATUSES = ["Создан","В работе","На проверке ОТК","Доработка","Ожидает компонентов","Готов к отгрузке","Завершен","Отменен"];
const STORAGE = "germess_report_templates";

export default function ReportsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [cols, setCols] = useState<Set<string>>(new Set(["id", "product_name", "planned_qty", "status", "priority", "deadline"]));
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<string>("");
  const [data, setData] = useState<Order[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [templates, setTemplates] = useState<{ name: string; cols: string[]; statuses: string[]; groupBy: string }[]>([]);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE); if (raw) setTemplates(JSON.parse(raw)); } catch {}
  }, []);
  useEffect(() => { if (user) run(); /* первичная загрузка */ }, [user]);

  async function run() {
    setLoadingData(true);
    try {
      const inc = statuses.size ? [...statuses].join(",") : ALL_STATUSES.join(",");
      let rows = await api.getOrders(undefined, search.trim() || undefined, inc);
      if (fromDate) rows = rows.filter(o => new Date(o.created_at) >= new Date(fromDate));
      if (toDate) rows = rows.filter(o => new Date(o.created_at) <= new Date(toDate + "T23:59:59"));
      setData(rows);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setLoadingData(false);
  }

  const activeCols = COLUMNS.filter(c => cols.has(String(c.key)));

  // Группировка
  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const gc = COLUMNS.find(c => String(c.key) === groupBy);
    const map: Record<string, Order[]> = {};
    data.forEach(o => {
      const key = String(gc?.render ? gc.render(o) : o[groupBy as keyof Order] ?? "—") || "—";
      (map[key] ||= []).push(o);
    });
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [data, groupBy]);

  function cell(o: Order, c: typeof COLUMNS[number]): string | number {
    if (c.render) return c.render(o);
    const v = o[c.key];
    return (v == null ? "" : typeof v === "boolean" ? (v ? "да" : "нет") : v) as string | number;
  }

  function exportReport() {
    const rows: ExcelRow[] = data.map(o => {
      const r: ExcelRow = {};
      activeCols.forEach(c => { r[c.label] = cell(o, c) as string | number; });
      return r;
    });
    if (!rows.length) { toast.warning("Нет данных"); return; }
    exportToExcel(rows, "Отчёт_заказы", "Отчёт").then(() => toast.success(`Экспортировано: ${rows.length}`));
  }

  function saveTemplate() {
    const name = prompt("Название шаблона отчёта:");
    if (!name?.trim()) return;
    const t = { name: name.trim(), cols: [...cols], statuses: [...statuses], groupBy };
    const next = [...templates.filter(x => x.name !== t.name), t];
    setTemplates(next);
    localStorage.setItem(STORAGE, JSON.stringify(next));
    toast.success("Шаблон сохранён");
  }
  function applyTemplate(name: string) {
    const t = templates.find(x => x.name === name);
    if (!t) return;
    setCols(new Set(t.cols)); setStatuses(new Set(t.statuses)); setGroupBy(t.groupBy);
  }

  if (loading || !user) return null;

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0 }}>Конструктор отчётов</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>Выберите колонки, фильтры и группировку — выгрузите в Excel</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {templates.length > 0 && (
              <select value="" onChange={e => e.target.value && applyTemplate(e.target.value)} style={{ maxWidth: 180 }}>
                <option value="">★ Шаблоны…</option>
                {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            )}
            <Button variant="ghost" size="sm" onClick={saveTemplate}>★ Сохранить шаблон</Button>
            <Button variant="secondary" size="sm" onClick={exportReport}>⬇ Excel</Button>
          </div>
        </div>

        {/* Колонки */}
        <Card title="Колонки">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {COLUMNS.map(c => {
              const on = cols.has(String(c.key));
              return (
                <button key={String(c.key)} onClick={() => setCols(s => { const n = new Set(s); n.has(String(c.key)) ? n.delete(String(c.key)) : n.add(String(c.key)); return n; })}
                  style={{ padding: "6px 12px", borderRadius: 8, border: `1.5px solid ${on ? "var(--primary)" : "var(--border)"}`, background: on ? "var(--primary-light)" : "transparent", color: on ? "var(--primary-text)" : "var(--text-secondary)", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  {on ? "✓ " : ""}{c.label}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Фильтры */}
        <Card title="Фильтры и группировка">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
            <div>
              <label>Поиск</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="изделие / ID" style={{ width: 160 }} />
            </div>
            <div>
              <label>Создан с</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </div>
            <div>
              <label>по</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
            </div>
            <div>
              <label>Группировка</label>
              <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                <option value="">Без группировки</option>
                {["status", "priority", "assigned_department"].map(k => {
                  const c = COLUMNS.find(x => String(x.key) === k)!;
                  return <option key={k} value={k}>{c.label}</option>;
                })}
              </select>
            </div>
            <Button onClick={run} loading={loadingData}>Построить</Button>
          </div>
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALL_STATUSES.map(s => {
              const on = statuses.has(s);
              return (
                <button key={s} onClick={() => setStatuses(x => { const n = new Set(x); n.has(s) ? n.delete(s) : n.add(s); return n; })}
                  style={{ padding: "4px 10px", borderRadius: 7, border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`, background: on ? "var(--primary-light)" : "transparent", color: on ? "var(--primary-text)" : "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>
                  {s}
                </button>
              );
            })}
          </div>
        </Card>

        {/* Результат */}
        <Card title={`Результат — ${data.length} строк`}>
          {loadingData ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>Загрузка...</div>
          ) : data.length === 0 ? (
            <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)" }}>Нет данных — измените фильтры</div>
          ) : grouped ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {grouped.map(([g, rows]) => (
                <div key={g}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{g} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({rows.length})</span></div>
                  <ReportTable cols={activeCols} rows={rows} cell={cell} />
                </div>
              ))}
            </div>
          ) : (
            <ReportTable cols={activeCols} rows={data} cell={cell} />
          )}
        </Card>
      </div>
    </AppLayout>
  );
}

function ReportTable({ cols, rows, cell }: {
  cols: typeof COLUMNS; rows: Order[];
  cell: (o: Order, c: typeof COLUMNS[number]) => string | number;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead><tr>{cols.map(c => <th key={String(c.key)}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map(o => (
            <tr key={o.id}>
              {cols.map(c => (
                <td key={String(c.key)}>
                  {c.key === "status" ? <Badge status={o.status} /> : String(cell(o, c))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
