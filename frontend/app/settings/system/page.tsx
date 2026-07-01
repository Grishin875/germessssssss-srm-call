"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../lib/auth";
import { AppLayout } from "../../../components/layout/AppLayout";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import {
  api,
  StageTypeItem, SystemRoleItem, OrderStatusItem, StatusTransitionItem, PriorityItem, SlaRule,
} from "../../../lib/api";
import { invalidateStageTypesCache } from "../../../hooks/useStageTypes";
import { invalidatePrioritiesCache } from "../../../hooks/usePriorities";

type Tab = "stage-types" | "roles" | "statuses" | "transitions" | "priorities" | "sla";

const TABS: { key: Tab; label: string }[] = [
  { key: "stage-types",  label: "Типы этапов" },
  { key: "roles",        label: "Роли" },
  { key: "statuses",     label: "Статусы заказов" },
  { key: "transitions",  label: "Переходы статусов" },
  { key: "priorities",   label: "Приоритеты" },
  { key: "sla",          label: "SLA / Дедлайны" },
];

const COLORS = ["#6b7280","#8b5cf6","#0ea5e9","#10b981","#f59e0b","#f97316","#ef4444","#3b82f6","#ec4899","#14b8a6"];

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {COLORS.map(c => (
        <div key={c} onClick={() => onChange(c)} style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: "pointer", border: value === c ? "2px solid var(--text-primary)" : "2px solid transparent" }} />
      ))}
      <input type="color" value={value} onChange={e => onChange(e.target.value)} style={{ width: 28, height: 24, padding: 0, border: "none", borderRadius: 6, cursor: "pointer" }} />
    </div>
  );
}

export default function SystemSettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("stage-types");
  // Deep-link: /settings/system?tab=roles открывает нужную вкладку (в эффекте — чтобы
  // не было расхождения гидратации между сервером и клиентом).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && TABS.some(x => x.key === t)) setTab(t);
  }, []);

  const [stageTypes, setStageTypes] = useState<StageTypeItem[]>([]);
  const [roles, setRoles] = useState<SystemRoleItem[]>([]);
  const [statuses, setStatuses] = useState<OrderStatusItem[]>([]);
  const [transitions, setTransitions] = useState<StatusTransitionItem[]>([]);
  const [priorities, setPriorities] = useState<PriorityItem[]>([]);

  const [stForm, setStForm] = useState({ code: "", label: "", color: "#6b7280", sort_order: "0", is_active: true });
  const [stEdit, setStEdit] = useState<StageTypeItem | null>(null);
  const [showSt, setShowSt] = useState(false);

  const [rForm, setRForm] = useState({ code: "", label: "", allowed_stage_types: "", is_production: false, is_active: true });
  const [rEdit, setREdit] = useState<SystemRoleItem | null>(null);
  const [showR, setShowR] = useState(false);

  const [osForm, setOsForm] = useState({ code: "", label: "", color: "#6b7280", is_terminal: false, sort_order: "0", is_active: true });
  const [osEdit, setOsEdit] = useState<OrderStatusItem | null>(null);
  const [showOs, setShowOs] = useState(false);

  const [trForm, setTrForm] = useState({ from_status: "", to_status: "" });
  const [showTr, setShowTr] = useState(false);

  const [prForm, setPrForm] = useState({ code: "", label: "", color: "#6b7280", sort_weight: "0", is_active: true });
  const [prEdit, setPrEdit] = useState<PriorityItem | null>(null);
  const [showPr, setShowPr] = useState(false);

  const [slaRules, setSlaRules] = useState<SlaRule[]>([]);
  const [slaForm, setSlaForm] = useState({ status: "", max_hours: "24", is_active: true });
  const [slaEdit, setSlaEdit] = useState<SlaRule | null>(null);
  const [showSla, setShowSla] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (!loading && user && user.role !== "admin") router.replace("/dashboard"); }, [user, loading, router]);
  useEffect(() => { if (user?.role === "admin") loadAll(); }, [user]);

  async function loadAll() {
    const [st, r, os, tr, pr, sla] = await Promise.all([
      api.getStageTypes().catch(() => [] as StageTypeItem[]),
      api.getSystemRoles().catch(() => [] as SystemRoleItem[]),
      api.getOrderStatuses().catch(() => [] as OrderStatusItem[]),
      api.getStatusTransitions().catch(() => [] as StatusTransitionItem[]),
      api.getPriorities().catch(() => [] as PriorityItem[]),
      api.getSlaRules().catch(() => [] as SlaRule[]),
    ]);
    setStageTypes(st); setRoles(r); setStatuses(os); setTransitions(tr); setPriorities(pr); setSlaRules(sla);
  }

  async function saveSla() {
    setSaving(true); setError("");
    try {
      const data = { status: slaForm.status.trim(), max_hours: Number(slaForm.max_hours), is_active: slaForm.is_active };
      if (slaEdit) await api.updateSlaRule(slaEdit.id, data); else await api.createSlaRule(data);
      setShowSla(false); await loadAll();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function saveSt() {
    setSaving(true); setError("");
    try {
      const data = { code: stForm.code.trim(), label: stForm.label.trim(), color: stForm.color, sort_order: Number(stForm.sort_order), is_active: stForm.is_active };
      if (stEdit) await api.updateStageType(stEdit.id, data); else await api.createStageType(data);
      setShowSt(false); invalidateStageTypesCache(); await loadAll();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function saveR() {
    setSaving(true); setError("");
    try {
      const data = { code: rForm.code.trim(), label: rForm.label.trim(), allowed_stage_types: rForm.allowed_stage_types.split(",").map(s => s.trim()).filter(Boolean), is_production: rForm.is_production, is_active: rForm.is_active };
      if (rEdit) await api.updateSystemRole(rEdit.id, data); else await api.createSystemRole(data);
      setShowR(false); await loadAll();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function saveOs() {
    setSaving(true); setError("");
    try {
      const data = { code: osForm.code.trim(), label: osForm.label.trim(), color: osForm.color, is_terminal: osForm.is_terminal, sort_order: Number(osForm.sort_order), is_active: osForm.is_active };
      if (osEdit) await api.updateOrderStatus(osEdit.id, data); else await api.createOrderStatus(data);
      setShowOs(false); await loadAll();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function saveTr() {
    setSaving(true); setError("");
    try {
      await api.createStatusTransition({ from_status: trForm.from_status, to_status: trForm.to_status });
      setShowTr(false); await loadAll();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  async function savePr() {
    setSaving(true); setError("");
    try {
      const data = { code: prForm.code.trim(), label: prForm.label.trim(), color: prForm.color, sort_weight: Number(prForm.sort_weight), is_active: prForm.is_active };
      if (prEdit) await api.updatePriority(prEdit.id, data); else await api.createPriority(data);
      setShowPr(false); invalidatePrioritiesCache(); await loadAll();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка"); }
    setSaving(false);
  }

  if (loading || !user) return null;

  const ts = (key: Tab): React.CSSProperties => ({
    padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
    background: tab === key ? "var(--primary)" : "transparent",
    color: tab === key ? "#fff" : "var(--text-secondary)",
  });

  const Th = ({ children }: { children?: string }) => (
    <th style={{ textAlign: "left", padding: "6px 10px", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{children}</th>
  );

  const Row = ({ children }: { children: React.ReactNode }) => (
    <tr style={{ borderBottom: "1px solid var(--border-light)" }}>{children}</tr>
  );

  const Td = ({ children, mono }: { children: React.ReactNode; mono?: boolean }) => (
    <td style={{ padding: "8px 10px", fontSize: 13, fontFamily: mono ? "monospace" : undefined }}>{children}</td>
  );

  const ActiveBadge = ({ v }: { v: boolean }) => (
    <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: v ? "#10b98120" : "#6b728020", color: v ? "#10b981" : "#6b7280" }}>{v ? "Активен" : "Архив"}</span>
  );

  const ColorDot = ({ color }: { color: string }) => (
    <div style={{ width: 20, height: 20, borderRadius: 4, background: color }} />
  );

  const ColorLabel = ({ color, label }: { color: string; label: string }) => (
    <span style={{ padding: "2px 10px", borderRadius: 20, background: color + "25", color, fontWeight: 600, fontSize: 13 }}>{label}</span>
  );

  const ErrBox = () => error ? <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fef2f2", color: "#dc2626", fontSize: 13, marginBottom: 4 }}>{error}</div> : null;

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Системные настройки</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--text-muted)" }}>Справочники системы — только для администраторов</p>
        </div>

        <div style={{ display: "flex", gap: 4, background: "var(--bg-secondary)", padding: 4, borderRadius: 10, flexWrap: "wrap" }}>
          {TABS.map(t => <button key={t.key} style={ts(t.key)} onClick={() => setTab(t.key)}>{t.label}</button>)}
        </div>

        {tab === "stage-types" && (
          <Card title="Типы производственных этапов">
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
              <Button size="sm" onClick={() => { setStEdit(null); setStForm({ code: "", label: "", color: "#6b7280", sort_order: String(stageTypes.length), is_active: true }); setError(""); setShowSt(true); }}>+ Добавить</Button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><Th>Код</Th><Th>Название</Th><Th>Цвет</Th><Th>Порядок</Th><Th>Статус</Th><Th></Th></tr></thead>
              <tbody>
                {stageTypes.map(st => (
                  <Row key={st.id}>
                    <Td mono>{st.code}</Td>
                    <Td><ColorLabel color={st.color} label={st.label} /></Td>
                    <Td><ColorDot color={st.color} /></Td>
                    <Td>{st.sort_order}</Td>
                    <Td><ActiveBadge v={st.is_active} /></Td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Button size="sm" variant="ghost" onClick={() => { setStEdit(st); setStForm({ code: st.code, label: st.label, color: st.color, sort_order: String(st.sort_order), is_active: st.is_active }); setError(""); setShowSt(true); }}>Изм.</Button>
                        <Button size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => { if (confirm(`Удалить "${st.code}"?`)) { await api.deleteStageType(st.id); invalidateStageTypesCache(); await loadAll(); } }}>Удал.</Button>
                      </div>
                    </td>
                  </Row>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "roles" && (
          <Card title="Роли пользователей">
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
              <Button size="sm" onClick={() => { setREdit(null); setRForm({ code: "", label: "", allowed_stage_types: "", is_production: false, is_active: true }); setError(""); setShowR(true); }}>+ Добавить</Button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><Th>Код</Th><Th>Название</Th><Th>Типы этапов</Th><Th>Произв.</Th><Th>Статус</Th><Th></Th></tr></thead>
              <tbody>
                {roles.map(r => (
                  <Row key={r.id}>
                    <Td mono>{r.code}</Td>
                    <Td>{r.label}</Td>
                    <td style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>{r.allowed_stage_types.join(", ") || "—"}</td>
                    <Td>{r.is_production ? "✓" : "—"}</Td>
                    <Td><ActiveBadge v={r.is_active} /></Td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Button size="sm" variant="ghost" onClick={() => { setREdit(r); setRForm({ code: r.code, label: r.label, allowed_stage_types: r.allowed_stage_types.join(","), is_production: r.is_production, is_active: r.is_active }); setError(""); setShowR(true); }}>Изм.</Button>
                        <Button size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => { if (confirm(`Удалить "${r.code}"?`)) { await api.deleteSystemRole(r.id); await loadAll(); } }}>Удал.</Button>
                      </div>
                    </td>
                  </Row>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "statuses" && (
          <Card title="Статусы заказов">
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
              <Button size="sm" onClick={() => { setOsEdit(null); setOsForm({ code: "", label: "", color: "#6b7280", is_terminal: false, sort_order: String(statuses.length), is_active: true }); setError(""); setShowOs(true); }}>+ Добавить</Button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><Th>Статус</Th><Th>Цвет</Th><Th>Финальный</Th><Th>Порядок</Th><Th></Th></tr></thead>
              <tbody>
                {statuses.map(s => (
                  <Row key={s.id}>
                    <Td><ColorLabel color={s.color} label={s.label} /></Td>
                    <Td><ColorDot color={s.color} /></Td>
                    <Td>{s.is_terminal ? "✓" : "—"}</Td>
                    <Td>{s.sort_order}</Td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Button size="sm" variant="ghost" onClick={() => { setOsEdit(s); setOsForm({ code: s.code, label: s.label, color: s.color, is_terminal: s.is_terminal, sort_order: String(s.sort_order), is_active: s.is_active }); setError(""); setShowOs(true); }}>Изм.</Button>
                        <Button size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => { if (confirm(`Удалить "${s.code}"?`)) { await api.deleteOrderStatus(s.id); await loadAll(); } }}>Удал.</Button>
                      </div>
                    </td>
                  </Row>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "transitions" && (
          <Card title="Разрешённые переходы между статусами">
            <div style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Если список пуст — все переходы разрешены. Добавьте правила чтобы ограничить воркфлоу.</p>
              <Button size="sm" onClick={() => { setTrForm({ from_status: statuses[0]?.code || "", to_status: "" }); setError(""); setShowTr(true); }}>+ Добавить</Button>
            </div>
            {transitions.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 14 }}>Нет ограничений — все переходы разрешены</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><Th>Из статуса</Th><Th>В статус</Th><Th>Роли</Th><Th></Th></tr></thead>
                <tbody>
                  {transitions.map(tr => (
                    <Row key={tr.id}>
                      <Td>{tr.from_status}</Td>
                      <Td>→ {tr.to_status}</Td>
                      <td style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>{tr.allowed_roles.join(", ") || "Все"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>
                        <Button size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => { if (confirm("Удалить переход?")) { await api.deleteStatusTransition(tr.id); await loadAll(); } }}>Удал.</Button>
                      </td>
                    </Row>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}

        {tab === "priorities" && (
          <Card title="Приоритеты заказов">
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "flex-end" }}>
              <Button size="sm" onClick={() => { setPrEdit(null); setPrForm({ code: "", label: "", color: "#6b7280", sort_weight: "0", is_active: true }); setError(""); setShowPr(true); }}>+ Добавить</Button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><Th>Код</Th><Th>Название</Th><Th>Цвет</Th><Th>Вес</Th><Th>Статус</Th><Th></Th></tr></thead>
              <tbody>
                {priorities.map(p => (
                  <Row key={p.id}>
                    <Td mono>{p.code}</Td>
                    <Td><ColorLabel color={p.color} label={p.label} /></Td>
                    <Td><ColorDot color={p.color} /></Td>
                    <Td>{p.sort_weight}</Td>
                    <Td><ActiveBadge v={p.is_active} /></Td>
                    <td style={{ padding: "8px 10px", textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <Button size="sm" variant="ghost" onClick={() => { setPrEdit(p); setPrForm({ code: p.code, label: p.label, color: p.color, sort_weight: String(p.sort_weight), is_active: p.is_active }); setError(""); setShowPr(true); }}>Изм.</Button>
                        <Button size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => { if (confirm(`Удалить "${p.code}"?`)) { await api.deletePriority(p.id); invalidatePrioritiesCache(); await loadAll(); } }}>Удал.</Button>
                      </div>
                    </td>
                  </Row>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === "sla" && (
          <Card title="SLA / Правила дедлайнов">
            <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Задайте максимальное время (часы) пребывания заказа в каждом статусе.</p>
              <Button size="sm" onClick={() => { setSlaEdit(null); setSlaForm({ status: "", max_hours: "24", is_active: true }); setError(""); setShowSla(true); }}>+ Добавить</Button>
            </div>
            {slaRules.length === 0 ? (
              <div style={{ textAlign: "center", padding: 32, color: "var(--text-muted)", fontSize: 14 }}>Правила SLA не заданы</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ borderBottom: "1px solid var(--border)" }}><Th>Статус</Th><Th>Макс. часов</Th><Th>Активно</Th><Th></Th></tr></thead>
                <tbody>
                  {slaRules.map(r => (
                    <Row key={r.id}>
                      <Td><span style={{ fontWeight: 500 }}>{r.status}</span></Td>
                      <Td>{r.max_hours} ч</Td>
                      <td style={{ padding: "8px 10px" }}>{r.is_active ? "✓" : "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", display: "flex", gap: 6 }}>
                        <Button size="sm" variant="ghost" onClick={() => { setSlaEdit(r); setSlaForm({ status: r.status, max_hours: String(r.max_hours), is_active: r.is_active }); setError(""); setShowSla(true); }}>Ред.</Button>
                        <Button size="sm" variant="ghost" style={{ color: "var(--danger)" }} onClick={async () => { if (confirm("Удалить правило?")) { await api.deleteSlaRule(r.id); await loadAll(); } }}>Удал.</Button>
                      </td>
                    </Row>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>

      {/* Modals */}
      <Modal open={showSt} onClose={() => setShowSt(false)} title={stEdit ? "Изменить тип этапа" : "Новый тип этапа"}
        footer={<><Button variant="secondary" onClick={() => setShowSt(false)}>Отмена</Button><Button onClick={saveSt} loading={saving}>{stEdit ? "Сохранить" : "Добавить"}</Button></>}>
        <div className="space-y-3"><ErrBox />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label>Код *</label><input value={stForm.code} onChange={e => setStForm(f => ({ ...f, code: e.target.value }))} placeholder="smd" disabled={!!stEdit} /></div>
            <div><label>Название *</label><input value={stForm.label} onChange={e => setStForm(f => ({ ...f, label: e.target.value }))} placeholder="СМД" /></div>
          </div>
          <div><label>Цвет</label><ColorPicker value={stForm.color} onChange={c => setStForm(f => ({ ...f, color: c }))} /></div>
          <div><label>Порядок</label><input type="number" value={stForm.sort_order} onChange={e => setStForm(f => ({ ...f, sort_order: e.target.value }))} /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={stForm.is_active} onChange={e => setStForm(f => ({ ...f, is_active: e.target.checked }))} /> Активен</label>
        </div>
      </Modal>

      <Modal open={showR} onClose={() => setShowR(false)} title={rEdit ? "Изменить роль" : "Новая роль"}
        footer={<><Button variant="secondary" onClick={() => setShowR(false)}>Отмена</Button><Button onClick={saveR} loading={saving}>{rEdit ? "Сохранить" : "Добавить"}</Button></>}>
        <div className="space-y-3"><ErrBox />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label>Код *</label><input value={rForm.code} onChange={e => setRForm(f => ({ ...f, code: e.target.value }))} disabled={!!rEdit} /></div>
            <div><label>Название *</label><input value={rForm.label} onChange={e => setRForm(f => ({ ...f, label: e.target.value }))} /></div>
          </div>
          <div><label>Типы этапов (коды через запятую)</label><input value={rForm.allowed_stage_types} onChange={e => setRForm(f => ({ ...f, allowed_stage_types: e.target.value }))} placeholder="smd,assembly" /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={rForm.is_production} onChange={e => setRForm(f => ({ ...f, is_production: e.target.checked }))} /> Производственная роль</label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={rForm.is_active} onChange={e => setRForm(f => ({ ...f, is_active: e.target.checked }))} /> Активна</label>
        </div>
      </Modal>

      <Modal open={showOs} onClose={() => setShowOs(false)} title={osEdit ? "Изменить статус" : "Новый статус"}
        footer={<><Button variant="secondary" onClick={() => setShowOs(false)}>Отмена</Button><Button onClick={saveOs} loading={saving}>{osEdit ? "Сохранить" : "Добавить"}</Button></>}>
        <div className="space-y-3"><ErrBox />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label>Код/Значение *</label><input value={osForm.code} onChange={e => setOsForm(f => ({ ...f, code: e.target.value }))} disabled={!!osEdit} placeholder="В работе" /></div>
            <div><label>Название *</label><input value={osForm.label} onChange={e => setOsForm(f => ({ ...f, label: e.target.value }))} placeholder="В работе" /></div>
          </div>
          <div><label>Цвет</label><ColorPicker value={osForm.color} onChange={c => setOsForm(f => ({ ...f, color: c }))} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label>Порядок</label><input type="number" value={osForm.sort_order} onChange={e => setOsForm(f => ({ ...f, sort_order: e.target.value }))} /></div>
            <div style={{ paddingTop: 22 }}><label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={osForm.is_terminal} onChange={e => setOsForm(f => ({ ...f, is_terminal: e.target.checked }))} /> Финальный</label></div>
          </div>
        </div>
      </Modal>

      <Modal open={showTr} onClose={() => setShowTr(false)} title="Добавить переход"
        footer={<><Button variant="secondary" onClick={() => setShowTr(false)}>Отмена</Button><Button onClick={saveTr} loading={saving}>Добавить</Button></>}>
        <div className="space-y-3"><ErrBox />
          <div><label>Из статуса</label>
            <select value={trForm.from_status} onChange={e => setTrForm(f => ({ ...f, from_status: e.target.value }))}>
              {statuses.map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select></div>
          <div><label>В статус</label>
            <select value={trForm.to_status} onChange={e => setTrForm(f => ({ ...f, to_status: e.target.value }))}>
              <option value="">— выбрать —</option>
              {statuses.filter(s => s.code !== trForm.from_status).map(s => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select></div>
        </div>
      </Modal>

      <Modal open={showPr} onClose={() => setShowPr(false)} title={prEdit ? "Изменить приоритет" : "Новый приоритет"}
        footer={<><Button variant="secondary" onClick={() => setShowPr(false)}>Отмена</Button><Button onClick={savePr} loading={saving}>{prEdit ? "Сохранить" : "Добавить"}</Button></>}>
        <div className="space-y-3"><ErrBox />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><label>Код *</label><input value={prForm.code} onChange={e => setPrForm(f => ({ ...f, code: e.target.value }))} disabled={!!prEdit} placeholder="urgent" /></div>
            <div><label>Название *</label><input value={prForm.label} onChange={e => setPrForm(f => ({ ...f, label: e.target.value }))} placeholder="Срочный" /></div>
          </div>
          <div><label>Цвет</label><ColorPicker value={prForm.color} onChange={c => setPrForm(f => ({ ...f, color: c }))} /></div>
          <div><label>Вес сортировки (больше = важнее)</label><input type="number" value={prForm.sort_weight} onChange={e => setPrForm(f => ({ ...f, sort_weight: e.target.value }))} /></div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={prForm.is_active} onChange={e => setPrForm(f => ({ ...f, is_active: e.target.checked }))} /> Активен</label>
        </div>
      </Modal>
      <Modal open={showSla} onClose={() => setShowSla(false)} title={slaEdit ? "Изменить SLA" : "Новое правило SLA"}
        footer={<><Button variant="secondary" onClick={() => setShowSla(false)}>Отмена</Button><Button onClick={saveSla} loading={saving}>{slaEdit ? "Сохранить" : "Добавить"}</Button></>}>
        <div className="space-y-3"><ErrBox />
          <div><label>Статус заказа *</label>
            <input value={slaForm.status} onChange={e => setSlaForm(f => ({ ...f, status: e.target.value }))} disabled={!!slaEdit} placeholder="В работе" />
          </div>
          <div><label>Максимум часов в статусе *</label>
            <input type="number" value={slaForm.max_hours} onChange={e => setSlaForm(f => ({ ...f, max_hours: e.target.value }))} min="1" />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}><input type="checkbox" checked={slaForm.is_active} onChange={e => setSlaForm(f => ({ ...f, is_active: e.target.checked }))} /> Активно</label>
        </div>
      </Modal>
    </AppLayout>
  );
}
