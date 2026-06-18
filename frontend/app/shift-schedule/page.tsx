"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../lib/auth";
import { AppLayout } from "../../components/layout/AppLayout";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Modal } from "../../components/ui/Modal";
import { api, Shift, Operator, ShiftsReport } from "../../lib/api";

const INPUT_CLS =
  "w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500";

function todayStr() { return new Date().toISOString().slice(0, 10); }
function weekAheadStr() {
  const d = new Date(); d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}

const SHIFT_TYPES = ["Утренняя", "Дневная", "Ночная"];
const STATUSES = ["planned", "active", "completed"];
const STATUS_LABELS: Record<string, string> = { planned: "Запланирована", active: "Активна", completed: "Завершена" };

const EMPTY_FORM = {
  shift_date: "", shift_type: "Утренняя", operator_id: "",
  start_time: "", end_time: "", department: "",
  status: "planned", actual_hours: "", comment: "",
};

export default function ShiftSchedulePage() {
  const { user, loading, hasPermission } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<"schedule" | "report">("schedule");
  const [operators, setOperators] = useState<Operator[]>([]);

  const [shifts, setShifts] = useState<Shift[]>([]);
  const [fetching, setFetching] = useState(true);
  const [dateFrom, setDateFrom] = useState(todayStr());
  const [dateTo, setDateTo] = useState(weekAheadStr());
  const [filterOperator, setFilterOperator] = useState("");

  const [reportFrom, setReportFrom] = useState(todayStr());
  const [reportTo, setReportTo] = useState(weekAheadStr());
  const [report, setReport] = useState<ShiftsReport | null>(null);
  const [reportFetching, setReportFetching] = useState(false);
  const [expandedEmployee, setExpandedEmployee] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editShift, setEditShift] = useState<Shift | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Shift | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [user, loading, router]);
  useEffect(() => { if (user) api.getOperators().then(setOperators).catch(console.error); }, [user]);
  useEffect(() => { if (user) loadShifts(); }, [user, dateFrom, dateTo, filterOperator]);

  async function loadShifts() {
    setFetching(true);
    try {
      const params: Record<string, string> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (filterOperator) params.operator_id = filterOperator;
      setShifts(await api.getShifts(params));
    } catch {}
    setFetching(false);
  }

  async function loadReport() {
    if (!reportFrom || !reportTo) return;
    setReportFetching(true);
    try { setReport(await api.getShiftsReport(reportFrom, reportTo)); } catch {}
    setReportFetching(false);
  }

  function openCreate() { setEditShift(null); setForm(EMPTY_FORM); setFormError(""); setShowModal(true); }

  function openEdit(shift: Shift) {
    setEditShift(shift);
    setForm({
      shift_date: shift.shift_date ?? "", shift_type: shift.shift_type ?? "Утренняя",
      operator_id: shift.operator_id ?? "", start_time: shift.start_time ?? "",
      end_time: shift.end_time ?? "", department: shift.department ?? "",
      status: shift.status ?? "planned",
      actual_hours: shift.actual_hours != null ? String(shift.actual_hours) : "",
      comment: shift.comment ?? "",
    });
    setFormError(""); setShowModal(true);
  }

  async function saveShift() {
    if (!form.shift_date) { setFormError("Укажите дату смены"); return; }
    if (!form.operator_id) { setFormError("Выберите оператора"); return; }
    setSaving(true); setFormError("");
    try {
      const payload: Partial<Shift> = {
        shift_date: form.shift_date, shift_type: form.shift_type, operator_id: form.operator_id,
        start_time: form.start_time || undefined, end_time: form.end_time || undefined,
        department: form.department || undefined, status: form.status,
        actual_hours: form.actual_hours ? Number(form.actual_hours) : undefined,
        comment: form.comment || undefined,
      };
      if (editShift) await api.updateShift(editShift.id, payload);
      else await api.createShift(payload);
      setShowModal(false); loadShifts();
    } catch (e: unknown) { setFormError(e instanceof Error ? e.message : "Ошибка при сохранении"); }
    setSaving(false);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try { await api.deleteShift(deleteTarget.id); setDeleteTarget(null); loadShifts(); } catch {}
    setDeleting(false);
  }

  if (loading || !user) return null;

  if (!hasPermission("shift_schedule.view")) {
    return <AppLayout><div className="text-center py-20 text-gray-500">Нет доступа</div></AppLayout>;
  }

  const canEdit = hasPermission("shift_schedule.edit");
  const reportTotalShifts = report?.employees.reduce((s, e) => s + e.total_shifts, 0) ?? 0;
  const reportTotalHours = report?.employees.reduce((s, e) => s + e.total_hours, 0) ?? 0;

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">График смен</h1>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => tab === "schedule" ? loadShifts() : loadReport()}>↻ Обновить</Button>
            {canEdit && <Button onClick={openCreate}>+ Добавить смену</Button>}
          </div>
        </div>

        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          {(["schedule", "report"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${tab === t ? "border-blue-500 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {t === "schedule" ? "Расписание" : "Отчёт"}
            </button>
          ))}
        </div>

        {tab === "schedule" && (
          <>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата с</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата по</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Оператор</label>
                <select value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Все операторы</option>
                  {operators.map((op) => <option key={op.id} value={op.employee_id}>{op.name}</option>)}
                </select>
              </div>
            </div>
            <Card>
              {fetching ? <div className="text-center py-12 text-gray-400">Загрузка...</div>
                : shifts.length === 0 ? <div className="text-center py-12 text-gray-400">Смены не найдены</div>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-700">
                          {["Дата", "Тип смены", "Оператор", "Время", "Отдел", "Статус", "Часы", "Комментарий", ...(canEdit ? ["Действия"] : [])].map((h) => (
                            <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {shifts.map((s) => (
                          <tr key={s.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="py-3 px-3 text-gray-700 dark:text-gray-200 whitespace-nowrap">{new Date(s.shift_date).toLocaleDateString("ru")}</td>
                            <td className="py-3 px-3 text-gray-700 dark:text-gray-200">{s.shift_type}</td>
                            <td className="py-3 px-3 text-gray-700 dark:text-gray-200">{s.operator_name ?? s.operator_id}</td>
                            <td className="py-3 px-3 text-gray-500 text-xs whitespace-nowrap">
                              {s.start_time && s.end_time ? `${s.start_time} – ${s.end_time}` : s.start_time ?? "—"}
                            </td>
                            <td className="py-3 px-3 text-gray-500">{s.department ?? "—"}</td>
                            <td className="py-3 px-3"><Badge status={STATUS_LABELS[s.status] ?? s.status} /></td>
                            <td className="py-3 px-3 text-gray-500">{s.actual_hours != null ? `${s.actual_hours} ч` : "—"}</td>
                            <td className="py-3 px-3 text-gray-400 text-xs max-w-[180px] truncate">{s.comment ?? "—"}</td>
                            {canEdit && (
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-1">
                                  <button onClick={() => openEdit(s)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-blue-600">✏️</button>
                                  <button onClick={() => setDeleteTarget(s)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-red-600">🗑</button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
            </Card>
          </>
        )}

        {tab === "report" && (
          <>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата с</label>
                <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Дата по</label>
                <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <Button onClick={loadReport} loading={reportFetching}>Сформировать</Button>
            </div>
            {!report && !reportFetching && (
              <Card><div className="text-center py-12 text-gray-400">Выберите период и нажмите "Сформировать"</div></Card>
            )}
            {report && (
              <Card>
                {report.employees.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">Данные не найдены за выбранный период</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-700">
                          {["Сотрудник", "Роль", "Смен", "Часов", "Детали"].map((h) => (
                            <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.employees.map((emp) => (
                          <>
                            <tr key={emp.employee_id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                              <td className="py-3 px-3 font-medium text-gray-900 dark:text-gray-100">{emp.employee_name}</td>
                              <td className="py-3 px-3 text-gray-500">{emp.employee_role}</td>
                              <td className="py-3 px-3 text-gray-700 dark:text-gray-200">{emp.total_shifts}</td>
                              <td className="py-3 px-3 text-gray-700 dark:text-gray-200">{emp.total_hours} ч</td>
                              <td className="py-3 px-3">
                                {emp.shifts.length > 0 && (
                                  <button onClick={() => setExpandedEmployee(expandedEmployee === emp.employee_id ? null : emp.employee_id)}
                                    className="text-xs text-blue-600 hover:underline">
                                    {expandedEmployee === emp.employee_id ? "Скрыть" : `Показать (${emp.shifts.length})`}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {expandedEmployee === emp.employee_id && (
                              <tr key={`${emp.employee_id}-detail`} className="bg-gray-50 dark:bg-gray-700/20">
                                <td colSpan={5} className="px-6 pb-3 pt-1">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-gray-400 border-b border-gray-200 dark:border-gray-600">
                                        {["Дата", "Тип", "Время", "Статус", "Часы", "Комментарий"].map((h) => (
                                          <th key={h} className="text-left py-1 pr-4">{h}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {emp.shifts.map((sh) => (
                                        <tr key={sh.id} className="border-b border-gray-100 dark:border-gray-700/30">
                                          <td className="py-1 pr-4">{new Date(sh.shift_date).toLocaleDateString("ru")}</td>
                                          <td className="py-1 pr-4">{sh.shift_type}</td>
                                          <td className="py-1 pr-4">{sh.start_time && sh.end_time ? `${sh.start_time}–${sh.end_time}` : "—"}</td>
                                          <td className="py-1 pr-4"><Badge status={STATUS_LABELS[sh.status] ?? sh.status} /></td>
                                          <td className="py-1 pr-4">{sh.actual_hours != null ? `${sh.actual_hours} ч` : "—"}</td>
                                          <td className="py-1 text-gray-400">{sh.comment ?? "—"}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                        <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/30 font-semibold">
                          <td className="py-3 px-3 text-gray-900 dark:text-gray-100">Итого</td>
                          <td className="py-3 px-3 text-gray-400">{report.employees.length} сотр.</td>
                          <td className="py-3 px-3 text-gray-900 dark:text-gray-100">{reportTotalShifts}</td>
                          <td className="py-3 px-3 text-gray-900 dark:text-gray-100">{reportTotalHours} ч</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>

      <Modal open={showModal} onClose={() => { setShowModal(false); setFormError(""); }}
        title={editShift ? "Редактировать смену" : "Создать смену"}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setShowModal(false); setFormError(""); }}>Отмена</Button>
            <Button onClick={saveShift} loading={saving}>{editShift ? "Сохранить" : "Создать"}</Button>
          </>
        }>
        <div className="space-y-4">
          {formError && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{formError}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Дата смены *</label>
            <input type="date" value={form.shift_date} onChange={(e) => setForm({ ...form, shift_date: e.target.value })} className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Тип смены</label>
            <select value={form.shift_type} onChange={(e) => setForm({ ...form, shift_type: e.target.value })} className={INPUT_CLS}>
              {SHIFT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Оператор *</label>
            <select value={form.operator_id} onChange={(e) => setForm({ ...form, operator_id: e.target.value })} className={INPUT_CLS}>
              <option value="">— Выберите оператора —</option>
              {operators.map((op) => <option key={op.id} value={op.employee_id}>{op.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Время начала</label>
              <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className={INPUT_CLS} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Время конца</label>
              <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className={INPUT_CLS} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Отдел</label>
            <input type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Название отдела" className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Статус</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={INPUT_CLS}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Фактические часы</label>
            <input type="number" min={0} step={0.5} value={form.actual_hours} onChange={(e) => setForm({ ...form, actual_hours: e.target.value })} placeholder="0" className={INPUT_CLS} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Комментарий</label>
            <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={3} className={`${INPUT_CLS} resize-none`} />
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Удалить смену"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Отмена</Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>Удалить</Button>
          </>
        }>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Вы уверены, что хотите удалить смену{" "}
          {deleteTarget && <span className="font-medium">{deleteTarget.shift_type} — {new Date(deleteTarget.shift_date).toLocaleDateString("ru")}</span>}?
        </p>
      </Modal>
    </AppLayout>
  );
}
