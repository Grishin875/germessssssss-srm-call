"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { getToken } from "../../lib/api";
import { toast } from "../../components/ui/Toast";

interface ScBatch {
  batch_id: string;
  product_name: string;
  qty: number;
  status: string;
  operator_id?: string;
  operator_name?: string;
  created_at: string;
  comment?: string;
}

async function getScBatches(status: string): Promise<ScBatch[]> {
  const token = getToken();
  try {
    const res = await fetch(`/api/sc/batches?status=${status}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    return res.json();
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function completeScRepair(batchId: string, fixedQty: number, comment: string) {
  const token = getToken();
  const res = await fetch("/api/sc/complete-repair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      batchId,
      repairedItems: [{ defect_type: "Ремонт", original_qty: fixedQty, fixed_qty: fixedQty }],
      comment,
    }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.detail || e.error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export default function ScPage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [batches, setBatches] = useState<ScBatch[]>([]);
  const [fetching, setFetching] = useState(true);
  const [repairModal, setRepairModal] = useState<ScBatch | null>(null);
  const [fixedQty, setFixedQty] = useState("");
  const [repairComment, setRepairComment] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => {
    if (!loading && user && !hasPermission("sc.view")) router.replace("/dashboard");
  }, [user, loading, hasPermission, router]);
  useEffect(() => { if (user) load(); }, [user, tab]);

  async function load() {
    setFetching(true);
    setBatches(await getScBatches(tab));
    setFetching(false);
  }

  async function submitRepair() {
    if (!repairModal) return;
    const qty = parseInt(fixedQty, 10);
    if (!qty || qty <= 0) { toast.error("Укажите исправленное количество"); return; }
    setSaving(true);
    try {
      const r = await completeScRepair(repairModal.batch_id, qty, repairComment.trim());
      toast.success((r as { message?: string }).message || "Ремонт завершён");
      setRepairModal(null);
      setFixedQty("");
      setRepairComment("");
      load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    }
    setSaving(false);
  }

  if (loading || !user) return null;

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Сервис-центр</h1>
          <Button variant="secondary" size="sm" onClick={load}>↻ Обновить</Button>
        </div>

        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {(["pending", "completed"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {t === "pending" ? "Ожидают" : "Завершённые"}
            </button>
          ))}
        </div>

        <Card>
          {fetching ? (
            <div className="text-center py-12 text-gray-400">Загрузка...</div>
          ) : batches.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Партии не найдены</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700">
                    {["ID партии", "Изделие", "Кол-во", "Оператор", "Статус", "Дата", "Комментарий", ""].map((h, i) => (
                      <th key={i} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.batch_id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-3 px-3 font-mono text-xs text-gray-500">{b.batch_id}</td>
                      <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100">{b.product_name}</td>
                      <td className="py-3 px-3 text-gray-600 dark:text-gray-300">{b.qty}</td>
                      <td className="py-3 px-3 text-gray-500">{b.operator_name ?? b.operator_id ?? "—"}</td>
                      <td className="py-3 px-3"><Badge status={b.status} /></td>
                      <td className="py-3 px-3 text-gray-500">{b.created_at ? b.created_at.slice(0, 10) : "—"}</td>
                      <td className="py-3 px-3 text-gray-400 text-xs">{b.comment ?? "—"}</td>
                      <td className="py-3 px-3">
                        {tab === "pending" && (
                          <Button size="sm" onClick={() => { setRepairModal(b); setFixedQty(String(b.qty)); }}>
                            Завершить ремонт
                          </Button>
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

      <Modal
        open={!!repairModal}
        onClose={() => setRepairModal(null)}
        title={`Завершить ремонт — ${repairModal?.batch_id ?? ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRepairModal(null)}>Отмена</Button>
            <Button onClick={submitRepair} disabled={saving}>
              {saving ? "Сохранение..." : "Завершить"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            {repairModal?.product_name} — брака в партии: {repairModal?.qty} шт.
            После завершения партия уйдёт на повторную проверку ОТК.
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Исправлено, шт.</label>
            <input
              type="number" min={1} max={repairModal?.qty ?? undefined}
              value={fixedQty} onChange={(e) => setFixedQty(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Комментарий</label>
            <textarea
              value={repairComment} onChange={(e) => setRepairComment(e.target.value)}
              rows={3} className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
        </div>
      </Modal>
    </AppLayout>
  );
}
