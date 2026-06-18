"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { AppLayout } from "../../../components/layout/AppLayout";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { api, CustomFieldDef } from "../../../lib/api";

const FIELD_TYPES = [
  { value: "text",   label: "Текст" },
  { value: "number", label: "Число" },
  { value: "date",   label: "Дата" },
  { value: "select", label: "Список" },
];

export default function CustomFieldsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<CustomFieldDef | null>(null);
  const [form, setForm] = useState({ label: "", name: "", field_type: "text", required: false, options: "", sort_order: "0", is_active: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (!loading && user && user.role !== "admin") router.replace("/dashboard"); }, [user, loading, router]);
  useEffect(() => { if (user?.role === "admin") load(); }, [user]);

  async function load() {
    setFetching(true);
    try { setFields(await api.getCustomFieldDefs()); } catch {}
    setFetching(false);
  }

  function openCreate() {
    setEditItem(null);
    setForm({ label: "", name: "", field_type: "text", required: false, options: "", sort_order: "0", is_active: true });
    setError("");
    setShowForm(true);
  }

  function openEdit(f: CustomFieldDef) {
    setEditItem(f);
    setForm({ label: f.label, name: f.name, field_type: f.field_type, required: f.required, options: f.options.join("\n"), sort_order: String(f.sort_order), is_active: f.is_active });
    setError("");
    setShowForm(true);
  }

  async function save() {
    setSaving(true); setError("");
    try {
      const data = {
        label: form.label.trim(),
        name: form.name.trim(),
        field_type: form.field_type as "text" | "number" | "date" | "select",
        required: form.required,
        options: form.field_type === "select" ? form.options.split("\n").map(s => s.trim()).filter(Boolean) : [],
        sort_order: Number(form.sort_order),
        is_active: form.is_active,
      };
      if (editItem) await api.updateCustomFieldDef(editItem.id, data);
      else await api.createCustomFieldDef(data);
      setShowForm(false);
      await load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  if (loading || !user) return null;

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ margin: 0 }}>Кастомные поля заказов</h1>
          <Button onClick={openCreate}>+ Добавить поле</Button>
        </div>

        <Card>
          {fetching ? (
            <div className="text-center py-12" style={{ color: "var(--text-muted)" }}>Загрузка...</div>
          ) : fields.length === 0 ? (
            <div className="text-center py-12" style={{ color: "var(--text-muted)", fontSize: 14 }}>
              Кастомных полей нет. Нажмите &quot;Добавить поле&quot; чтобы создать первое.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  {["Название", "Код", "Тип", "Обязательно", "Порядок", "Активно", ""].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fields.map(f => (
                  <tr key={f.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 500 }}>{f.label}</td>
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{f.name}</td>
                    <td style={{ padding: "10px 12px" }}>{FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}</td>
                    <td style={{ padding: "10px 12px" }}>{f.required ? "✓" : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>{f.sort_order}</td>
                    <td style={{ padding: "10px 12px" }}>{f.is_active ? "✓" : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", display: "flex", gap: 6 }}>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(f)}>Ред.</Button>
                      <Button size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => {
                        if (!confirm(`Удалить поле "${f.label}"? Значения для всех заказов будут удалены.`)) return;
                        await api.deleteCustomFieldDef(f.id);
                        await load();
                      }}>Удал.</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editItem ? "Редактировать поле" : "Новое кастомное поле"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowForm(false)}>Отмена</Button>
            <Button onClick={save} loading={saving}>{editItem ? "Сохранить" : "Создать"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 13 }}>{error}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label>Название *</label>
              <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Цвет изделия" />
            </div>
            <div>
              <label>Код * {editItem && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>(нельзя изменить)</span>}</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="color" disabled={!!editItem} />
            </div>
          </div>
          <div>
            <label>Тип поля</label>
            <select value={form.field_type} onChange={e => setForm(f => ({ ...f, field_type: e.target.value }))}>
              {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {form.field_type === "select" && (
            <div>
              <label>Варианты (каждый на новой строке)</label>
              <textarea value={form.options} onChange={e => setForm(f => ({ ...f, options: e.target.value }))} rows={4} placeholder={"Красный\nСиний\nЗелёный"} />
            </div>
          )}
          <div>
            <label>Порядок отображения</label>
            <input type="number" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} min="0" />
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} />
              Обязательное
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
              Активное
            </label>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
