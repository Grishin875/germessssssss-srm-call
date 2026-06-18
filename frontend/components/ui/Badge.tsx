"use client";
import { useI18n } from "../../lib/i18n";

type Status = string;

const STATUS_MAP: Record<string, { bg: string; color: string; dot: string }> = {
  "Создан":                   { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
  "Запланировано":            { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
  "В работе":                 { bg: "#eff6ff", color: "#2563eb", dot: "#3b82f6" },
  "Запущена":                 { bg: "#eff6ff", color: "#2563eb", dot: "#3b82f6" },
  "На паузе":                 { bg: "#fffbeb", color: "#b45309", dot: "#f59e0b" },
  "Готов к проверке ОТК":     { bg: "#f5f3ff", color: "#7c3aed", dot: "#8b5cf6" },
  "Готов к передаче на ОТК":  { bg: "#f5f3ff", color: "#7c3aed", dot: "#8b5cf6" },
  "Назначен":                 { bg: "#eff6ff", color: "#1d4ed8", dot: "#3b82f6" },
  "Передан на ОТК":           { bg: "#eef2ff", color: "#4338ca", dot: "#6366f1" },
  "На проверке ОТК":          { bg: "#eef2ff", color: "#4338ca", dot: "#6366f1" },
  "Принята":                  { bg: "#fefce8", color: "#854d0e", dot: "#eab308" },
  "Доработка":                { bg: "#fef2f2", color: "#991b1b", dot: "#ef4444" },
  "готово к отгрузке":        { bg: "#ecfdf5", color: "#065f46", dot: "#10b981" },
  "Готов к отгрузке":         { bg: "#ecfdf5", color: "#065f46", dot: "#10b981" },
  "Завершён":                 { bg: "#ecfdf5", color: "#065f46", dot: "#10b981" },
  "Завершен":                 { bg: "#ecfdf5", color: "#065f46", dot: "#10b981" },
  "Завершена":                { bg: "#ecfdf5", color: "#065f46", dot: "#10b981" },
  "Отменен":                  { bg: "#fef2f2", color: "#991b1b", dot: "#ef4444" },
  "Отменён":                  { bg: "#fef2f2", color: "#991b1b", dot: "#ef4444" },
  "Отменена":                 { bg: "#fef2f2", color: "#991b1b", dot: "#ef4444" },
  "Отремонтировано":          { bg: "#f0fdfa", color: "#065f46", dot: "#14b8a6" },
  "брак":                     { bg: "#fef2f2", color: "#991b1b", dot: "#ef4444" },
  "Передан в СЦ":             { bg: "#fff7ed", color: "#9a3412", dot: "#f97316" },
  "отгружено":                { bg: "#f0fdfa", color: "#065f46", dot: "#14b8a6" },
};

export function Badge({ status }: { status: Status }) {
  const { t } = useI18n();
  const s = STATUS_MAP[status] ?? { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      {t(`status.${status}`, status)}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useI18n();
  const map: Record<string, { bg: string; color: string; dot: string }> = {
    "Срочный": { bg: "#fef2f2", color: "#991b1b", dot: "#ef4444" },
    "Высокий": { bg: "#fff7ed", color: "#9a3412", dot: "#f97316" },
    "Обычный": { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" },
    "Низкий":  { bg: "#f8fafc", color: "#64748b", dot: "#cbd5e1" },
  };
  const s = map[priority] ?? { bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: s.dot }} />
      {t(`prio.${priority}`, priority)}
    </span>
  );
}
