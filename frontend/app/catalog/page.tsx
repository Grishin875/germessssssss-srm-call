"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api, ProductCatalogItem } from "../../lib/api";
import { toast } from "../../components/ui/Toast";

const UNITS = ["шт", "м", "кг", "л", "компл", "упак"];

export default function CatalogPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [items, setItems] = useState<ProductCatalogItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [fetching, setFetching] = useState(true);

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterActive, setFilterActive] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<ProductCatalogItem | null>(null);
  const [form, setForm] = useState({ name: "", sku: "", category: "", description: "", unit: "шт", is_active: true, needs_smd: true, is_receiver: false, needs_assembly: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    load();
    api.getCatalogCategories().then(setCategories).catch(console.error);
  }, [user]);

  async function load() {
    setFetching(true);
    try { setItems(await api.getCatalog()); } catch {}
    setFetching(false);
  }

  function openCreate() {
    setEditItem(null);
    setForm({ name: "", sku: "", category: "", description: "", unit: "шт", is_active: true, needs_smd: true, is_receiver: false, needs_assembly: true });
    setError("");
    setShowModal(true);
  }

  function openEdit(item: ProductCatalogItem) {
    setEditItem(item);
    setForm({ name: item.name, sku: item.sku || "", category: item.category || "", description: item.description || "", unit: item.unit || "шт", is_active: item.is_active, needs_smd: item.needs_smd !== false, is_receiver: item.is_receiver === true, needs_assembly: item.needs_assembly !== false });
    setError("");
    setShowModal(true);
  }

  async function save() {
    if (!form.name.trim()) { setError("Название обязательно"); return; }
    setSaving(true); setError("");
    try {
      const data = { name: form.name.trim(), sku: form.sku || undefined, category: form.category || undefined, description: form.description || undefined, unit: form.unit, is_active: form.is_active, needs_smd: form.needs_smd, is_receiver: form.is_receiver, needs_assembly: form.needs_assembly };
      if (editItem) {
        await api.updateCatalogItem(editItem.id, data);
      } else {
        await api.createCatalogItem(data);
      }
      setShowModal(false);
      await load();
      api.getCatalogCategories().then(setCategories).catch(console.error);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function remove(item: ProductCatalogItem) {
    if (!confirm(`Удалить "${item.name}" из каталога?`)) return;
    try { await api.deleteCatalogItem(item.id); await load(); } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  const filtered = useMemo(() => items.filter(it => {
    if (search && !it.name.toLowerCase().includes(search.toLowerCase()) && !(it.sku || "").toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory && it.category !== filterCategory) return false;
    if (filterActive && !it.is_active) return false;
    return true;
  }), [items, search, filterCategory, filterActive]);

  const canEdit = hasPermission("recipes.edit");

  if (loading || !user) return null;

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Каталог изделий</h1>
            <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--text-muted)" }}>
              {items.length} изделий · единый справочник продуктов
            </p>
          </div>
          {canEdit && <Button onClick={openCreate}>+ Добавить изделие</Button>}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input
            placeholder="Поиск по названию или артикулу..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: "1 1 240px", minWidth: 200 }}
          />
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ minWidth: 160 }}>
            <option value="">Все категории</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", whiteSpace: "nowrap" }}>
            <input type="checkbox" checked={filterActive} onChange={e => setFilterActive(e.target.checked)} />
            Только активные
          </label>
        </div>

        {/* Table */}
        <Card>
          {fetching ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
              {items.length === 0 ? "Каталог пуст — добавьте первое изделие" : "Ничего не найдено"}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["Название", "Артикул", "Категория", "Ед.", "Статус", ""].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(item => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 500, fontSize: 14 }}>
                        {item.name}
                        {item.description && (
                          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, fontWeight: 400 }}>{item.description}</div>
                        )}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-secondary)", fontFamily: "monospace" }}>
                        {item.sku || "—"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 13 }}>
                        {item.category ? (
                          <span style={{ padding: "2px 8px", borderRadius: 20, background: "var(--bg-secondary)", fontSize: 12, fontWeight: 500 }}>{item.category}</span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 13, color: "var(--text-secondary)" }}>{item.unit}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: item.is_active ? "#10b98120" : "#6b728020", color: item.is_active ? "#10b981" : "#6b7280" }}>
                          {item.is_active ? "Активен" : "Архив"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>
                        {canEdit && (
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(item)}>Изменить</Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(item)} style={{ color: "var(--danger)" }}>Удалить</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editItem ? "Редактировать изделие" : "Новое изделие"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Отмена</Button>
            <Button onClick={save} loading={saving}>{editItem ? "Сохранить" : "Добавить"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 13 }}>{error}</div>}
          <div>
            <label>Название *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Например: Плата управления v2" />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Артикул (SKU)</label>
              <input value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} placeholder="PLT-001" />
            </div>
            <div>
              <label>Единица измерения</label>
              <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label>Категория</label>
            <input
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="Например: Платы, Корпуса..."
              list="catalog-categories"
            />
            <datalist id="catalog-categories">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
          <div>
            <label>Описание</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Краткое описание изделия..." />
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: 15, height: 15 }} />
              Активен (отображается при создании заказов)
            </label>
          </div>
          {/* Признаки канонического маршрута по ТЗ */}
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8 }}>
              Маршрут производства (по ТЗ)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
                <input type="checkbox" checked={form.needs_smd} onChange={e => setForm(f => ({ ...f, needs_smd: e.target.checked }))} style={{ width: 15, height: 15 }} />
                Блок СМД (склад СМД → монтаж → AOI → гравировка)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400 }}>
                <input type="checkbox" checked={form.is_receiver} onChange={e => setForm(f => ({ ...f, is_receiver: e.target.checked }))} style={{ width: 15, height: 15 }} />
                Приёмник (после СМД — прошивка, без сборки РЭА)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 400, opacity: form.is_receiver ? 0.5 : 1 }}>
                <input type="checkbox" checked={form.needs_assembly} disabled={form.is_receiver} onChange={e => setForm(f => ({ ...f, needs_assembly: e.target.checked }))} style={{ width: 15, height: 15 }} />
                Сборка РЭА (склад РЭА → выдача → сборка → ОТК)
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
