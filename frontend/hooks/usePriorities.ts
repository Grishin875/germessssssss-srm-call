import { useEffect, useState } from "react";
import { api, PriorityItem } from "../lib/api";

let _cache: PriorityItem[] | null = null;

const DEFAULT_PRIORITIES: PriorityItem[] = [
  { id: 0, code: "urgent", label: "Срочный",  color: "#ef4444", sort_weight: 100, is_active: true },
  { id: 0, code: "high",   label: "Высокий",  color: "#f59e0b", sort_weight: 50,  is_active: true },
  { id: 0, code: "normal", label: "Обычный",  color: "#6b7280", sort_weight: 0,   is_active: true },
  { id: 0, code: "low",    label: "Низкий",   color: "#94a3b8", sort_weight: -10, is_active: true },
];

export function usePriorities() {
  const [priorities, setPriorities] = useState<PriorityItem[]>(_cache || DEFAULT_PRIORITIES);

  useEffect(() => {
    if (_cache) { setPriorities(_cache); return; }
    api.getPriorities()
      .then(data => { _cache = data.length ? data : DEFAULT_PRIORITIES; setPriorities(_cache); })
      .catch(console.error);
  }, []);

  const byCode = (code: string): PriorityItem =>
    priorities.find(p => p.code === code || p.label === code) ?? { id: 0, code, label: code, color: "#6b7280", sort_weight: 0, is_active: true };

  return { priorities, byCode };
}

export function invalidatePrioritiesCache() {
  _cache = null;
}
