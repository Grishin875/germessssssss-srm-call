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
  // Канонический маршрут по ТЗ
  { id: 0, code: "distribution",   label: "Распределение заказа",    color: "#64748b", sort_order: 6,  is_active: true },
  { id: 0, code: "warehouse_smd",  label: "Склад СМД",               color: "#6b7280", sort_order: 7,  is_active: true },
  { id: 0, code: "aoi",            label: "AOI — контроль",          color: "#ec4899", sort_order: 8,  is_active: true },
  { id: 0, code: "firmware",       label: "Прошивка",                color: "#14b8a6", sort_order: 9,  is_active: true },
  { id: 0, code: "warehouse_rea",  label: "Склад РЭА",               color: "#6b7280", sort_order: 10, is_active: true },
  { id: 0, code: "issue_rea",      label: "Выдача со склада РЭА",     color: "#6b7280", sort_order: 11, is_active: true },
  { id: 0, code: "otk",            label: "ОТК",                     color: "#22c55e", sort_order: 12, is_active: true },
  { id: 0, code: "warehouse_fg",   label: "Склад готовой продукции", color: "#6b7280", sort_order: 13, is_active: true },
  { id: 0, code: "order_assembly", label: "Сборка всего заказа",     color: "#0ea5e9", sort_order: 14, is_active: true },
  { id: 0, code: "shipment",       label: "Отгрузка",                color: "#3b82f6", sort_order: 15, is_active: true },
  // Графовый маршрут (диаграмма): петли ремонта и доп. ветки
  { id: 0, code: "repair",         label: "Ремонт РЭА",              color: "#ef4444", sort_order: 16, is_active: true },
  { id: 0, code: "programmer",     label: "Программатор",            color: "#a855f7", sort_order: 17, is_active: true },
  { id: 0, code: "marking",        label: "Маркировка",              color: "#f59e0b", sort_order: 18, is_active: true },
  { id: 0, code: "assembly_rea",   label: "Монтаж РЭА",              color: "#0ea5e9", sort_order: 19, is_active: true },
  { id: 0, code: "batch_check",    label: "Проверка партии",         color: "#ec4899", sort_order: 20, is_active: true },
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
