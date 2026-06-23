"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { api, OrderDemandResult } from "../../lib/api";
import { toast } from "../../components/ui/Toast";

const SOURCE_LABELS: Record<string, string> = {
  warehouse: "Склад", smd: "СМД", engraving: "Гравировка",
  "3d_print": "3D-печать", purchase: "Закупка",
};

function ProductPicker({ value, onChange, products }: {
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
        onFocus={() => setOpen(true)} placeholder="Изделие из спецификации…" style={{ width: "100%" }} />
      {open && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "var(--bg, #fff)", border: "1px solid var(--border, #e5e7eb)", borderRadius: 6, zIndex: 9999, maxHeight: 240, overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.12)" }}>
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

export default function ReservePage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();
  const [products, setProducts] = useState<string[]>([]);
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("");
  const [result, setResult] = useState<OrderDemandResult | null>(null);
  const [calcFor, setCalcFor] = useState<{ product: string; qty: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [creatingPr, setCreatingPr] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => {
    if (!user) return;
    Promise.all([
      api.getRecipes().then(r => r.map(x => x.product_name)).catch(() => []),
      api.getCatalog({ active_only: true }).then(c => c.map(x => x.name)).catch(() => []),
    ]).then(([a, b]) => {
      setProducts(Array.from(new Set([...a, ...b])).filter(Boolean).sort((x, y) => x.localeCompare(y, "ru")));
    });
  }, [user]);

  // Только складские позиции участвуют в резерве со склада
  const warehouseRows = useMemo(
    () => (result?.components ?? []).filter(c => c.source === "warehouse"),
    [result]
  );
  const shortageRows = useMemo(() => warehouseRows.filter(c => c.shortage > 0), [warehouseRows]);

  async function calculate() {
    const n = Number(qty);
    if (!product.trim() || !n || n <= 0) { toast.error("Укажите изделие и количество"); return; }
    setBusy(true); setResult(null);
    try {
      const r = await api.calculateOrderDemand(product.trim(), n);
      setResult(r);
      setCalcFor({ product: product.trim(), qty: n });
      if (!r.components.length) toast.warning(r.message || "Спецификация не найдена");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка расчёта"); }
    setBusy(false);
  }

  async function createPurchaseRequest() {
    if (!shortageRows.length) return;
    setCreatingPr(true);
    try {
      const pr = await api.purchaseFromShortage({
        items: shortageRows.map(c => ({ component_name: c.component_name, quantity: Math.ceil(c.shortage) })),
        note: calcFor ? `Дефицит под ${calcFor.product} × ${calcFor.qty}` : "Дефицит по спецификации",
        order_ref: calcFor ? `${calcFor.product} × ${calcFor.qty}` : undefined,
      });
      toast.success(`Заявка на закупку №${pr.id} создана (${pr.items.length} позиц.)`);
      router.push("/procurement");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setCreatingPr(false);
  }

  if (loading || !user) return null;

  if (!hasPermission("warehouse.view")) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-gray-500">Нет доступа</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 1000 }}>
        <div>
          <h1 style={{ margin: 0 }}>Резерв по спецификации</h1>
          <p style={{ color: "var(--text-secondary)", marginTop: 6, fontSize: 14 }}>
            Введите изделие и количество — программа по спецификации посчитает, сколько компонентов нужно,
            сколько можно взять со склада и чего не хватает.
          </p>
        </div>

        <Card>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "2 1 320px" }}>
              <label>Изделие (спецификация)</label>
              <ProductPicker value={product} onChange={setProduct} products={products} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label>Количество проекта</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)}
                placeholder="0" style={{ width: "100%" }}
                onKeyDown={e => { if (e.key === "Enter") calculate(); }} />
            </div>
            <Button onClick={calculate} disabled={busy}>{busy ? "Расчёт…" : "Рассчитать резерв"}</Button>
          </div>
        </Card>

        {result && result.components.length > 0 && (
          <Card>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {calcFor?.product} × {calcFor?.qty} шт.
              </span>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 20,
                background: result.canProduce ? "#10b98120" : "#ef444420",
                color: result.canProduce ? "#10b981" : "#ef4444",
              }}>
                {result.canProduce ? "✓ Можно произвести — всё есть на складе" : `✗ Не хватает ${shortageRows.length} позиц.`}
              </span>
              {shortageRows.length > 0 && (
                <Button size="sm" variant="secondary" style={{ marginLeft: "auto" }}
                  onClick={createPurchaseRequest} disabled={creatingPr}>
                  🛒 Заявка на закупку дефицита
                </Button>
              )}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
                    <th style={{ padding: "8px 10px" }}>Компонент</th>
                    <th style={{ padding: "8px 10px" }}>Источник</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Норма</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Нужно</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>На складе</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Можно взять</th>
                    <th style={{ padding: "8px 10px", textAlign: "right" }}>Дефицит</th>
                  </tr>
                </thead>
                <tbody>
                  {result.components.map((c, i) => {
                    const isWh = c.source === "warehouse";
                    const takeable = isWh ? Math.min(c.required, c.available) : c.required;
                    return (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 10px", fontWeight: 500 }}>{c.component_name}</td>
                        <td style={{ padding: "8px 10px", color: "var(--text-secondary)" }}>{SOURCE_LABELS[c.source] || c.source}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--text-muted)" }}>{c.norm}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{c.required}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{isWh ? c.available : "—"}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: "#10b981", fontWeight: 600 }}>{takeable}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: c.shortage > 0 ? "#ef4444" : "var(--text-muted)", fontWeight: c.shortage > 0 ? 700 : 400 }}>
                          {c.shortage > 0 ? c.shortage : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button variant="secondary" onClick={() => router.push(`/orders?create=1`)}>
                Перейти к созданию заказа
              </Button>
            </div>
          </Card>
        )}

        {result && result.components.length === 0 && (
          <Card>
            <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)" }}>
              {result.message || "Для этого изделия не найдена спецификация (рецептура)."}
            </div>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
