/**
 * Единый источник правды по ролям на фронте.
 * Раньше списки производственных ролей дублировались в Sidebar, dashboard и др.
 */

/** Производственные роли — у них персональное рабочее место и страница отдела. */
export const PRODUCTION_ROLES = [
  "operator_smd",
  "montažnik",
  "operator_3d",
  "operator_engraving",
] as const;

/** Страница отдела для производственной роли (для сайдбара). */
export const DEPT_PAGE: Record<string, string> = {
  operator_smd: "/smd",
  "montažnik": "/assembly",
  operator_3d: "/3d-print",
  // operator_engraving работает через общую страницу задач
};

/** Человекочитаемые названия ролей. */
export const ROLE_LABELS: Record<string, string> = {
  admin:              "Администратор",
  manager:            "Менеджер",
  operator:           "Оператор",
  user:               "Пользователь",
  operator_smd:       "Оператор СМД",
  "montažnik":        "Монтажник",
  operator_3d:        "Оператор 3D",
  operator_engraving: "Гравёр",
  operator_otk:       "Оператор ОТК",
  operator_shipment:  "Оператор отгрузки",
  warehouse:          "Кладовщик",
};

export function isProductionRole(role?: string): boolean {
  return !!role && (PRODUCTION_ROLES as readonly string[]).includes(role);
}

export function roleLabel(role?: string): string {
  return ROLE_LABELS[role ?? ""] ?? role ?? "";
}
