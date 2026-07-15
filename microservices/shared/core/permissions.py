"""Единый источник истины по правам доступа для ВСЕХ микросервисов.

Раньше эффективные права считал только auth (resolve_permissions в /me и /login),
а warehouse и products читали сырую колонку users.user_permissions напрямую. Из-за
этого права расходились: фронт (по данным auth) показывал кнопку, а warehouse/products
отвечали 403. Теперь все сервисы вычисляют права одинаково — через этот модуль.

auth-microservice/app/services/permissions.py ре-экспортирует эти функции, чтобы
определения не дублировались и не разъезжались.
"""
from typing import Optional, Dict, List

PERMISSION_PRESET_ALL: Dict[str, bool] = {
    "dashboard.view": True, "warehouse.view": True, "warehouse.edit": True,
    "recipes.view": True, "recipes.edit": True, "orders.view": True,
    "orders.create": True, "orders.edit": True, "orders.delete": True,
    "orders.start": True, "orders.transfer_otk": True, "production.view": True,
    "production.start": True, "production.edit": True, "production.delete": True,
    "production.pause_complete": True, "archive.view": True, "archive.delete": True,
    "shift_schedule.view": True, "shift_schedule.edit": True, "otk.view": True,
    "sc.view": True, "tasks.view": True, "tasks.manage": True,
    "checklist.manage": True, "users.view": True, "users.manage": True,
}

DEPARTMENT_TO_VIEW_PERMISSION: Dict[str, str] = {
    "warehouse": "warehouse.view", "recipes": "recipes.view",
    "orders": "orders.view", "production": "production.view",
    "shift-schedule": "shift_schedule.view", "otk": "otk.view",
    "sc": "sc.view", "users": "users.view", "tasks": "tasks.view",
    "archive": "archive.view",
}

ALLOWED_ROLES = ["user", "manager", "admin", "operator_smd", "montažnik", "operator_3d",
                 "operator_engraving", "operator_otk", "operator_shipment", "warehouse"]

PRODUCTION_ROLES = {"operator_smd", "montažnik", "operator_3d", "operator_engraving"}
OTK_ROLES = {"operator_otk"}

ROLE_TO_STAGE_TYPE: dict = {
    "operator_smd":       "smd",
    "montažnik":         "assembly",
    "operator_3d":        "3d_print",
    "operator_engraving": "engraving",
    "operator_otk":       "otk",
}


def _dep_from_key(key: str) -> Optional[str]:
    for prefix, dep in [
        ("warehouse.", "warehouse"), ("recipes.", "recipes"), ("orders.", "orders"),
        ("production.", "production"), ("shift_schedule.", "shift-schedule"),
        ("otk.", "otk"), ("sc.", "sc"), ("users.", "users"),
        ("tasks.", "tasks"), ("archive.", "archive"),
    ]:
        if key.startswith(prefix):
            return dep
    return None


# Права по умолчанию для ролей
ROLE_DEFAULT_PERMISSIONS: Dict[str, Dict[str, bool]] = {
    "manager": {
        "dashboard.view": True, "orders.view": True, "orders.create": True,
        "orders.edit": True, "orders.delete": True, "orders.start": True,
        "orders.transfer_otk": True, "production.view": True, "production.start": True,
        "production.edit": True, "production.pause_complete": True,
        "warehouse.view": True, "recipes.view": True, "archive.view": True,
        "shift_schedule.view": True, "otk.view": True, "sc.view": True, "tasks.view": True,
        "tasks.manage": True, "users.view": True,
    },
    "operator_smd": {
        "dashboard.view": True, "orders.view": True,
        "production.view": True, "production.start": True, "production.pause_complete": True,
        "recipes.view": True, "shift_schedule.view": True, "tasks.view": True,
    },
    "montažnik": {
        "dashboard.view": True, "orders.view": True,
        "production.view": True, "production.start": True, "production.pause_complete": True,
        "recipes.view": True, "shift_schedule.view": True, "tasks.view": True,
    },
    "operator_3d": {
        "dashboard.view": True, "orders.view": True,
        "production.view": True, "production.start": True, "production.pause_complete": True,
        "recipes.view": True, "shift_schedule.view": True, "tasks.view": True,
    },
    "operator_engraving": {
        "dashboard.view": True, "orders.view": True,
        "production.view": True, "production.start": True, "production.pause_complete": True,
        "recipes.view": True, "shift_schedule.view": True, "tasks.view": True,
    },
    "operator_otk": {
        "dashboard.view": True,
        "otk.view": True, "production.view": True,
        "shift_schedule.view": True, "tasks.view": True, "archive.view": True,
    },
    "operator_shipment": {
        "dashboard.view": True,
        "otk.view": True, "archive.view": True,
        "shift_schedule.view": True, "tasks.view": True,
    },
    "warehouse": {
        "dashboard.view": True, "orders.view": True,
        "warehouse.view": True, "warehouse.edit": True,
        "production.view": True, "recipes.view": True,
        "shift_schedule.view": True, "tasks.view": True, "archive.view": True,
    },
}


def build_default_permissions(role: str, departments: List[str]) -> Dict[str, bool]:
    if role == "admin":
        return dict(PERMISSION_PRESET_ALL)
    # Если есть пресет для роли — используем его
    if role in ROLE_DEFAULT_PERMISSIONS:
        return dict(ROLE_DEFAULT_PERMISSIONS[role])
    # Иначе — строим по отделам
    base: Dict[str, bool] = {"dashboard.view": True, "archive.view": True}
    for dep in departments:
        key = DEPARTMENT_TO_VIEW_PERMISSION.get(dep)
        if key:
            base[key] = True
    return base


def restrict_permissions(role: str, departments: List[str], raw: Optional[Dict]) -> Dict[str, bool]:
    if not raw:
        return {}
    if role == "admin":
        return {k: bool(v) for k, v in raw.items()}
    deps = set(departments)
    return {k: True for k, v in raw.items() if v and (_dep_from_key(k) is None or _dep_from_key(k) in deps)}


def resolve_permissions(role: str, departments: List[str], stored: Optional[Dict]) -> Dict[str, bool]:
    """Эффективные права: базовые права роли применяются ВСЕГДА, индивидуальные
    сохранённые права наслаиваются сверху (могут добавить/переопределить).
      • обновление дефолтов роли доходит до уже созданных пользователей без миграции;
      • кастомные права из формы админа не теряются;
      • роли без production.view/orders.view (напр. operator_shipment) не сбрасываются.
    ЭТА функция должна использоваться во ВСЕХ сервисах при вычислении прав из БД."""
    normalized = {k: bool(v) for k, v in (stored or {}).items()}
    return {**build_default_permissions(role, departments), **normalized}
