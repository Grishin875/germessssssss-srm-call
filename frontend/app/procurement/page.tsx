"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import { api, Supplier, PurchaseRequest, PurchaseItemIn, Component } from "../../lib/api";
import { toast } from "../../components/ui/Toast";

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  draft:     { bg: "#6b728020", color: "#6b7280" },
  ordered:   { bg: "#3b82f620", color: "#3b82f6" },
  received:  { bg: "#10b98120", color: "#10b981" },
  cancelled: { bg: "#ef444420", color: "#ef4444" },
};

function StatusBadge({ status, label }: { status: string; label: string }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: s.bg, color: s.color }}>{label}</span>;
}

export default function ProcurementPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();
  const canEdit = hasPermission("warehouse.edit");
  const [tab, setTab] = useState<"requests" | "suppliers">("requests");

  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [components, setComponents] = useState<Component[]>([]);
  const [fetching, setFetching] = useState(true);

  // ── Заявка: модалка ──
  const [showPr, setShowPr] = useState(false);
  const [prSupplier, setPrSupplier] = useState<string>("");
  const [prNote, setPrNote] = useState("");
  const [prOrderRef, setPrOrderRef] = useState("");
  const [prItems, setPrItems] = useState<PurchaseItemIn[]>([{ component_name: "", quantity: 0 }]);
  const [savingPr, setSavingPr] = useState(false);

  // ── Поставщик: модалка ──
  const [showSup, setShowSup] = useState(false);
  const [editSup, setEditSup] = useState<Supplier | null>(null);
  const [supForm, setSupForm] = useState({ name: "", contact: "", phone: "", email: "", note: "" });
  const [savingSup, setSavingSup] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (user) load(); }, [user]);

  async function load() {
    setFetching(true);
    try {
      const [r, s, c] = await Promise.all([
        api.getPurchaseRequests(),
        api.getSuppliers(true),
        api.getComponents().catch(() => []),
      ]);
      setRequests(r); setSuppliers(s); setComponents(c);
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setFetching(false);
  }

  // ── Заявки ──
  function openPr() {
    setPrSupplier(""); setPrNote(""); setPrOrderRef("");
    setPrItems([{ component_name: "", quantity: 0 }]); setShowPr(true);
  }
  function setItem(i: number, patch: Partial<PurchaseItemIn>) {
    setPrItems(items => items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  }
  async function savePr() {
    const items = prItems.filter(it => it.component_name.trim() && Number(it.quantity) > 0)
      .map(it => ({ component_name: it.component_name.trim(), quantity: Number(it.quantity), unit_price: it.unit_price ? Number(it.unit_price) : undefined }));
    if (!items.length) { toast.error("Добавьте хотя бы одну позицию"); return; }
    setSavingPr(true);
    try {
      await api.createPurchaseRequest({
        supplier_id: prSupplier ? Number(prSupplier) : null,
        note: prNote || undefined, order_ref: prOrderRef || undefined, items,
      });
      toast.success("Заявка создана"); setShowPr(false); load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSavingPr(false);
  }
  async function setPrStatus(pr: PurchaseRequest, status: string) {
    try { await api.updatePurchaseRequest(pr.id, { status }); toast.success("Статус обновлён"); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function receivePr(pr: PurchaseRequest) {
    if (!confirm(`Оприходовать заявку №${pr.id} на склад? Остатки будут пополнены.`)) return;
    try { await api.receivePurchaseRequest(pr.id); toast.success("Принято на склад"); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }
  async function deletePr(pr: PurchaseRequest) {
    if (!confirm(`Удалить заявку №${pr.id}?`)) return;
    try { await api.deletePurchaseRequest(pr.id); toast.success("Удалено"); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  // ── Поставщики ──
  function openSup(s?: Supplier) {
    setEditSup(s || null);
    setSupForm({ name: s?.name || "", contact: s?.contact || "", phone: s?.phone || "", email: s?.email || "", note: s?.note || "" });
    setShowSup(true);
  }
  async function saveSup() {
    if (!supForm.name.trim()) { toast.error("Укажите название"); return; }
    setSavingSup(true);
    try {
      if (editSup) await api.updateSupplier(editSup.id, supForm);
      else await api.createSupplier(supForm);
      toast.success("Сохранено"); setShowSup(false); load();
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
    setSavingSup(false);
  }
  async function delSup(s: Supplier) {
    if (!confirm(`Деактивировать поставщика «${s.name}»?`)) return;
    try { await api.deleteSupplier(s.id); toast.success("Готово"); load(); }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Ошибка"); }
  }

  if (loading || !user) return null;
  const tabStyle = (k: string) => ({
    padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
    background: tab === k ? "var(--bg)" : "transparent", color: tab === k ? "var(--text)" : "var(--text-secondary)",
    boxShadow: tab === k ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
  });

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0 }}>Закупка</h1>
          <div style={{ display: "flex", gap: 4, background: "var(--bg-secondary)", padding: 4, borderRadius: 10, marginLeft: 8 }}>
            <button style={tabStyle("requests")} onClick={() => setTab("requests")}>Заявки</button>
            <button style={tabStyle("suppliers")} onClick={() => setTab("suppliers")}>Поставщики</button>
          </div>
          {canEdit && tab === "requests" && <Button style={{ marginLeft: "auto" }} onClick={openPr}>+ Заявка на закупку</Button>}
          {canEdit && tab === "suppliers" && <Button style={{ marginLeft: "auto" }} onClick={() => openSup()}>+ Поставщик</Button>}
        </div>

        {tab === "requests" && (
          <Card>
            {fetching ? <div style={{ padding: 24, color: "var(--text-muted)" }}>Загрузка…</div> :
              requests.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>Заявок пока нет</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
                        <th style={{ padding: "8px 10px" }}>№</th>
                        <th style={{ padding: "8px 10px" }}>Поставщик</th>
                        <th style={{ padding: "8px 10px" }}>Позиции</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Кол-во</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Сумма</th>
                        <th style={{ padding: "8px 10px" }}>Статус</th>
                        <th style={{ padding: "8px 10px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map(pr => (
                        <tr key={pr.id} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                          <td style={{ padding: "8px 10px", fontWeight: 600 }}>#{pr.id}</td>
                          <td style={{ padding: "8px 10px" }}>{pr.supplier_name || <span style={{ color: "var(--text-muted)" }}>—</span>}
                            {pr.order_ref && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{pr.order_ref}</div>}
                          </td>
                          <td style={{ padding: "8px 10px", color: "var(--text-secondary)", maxWidth: 280 }}>
                            {pr.items.map(it => `${it.component_name} ×${it.quantity}`).join(", ")}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{pr.total_qty}</td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>{pr.total_cost ? pr.total_cost.toLocaleString("ru") + " ₽" : "—"}</td>
                          <td style={{ padding: "8px 10px" }}><StatusBadge status={pr.status} label={pr.status_label} /></td>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                            {canEdit && pr.status === "draft" && (
                              <Button size="sm" variant="secondary" onClick={() => setPrStatus(pr, "ordered")} style={{ marginRight: 6 }}>Заказано</Button>
                            )}
                            {canEdit && (pr.status === "draft" || pr.status === "ordered") && (
                              <Button size="sm" variant="success" onClick={() => receivePr(pr)} style={{ marginRight: 6 }}>Принять</Button>
                            )}
                            {canEdit && pr.status !== "received" && (
                              <Button size="sm" variant="ghost" onClick={() => deletePr(pr)}>✕</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        )}

        {tab === "suppliers" && (
          <Card>
            {fetching ? <div style={{ padding: 24, color: "var(--text-muted)" }}>Загрузка…</div> :
              suppliers.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>Поставщиков пока нет</div> : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 12 }}>
                        <th style={{ padding: "8px 10px" }}>Название</th>
                        <th style={{ padding: "8px 10px" }}>Контакт</th>
                        <th style={{ padding: "8px 10px" }}>Телефон</th>
                        <th style={{ padding: "8px 10px" }}>Email</th>
                        <th style={{ padding: "8px 10px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {suppliers.map(s => (
                        <tr key={s.id} style={{ borderTop: "1px solid var(--border)", opacity: s.is_active ? 1 : 0.5 }}>
                          <td style={{ padding: "8px 10px", fontWeight: 500 }}>{s.name}{!s.is_active && <span style={{ fontSize: 11, color: "var(--text-muted)" }}> (неактивен)</span>}</td>
                          <td style={{ padding: "8px 10px" }}>{s.contact || "—"}</td>
                          <td style={{ padding: "8px 10px" }}>{s.phone || "—"}</td>
                          <td style={{ padding: "8px 10px" }}>{s.email || "—"}</td>
                          <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                            {canEdit && <Button size="sm" variant="ghost" onClick={() => openSup(s)} style={{ marginRight: 6 }}>✎</Button>}
                            {canEdit && s.is_active && <Button size="sm" variant="ghost" onClick={() => delSup(s)}>✕</Button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        )}
      </div>

      {/* Модалка: заявка на закупку */}
      <Modal open={showPr} onClose={() => setShowPr(false)} title="Заявка на закупку" size="lg"
        footer={<><Button variant="secondary" onClick={() => setShowPr(false)}>Отмена</Button><Button onClick={savePr} disabled={savingPr}>{savingPr ? "Сохранение…" : "Создать"}</Button></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label>Поставщик</label>
              <select value={prSupplier} onChange={e => setPrSupplier(e.target.value)} style={{ width: "100%" }}>
                <option value="">— не указан —</option>
                {suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <label>Связанный заказ (опц.)</label>
              <input value={prOrderRef} onChange={e => setPrOrderRef(e.target.value)} placeholder="№ или изделие" style={{ width: "100%" }} />
            </div>
          </div>

          <div>
            <label>Позиции</label>
            <datalist id="proc-components">
              {components.map(c => <option key={c.id} value={c.name} />)}
            </datalist>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {prItems.map((it, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input list="proc-components" value={it.component_name} onChange={e => setItem(i, { component_name: e.target.value })}
                    placeholder="Компонент" style={{ flex: "2 1 200px" }} />
                  <input type="number" min="0" value={it.quantity || ""} onChange={e => setItem(i, { quantity: Number(e.target.value) })}
                    placeholder="Кол-во" style={{ flex: "1 1 80px" }} />
                  <input type="number" min="0" value={it.unit_price ?? ""} onChange={e => setItem(i, { unit_price: e.target.value ? Number(e.target.value) : undefined })}
                    placeholder="Цена ₽" style={{ flex: "1 1 80px" }} />
                  <Button size="sm" variant="ghost" onClick={() => setPrItems(items => items.filter((_, idx) => idx !== i))}>✕</Button>
                </div>
              ))}
            </div>
            <Button size="sm" variant="secondary" style={{ marginTop: 8 }}
              onClick={() => setPrItems(items => [...items, { component_name: "", quantity: 0 }])}>+ Позиция</Button>
          </div>

          <div>
            <label>Примечание</label>
            <textarea value={prNote} onChange={e => setPrNote(e.target.value)} rows={2} style={{ width: "100%" }} />
          </div>
        </div>
      </Modal>

      {/* Модалка: поставщик */}
      <Modal open={showSup} onClose={() => setShowSup(false)} title={editSup ? "Поставщик" : "Новый поставщик"}
        footer={<><Button variant="secondary" onClick={() => setShowSup(false)}>Отмена</Button><Button onClick={saveSup} disabled={savingSup}>{savingSup ? "Сохранение…" : "Сохранить"}</Button></>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div><label>Название *</label><input value={supForm.name} onChange={e => setSupForm(f => ({ ...f, name: e.target.value }))} style={{ width: "100%" }} /></div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 160px" }}><label>Контактное лицо</label><input value={supForm.contact} onChange={e => setSupForm(f => ({ ...f, contact: e.target.value }))} style={{ width: "100%" }} /></div>
            <div style={{ flex: "1 1 140px" }}><label>Телефон</label><input value={supForm.phone} onChange={e => setSupForm(f => ({ ...f, phone: e.target.value }))} style={{ width: "100%" }} /></div>
          </div>
          <div><label>Email</label><input value={supForm.email} onChange={e => setSupForm(f => ({ ...f, email: e.target.value }))} style={{ width: "100%" }} /></div>
          <div><label>Примечание</label><textarea value={supForm.note} onChange={e => setSupForm(f => ({ ...f, note: e.target.value }))} rows={2} style={{ width: "100%" }} /></div>
        </div>
      </Modal>
    </AppLayout>
  );
}
