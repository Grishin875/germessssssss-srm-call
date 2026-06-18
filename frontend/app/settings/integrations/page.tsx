"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { AppLayout } from "../../../components/layout/AppLayout";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { toast } from "../../../components/ui/Toast";
import { api, Webhook, NotificationSubscription } from "../../../lib/api";

const WEBHOOK_EVENTS = [
  { key: "order.status_changed", label: "Смена статуса заказа" },
  { key: "stage.completed", label: "Завершение этапа" },
  { key: "otk.defect", label: "Брак на ОТК" },
];
const SUB_EVENTS = [
  { key: "order.status_changed", label: "Смена статуса заказа" },
  { key: "stage.completed", label: "Завершение этапа" },
  { key: "sla.violation", label: "Нарушение SLA" },
  { key: "mention", label: "Упоминание @меня" },
  { key: "otk.defect", label: "Брак на ОТК" },
];

export default function IntegrationsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [subs, setSubs] = useState<NotificationSubscription[]>([]);
  const [modal, setModal] = useState<Webhook | "new" | null>(null);
  const [form, setForm] = useState({ name: "", url: "", secret: "", events: new Set<string>(), is_active: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (user) { loadWebhooks(); loadSubs(); } }, [user]);

  async function loadWebhooks() { try { setWebhooks(await api.getWebhooks()); } catch {} }
  async function loadSubs() { try { setSubs(await api.getNotificationSubscriptions()); } catch {} }

  if (loading || !user) return null;
  if (user.role !== "admin") {
    return <AppLayout><div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>Доступно только администратору</div></AppLayout>;
  }

  function openNew() {
    setForm({ name: "", url: "", secret: "", events: new Set(["order.status_changed"]), is_active: true });
    setModal("new");
  }
  function openEdit(w: Webhook) {
    let ev: string[] = [];
    try { ev = JSON.parse(w.events || "[]"); } catch {}
    setForm({ name: w.name, url: w.url, secret: w.secret || "", events: new Set(ev), is_active: w.is_active });
    setModal(w);
  }

  async function save() {
    if (!form.name.trim() || !form.url.trim()) { toast.error("Заполните название и URL"); return; }
    setSaving(true);
    try {
      const data = { name: form.name.trim(), url: form.url.trim(), secret: form.secret.trim() || undefined, events: [...form.events], is_active: form.is_active };
      if (modal === "new") await api.createWebhook(data);
      else if (modal) await api.updateWebhook(modal.id, data);
      setModal(null);
      loadWebhooks();
      toast.success("Сохранено");
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function remove(w: Webhook) {
    if (!confirm(`Удалить webhook «${w.name}»?`)) return;
    try { await api.deleteWebhook(w.id); loadWebhooks(); toast.success("Удалено"); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  async function test(w: Webhook) {
    try { const r = await api.testWebhook(w.id); toast.info(`Ответ: ${r.status}`); loadWebhooks(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  const subEnabled = (ev: string) => subs.find(s => s.event_type === ev)?.enabled ?? true;
  async function toggleSub(ev: string, on: boolean) {
    setSubs(prev => {
      const ex = prev.find(s => s.event_type === ev);
      return ex ? prev.map(s => s.event_type === ev ? { ...s, enabled: on } : s) : [...prev, { id: -1, event_type: ev, enabled: on }];
    });
    try { await api.setNotificationSubscription(ev, on); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); loadSubs(); }
  }

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 760 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button variant="ghost" size="sm" onClick={() => router.push("/settings")}>← Настройки</Button>
          <div>
            <h1 style={{ margin: 0 }}>Интеграции и уведомления</h1>
            <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>Исходящие webhooks и подписки на события</p>
          </div>
        </div>

        {/* Webhooks */}
        <Card title="Исходящие webhooks" actions={<Button size="sm" onClick={openNew}>+ Добавить</Button>}>
          {webhooks.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
              Нет webhooks. POST-запрос будет отправлен на ваш URL при выбранных событиях.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {webhooks.map(w => {
                let ev: string[] = []; try { ev = JSON.parse(w.events || "[]"); } catch {}
                return (
                  <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10, background: "var(--bg-secondary)", flexWrap: "wrap" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: w.is_active ? "#10b981" : "#94a3b8", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{w.name}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.url}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        {ev.map(e => WEBHOOK_EVENTS.find(x => x.key === e)?.label || e).join(", ") || "все события"}
                        {w.last_status && ` · последний: ${w.last_status}`}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => test(w)}>Тест</Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(w)}>Изменить</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(w)} style={{ color: "var(--danger)" }}>Удалить</Button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Подписки на уведомления */}
        <Card title="Мои подписки на уведомления">
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
            Выберите, о каких событиях получать уведомления в системе.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {SUB_EVENTS.map(ev => (
              <label key={ev.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: "var(--bg-secondary)", cursor: "pointer" }}>
                <span style={{ fontSize: 14 }}>{ev.label}</span>
                <input type="checkbox" checked={subEnabled(ev.key)} onChange={e => toggleSub(ev.key, e.target.checked)} style={{ width: 17, height: 17, cursor: "pointer", accentColor: "var(--primary)" }} />
              </label>
            ))}
          </div>
        </Card>
      </div>

      {/* Модалка webhook */}
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        title={modal === "new" ? "Новый webhook" : "Редактировать webhook"}
        footer={<><Button variant="secondary" onClick={() => setModal(null)}>Отмена</Button><Button onClick={save} loading={saving}>Сохранить</Button></>}
      >
        <div className="space-y-3">
          <div><label>Название *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Напр.: Telegram-бот" /></div>
          <div><label>URL *</label><input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="https://..." /></div>
          <div><label>Секрет (HMAC, опц.)</label><input value={form.secret} onChange={e => setForm(f => ({ ...f, secret: e.target.value }))} placeholder="подпись X-Germess-Signature" /></div>
          <div>
            <label>События</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
              {WEBHOOK_EVENTS.map(ev => (
                <label key={ev.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.events.has(ev.key)} onChange={e => setForm(f => { const n = new Set(f.events); e.target.checked ? n.add(ev.key) : n.delete(ev.key); return { ...f, events: n }; })} style={{ width: 15, height: 15 }} />
                  {ev.label}
                </label>
              ))}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} style={{ width: 15, height: 15 }} />
            Активен
          </label>
        </div>
      </Modal>
    </AppLayout>
  );
}
