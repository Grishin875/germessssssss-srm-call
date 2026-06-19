"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Order } from "../../lib/api";

interface Item { id: string; label: string; sub?: string; icon: string; action: () => void; }

const PAGES: { label: string; href: string; icon: string; keywords: string }[] = [
  { label: "Дашборд", href: "/dashboard", icon: "🏠", keywords: "главная панель" },
  { label: "Заказы", href: "/orders", icon: "📋", keywords: "orders заказы производство" },
  { label: "Мои задачи", href: "/my-tasks", icon: "✅", keywords: "tasks этапы" },
  { label: "Производство", href: "/production", icon: "🏭", keywords: "production партии" },
  { label: "ОТК", href: "/otk", icon: "🔍", keywords: "контроль качество брак" },
  { label: "Отгрузка", href: "/shipment", icon: "🚚", keywords: "shipment доставка" },
  { label: "Склад", href: "/warehouse", icon: "📦", keywords: "warehouse компоненты остатки" },
  { label: "Рецептура", href: "/recipes", icon: "🧪", keywords: "recipes состав" },
  { label: "Каталог изделий", href: "/catalog", icon: "🗂️", keywords: "catalog продукция" },
  { label: "Пользователи", href: "/users", icon: "👥", keywords: "users сотрудники роли" },
  { label: "Настройки", href: "/settings", icon: "⚙️", keywords: "settings конфигурация" },
  { label: "Настройки системы", href: "/settings/system", icon: "⚙️", keywords: "справочники статусы приоритеты sla" },
  { label: "Резервная копия", href: "/settings/backup", icon: "💾", keywords: "backup экспорт импорт json" },
  { label: "Архив", href: "/archive", icon: "🗄️", keywords: "archive завершённые" },
];

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Открытие по Cmd/Ctrl+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    if (open) { setQuery(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  // Поиск заказов (debounce)
  useEffect(() => {
    if (!open || query.trim().length < 1) { setOrders([]); return; }
    const t = setTimeout(() => {
      api.getOrders(undefined, query.trim()).then(r => setOrders(r.slice(0, 6))).catch(() => setOrders([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query, open]);

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pageItems: Item[] = PAGES
      .filter(p => !q || p.label.toLowerCase().includes(q) || p.keywords.includes(q))
      .map(p => ({ id: `page-${p.href}`, label: p.label, sub: "Страница", icon: p.icon, action: () => { setOpen(false); router.push(p.href); } }));
    const orderItems: Item[] = orders.map(o => ({
      id: `order-${o.id}`, label: `#${o.id} · ${o.product_name}`, sub: `Заказ · ${o.status}`, icon: "📋",
      action: () => { setOpen(false); router.push(`/orders/${o.id}`); },
    }));
    return [...orderItems, ...pageItems];
  }, [query, orders, router]);

  useEffect(() => { setActive(0); }, [items.length]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="glass"
        style={{ width: "min(560px, calc(100vw - 32px))", borderRadius: 14, overflow: "hidden", boxShadow: "var(--shadow-lg)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
          <span style={{ fontSize: 18, color: "var(--text-muted)" }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && items[active]) { e.preventDefault(); items[active].action(); }
            }}
            placeholder="Поиск заказов, страниц, действий…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: 15, color: "var(--text)" }}
          />
          <kbd style={{ fontSize: 11, color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px" }}>ESC</kbd>
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto", padding: 6 }}>
          {items.length === 0 ? (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Ничего не найдено</div>
          ) : items.map((it, i) => (
            <button
              key={it.id}
              onClick={it.action}
              onMouseEnter={() => setActive(i)}
              style={{
                width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12,
                padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer",
                background: i === active ? "var(--primary-light)" : "transparent",
                color: "var(--text)", transition: "background 0.1s",
              }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{it.icon}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              {it.sub && <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>{it.sub}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
