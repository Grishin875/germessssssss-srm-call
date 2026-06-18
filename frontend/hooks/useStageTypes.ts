import { useEffect, useState } from "react";
import { api, StageTypeItem } from "../lib/api";

let _cache: StageTypeItem[] | null = null;
let _promise: Promise<StageTypeItem[]> | null = null;

const DEFAULT_STAGE_TYPES: StageTypeItem[] = [
  { id: 0, code: "smd",       label: "СМД",        color: "#8b5cf6", sort_order: 0, is_active: true },
  { id: 0, code: "assembly",  label: "Сборка",      color: "#0ea5e9", sort_order: 1, is_active: true },
  { id: 0, code: "3d_print",  label: "3D Печать",   color: "#10b981", sort_order: 2, is_active: true },
  { id: 0, code: "engraving", label: "Гравировка",  color: "#f59e0b", sort_order: 3, is_active: true },
  { id: 0, code: "case",      label: "Корпус",      color: "#f97316", sort_order: 4, is_active: true },
  { id: 0, code: "warehouse", label: "Склад",       color: "#6b7280", sort_order: 5, is_active: true },
];

export function useStageTypes() {
  const [stageTypes, setStageTypes] = useState<StageTypeItem[]>(_cache || DEFAULT_STAGE_TYPES);

  useEffect(() => {
    if (_cache) { setStageTypes(_cache); return; }
    if (!_promise) {
      _promise = api.getStageTypes().catch(() => DEFAULT_STAGE_TYPES);
    }
    _promise.then(data => {
      _cache = data.length ? data : DEFAULT_STAGE_TYPES;
      setStageTypes(_cache);
    });
  }, []);

  const byCode = (code: string): StageTypeItem =>
    stageTypes.find(s => s.code === code) ?? { id: 0, code, label: code, color: "#6b7280", sort_order: 99, is_active: true };

  const labelMap: Record<string, { label: string; color: string }> = Object.fromEntries(
    stageTypes.map(s => [s.code, { label: s.label, color: s.color }])
  );

  return { stageTypes, byCode, labelMap };
}

export function invalidateStageTypesCache() {
  _cache = null;
  _promise = null;
}
