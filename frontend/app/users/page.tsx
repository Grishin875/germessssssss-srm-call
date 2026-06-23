"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, User } from "../../lib/api";
import { ROLE_LABELS } from "../../lib/roles";

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

// Отделы доступа — значения совпадают с backend, лейблы человекочитаемые.
const DEPARTMENTS: { value: string; label: string }[] = [
  { value: "warehouse",      label: "Склад" },
  { value: "recipes",        label: "Рецептуры" },
  { value: "orders",         label: "Заказы" },
  { value: "production",     label: "Производство" },
  { value: "shift-schedule", label: "График смен" },
  { value: "otk",            label: "ОТК" },
  { value: "sc",             label: "Сервисный центр" },
  { value: "users",          label: "Пользователи" },
  { value: "tasks",          label: "Задачи" },
  { value: "archive",        label: "Архив" },
];

export default function UsersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [fetching, setFetching] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState<{ username: string; password: string; full_name: string; role: string; email: string; is_active: boolean; departments_access: string[] }>({ username: "", password: "", full_name: "", role: "user", email: "", is_active: true, departments_access: [] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!loading && (!user || user.role !== "admin")) router.replace("/dashboard"); }, [user, loading, router]);
  useEffect(() => { if (user?.role === "admin") load(); }, [user, showInactive]);

  async function load() {
    setFetching(true);
    try { setUsers(await api.getUsers(showInactive)); } catch {}
    setFetching(false);
  }

  async function save() {
    if (!form.username.trim()) { setError("Логин обязателен"); return; }
    if (!editUser && !form.password.trim()) { setError("Пароль обязателен"); return; }
    setSaving(true); setError("");
    try {
      if (editUser) await api.updateUser(editUser.id, { username: form.username, full_name: form.full_name, role: form.role, email: form.email, is_active: form.is_active, departments_access: form.departments_access, ...(form.password ? { password: form.password } : {}) });
      else await api.createUser({ username: form.username, password: form.password, full_name: form.full_name, role: form.role, email: form.email, departments_access: form.departments_access });
      setShowCreate(false); setEditUser(null);
      load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  if (loading || !user) return null;

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <h1>Пользователи</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
                style={{ width: 15, height: 15 }}
              />
              Показать неактивных
            </label>
            <Button onClick={() => { setShowCreate(true); setEditUser(null); setForm({ username: "", password: "", full_name: "", role: "user", email: "", is_active: true, departments_access: [] }); setError(""); }}>
              Создать
            </Button>
          </div>
        </div>

        {/* Table */}
        <Card>
          {fetching ? (
            <div className="text-center py-12">Загрузка...</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {["Логин","Имя","Email","Роль","Отделы","Статус","Последний вход",""].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={!u.is_active ? { opacity: 0.5 } : undefined}>
                      <td style={{ fontWeight: 500 }}>{u.username}</td>
                      <td>{u.full_name || "—"}</td>
                      <td>{u.email || "—"}</td>
                      <td>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: "var(--primary-light)", color: "var(--primary-text)", fontWeight: 500 }}>
                          {ROLE_LABELS[u.role] ?? u.role}
                        </span>
                      </td>
                      <td>{(u.departments_access || []).join(", ") || "—"}</td>
                      <td><Badge status={u.is_active ? "Активен" : "Неактивен"} /></td>
                      <td>{u.last_login ? new Date(u.last_login).toLocaleDateString("ru") : "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button
                            onClick={() => { setEditUser(u); setForm({ username: u.username, password: "", full_name: u.full_name || "", role: u.role, email: u.email || "", is_active: u.is_active, departments_access: u.departments_access || [] }); setShowCreate(true); setError(""); }}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                            onMouseEnter={e => (e.currentTarget.style.color = "var(--primary)")}
                            onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                          >
                            <IcoPencil />
                          </button>
                          {u.id !== user.id && (
                            <button
                              onClick={async () => { if (confirm("Удалить пользователя?")) { await api.deleteUser(u.id); load(); } }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "4px 6px", borderRadius: 5, display: "flex", alignItems: "center" }}
                              onMouseEnter={e => (e.currentTarget.style.color = "var(--danger)")}
                              onMouseLeave={e => (e.currentTarget.style.color = "var(--text-muted)")}
                            >
                              <IcoTrash />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setEditUser(null); setError(""); }}
        title={editUser ? "Редактировать пользователя" : "Создать пользователя"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowCreate(false); setEditUser(null); }}>Отмена</Button>
            <Button onClick={save} loading={saving}>{editUser ? "Сохранить" : "Создать"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          {[
            { label: "Логин *", key: "username" },
            { label: editUser ? "Новый пароль (оставьте пустым чтобы не менять)" : "Пароль *", key: "password", type: "password" },
            { label: "Полное имя", key: "full_name" },
            { label: "Email", key: "email", type: "email" },
          ].map(f => (
            <div key={f.key}>
              <label>{f.label}</label>
              <input
                type={f.type || "text"}
                value={(form as Record<string,unknown>)[f.key] as string}
                onChange={e => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
          <div>
            <label>Роль</label>
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              <option value="user">Пользователь</option>
              <option value="manager">Менеджер</option>
              <option value="admin">Администратор</option>
              <option value="operator_smd">Оператор СМД</option>
              <option value="montažnik">Монтажник</option>
              <option value="operator_3d">Оператор 3D печати</option>
              <option value="operator_engraving">Гравёр</option>
              <option value="operator_otk">Оператор ОТК</option>
              <option value="operator_shipment">Оператор отгрузки</option>
              <option value="warehouse">{ROLE_LABELS.warehouse}</option>
            </select>
          </div>
          <div>
            <label>Отделы доступа</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, marginTop: 4 }}>
              {DEPARTMENTS.map(d => {
                const checked = form.departments_access.includes(d.value);
                return (
                  <label key={d.value} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", fontWeight: 400 }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => setForm({
                        ...form,
                        departments_access: e.target.checked
                          ? [...form.departments_access, d.value]
                          : form.departments_access.filter(v => v !== d.value),
                      })}
                      style={{ width: 15, height: 15 }}
                    />
                    {d.label}
                  </label>
                );
              })}
            </div>
          </div>
          {editUser && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", fontWeight: 400 }}>
              <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} style={{ width: 15, height: 15 }} />
              Активен
            </label>
          )}
        </div>
      </Modal>
    </AppLayout>
  );
}
