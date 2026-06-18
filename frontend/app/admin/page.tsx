"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api, User } from "../../lib/api";

const ROLES = [
  { value: "admin", label: "Администратор" },
  { value: "manager", label: "Менеджер" },
  { value: "operator_smd", label: "Оператор СМД" },
  { value: "montažnik", label: "Монтажник" },
  { value: "operator_3d", label: "Оператор 3D" },
  { value: "operator_engraving", label: "Гравёр" },
  { value: "operator_otk", label: "Оператор ОТК" },
  { value: "operator_shipment", label: "Оператор отгрузки" },
  { value: "warehouse", label: "Кладовщик" },
];

const ROLE_COLORS: Record<string, string> = {
  admin: "#6366f1", manager: "#0ea5e9",
  operator_smd: "#8b5cf6", montažnik: "#10b981",
  operator_3d: "#10b981", operator_engraving: "#f59e0b",
  operator_otk: "#ef4444", operator_shipment: "#f97316",
  warehouse: "#6b7280",
};

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? "#6b7280";
  const label = ROLES.find(r => r.value === role)?.label ?? role;
  return (
    <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: color + "20", color }}>
      {label}
    </span>
  );
}

export default function AdminPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [fetching, setFetching] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState({ role: "", is_active: true, full_name: "", email: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", full_name: "", password: "", role: "montažnik", email: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => { if (!loading && (!user || user.role !== "admin")) router.replace("/dashboard"); }, [user, loading, router]);
  useEffect(() => { if (user?.role === "admin") loadUsers(); }, [user]);

  async function loadUsers() {
    setFetching(true);
    try { setUsers(await api.getUsers(true)); } catch {}
    setFetching(false);
  }

  function openEdit(u: User) {
    setEditUser(u);
    setEditForm({ role: u.role, is_active: u.is_active, full_name: u.full_name || "", email: u.email || "", phone: u.phone || "" });
    setError("");
  }

  async function saveUser() {
    if (!editUser) return;
    setSaving(true); setError("");
    try {
      await api.updateUser(editUser.id, {
        role: editForm.role,
        is_active: editForm.is_active,
        full_name: editForm.full_name || undefined,
        email: editForm.email || undefined,
        phone: editForm.phone || undefined,
      });
      setEditUser(null);
      await loadUsers();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка сохранения"); }
    setSaving(false);
  }

  async function createUser() {
    if (!createForm.username.trim() || !createForm.password.trim()) { setCreateError("Логин и пароль обязательны"); return; }
    setCreating(true); setCreateError("");
    try {
      await api.createUser({ username: createForm.username, full_name: createForm.full_name || undefined, password: createForm.password, role: createForm.role, email: createForm.email || undefined });
      setShowCreate(false);
      setCreateForm({ username: "", full_name: "", password: "", role: "montažnik", email: "" });
      await loadUsers();
    } catch (e: unknown) { setCreateError(e instanceof Error ? e.message : "Ошибка создания"); }
    setCreating(false);
  }

  async function toggleActive(u: User) {
    try {
      await api.updateUser(u.id, { is_active: !u.is_active });
      await loadUsers();
    } catch {}
  }

  if (loading || !user) return null;
  if (user.role !== "admin") return null;

  const filtered = users.filter(u => {
    if (!showInactive && !u.is_active) return false;
    if (roleFilter && u.role !== roleFilter) return false;
    if (search && !(u.full_name || u.username).toLowerCase().includes(search.toLowerCase()) && !u.username.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: users.length,
    active: users.filter(u => u.is_active).length,
    admins: users.filter(u => u.role === "admin").length,
    production: users.filter(u => ["operator_smd","montažnik","operator_3d","operator_engraving"].includes(u.role) && u.is_active).length,
  };

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ margin: 0 }}>Администрирование</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>Управление пользователями и ролями</p>
          </div>
          <Button onClick={() => { setShowCreate(true); setCreateError(""); }}>Добавить пользователя</Button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { label: "Всего пользователей", value: stats.total, color: "#6366f1" },
            { label: "Активных", value: stats.active, color: "#10b981" },
            { label: "Операторов производства", value: stats.production, color: "#0ea5e9" },
            { label: "Администраторов", value: stats.admins, color: "#f59e0b" },
          ].map(s => (
            <div key={s.label} style={{ padding: "14px 18px", borderRadius: 12, background: s.color + "12", border: `1px solid ${s.color}25` }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или логину..." style={{ width: 260 }} />
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
            <option value="">Все роли</option>
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Показать неактивных
          </label>
        </div>

        {/* Table */}
        <Card>
          {fetching ? (
            <div className="text-center py-12">Загрузка...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12">Пользователи не найдены</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {["Пользователь","Логин","Роль","Статус","Последний вход",""].map(h => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id} style={{ opacity: u.is_active ? 1 : 0.5 }}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: (ROLE_COLORS[u.role] ?? "#6b7280") + "30", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: ROLE_COLORS[u.role] ?? "#6b7280", flexShrink: 0 }}>
                            {(u.full_name || u.username)[0].toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>{u.full_name || u.username}</div>
                            {u.email && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontFamily: "monospace", fontSize: 13 }}>{u.username}</td>
                      <td><RoleBadge role={u.role} /></td>
                      <td>
                        <span style={{ fontSize: 12, fontWeight: 600, color: u.is_active ? "#10b981" : "#6b7280" }}>
                          {u.is_active ? "Активен" : "Отключён"}
                        </span>
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {u.last_login ? new Date(u.last_login).toLocaleDateString("ru") : "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>Изменить</Button>
                          <Button size="sm" variant={u.is_active ? "secondary" : "ghost"} onClick={() => toggleActive(u)}>
                            {u.is_active ? "Откл." : "Вкл."}
                          </Button>
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

      {/* Edit modal */}
      <Modal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title={`Редактировать: ${editUser?.full_name || editUser?.username}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditUser(null)}>Отмена</Button>
            <Button onClick={saveUser} loading={saving}>Сохранить</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>}
          <div>
            <label>ФИО</label>
            <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div>
            <label>Email</label>
            <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label>Телефон</label>
            <input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <div>
            <label>Роль</label>
            <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value }))}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={editForm.is_active} onChange={e => setEditForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: 15, height: 15 }} />
              <span>Активный пользователь</span>
            </label>
          </div>
        </div>
      </Modal>

      {/* Create modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Новый пользователь"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Отмена</Button>
            <Button onClick={createUser} loading={creating}>Создать</Button>
          </>
        }
      >
        <div className="space-y-4">
          {createError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{createError}</div>}
          <div>
            <label>Логин *</label>
            <input value={createForm.username} onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))} placeholder="Уникальный логин" />
          </div>
          <div>
            <label>ФИО</label>
            <input value={createForm.full_name} onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div>
            <label>Email</label>
            <input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label>Пароль *</label>
            <input type="password" value={createForm.password} onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))} placeholder="Минимум 6 символов" />
          </div>
          <div>
            <label>Роль</label>
            <select value={createForm.role} onChange={e => setCreateForm(f => ({ ...f, role: e.target.value }))}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
