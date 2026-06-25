"""
Разворачивание потребности изделия в СКЛАДСКИЕ компоненты (BOM explosion),
включая вложенные под-изделия (полуфабрикаты), которые сами производятся на заводе.

Единый источник правды для всех расчётов спроса (create_order, _compute_order_demand,
products.calculate_demand / calculate_order_demand), чтобы они не расходились.

Модель источника компонента рецепта (recipes.source):
  warehouse                     — складская позиция (списывается с warehouse_components);
  smd | engraving | 3d_print    — внутрипроизводственный промежуток ЭТОГО изделия
                                  (его сырьё — отдельные строки рецепта с source='warehouse');
  purchase                      — закупается напрямую (не со склада);
  product                       — ДРУГОЕ изделие завода (полуфабрикат) со своей рецептурой:
                                  warehouse_component_name|component_name = имя того изделия.

Для source='product' потребность разворачивается РЕКУРСИВНО до складских листьев,
предварительно вычитая наличие готовой продукции под-изделия (finished_goods.good_qty),
чтобы заказывать сырьё только на дефицит. Циклы (A↔B) и слишком глубокая вложенность
обрезаются (_MAX_DEPTH).

Все таблицы (recipes, finished_goods, recipe_cases, warehouse_components) лежат в одной
БД crm_production, поэтому помощник работает с любой сессией сервиса.
"""
from sqlalchemy import text

_MAX_DEPTH = 12


def _norm(s) -> str:
    return (s or "").strip().lower()


async def direct_warehouse_demand(db, product_name: str, qty: float) -> dict:
    """ПРЯМАЯ складская потребность изделия (БЕЗ развёртки под-изделий): только
    строки рецепта source='warehouse' + складские корпуса. Под-изделия (source='product')
    в модели авто-подзаказа резервируются/производятся отдельно, поэтому здесь не учитываются.
    Возвращает {норм_имя: {"name", "required"}}."""
    out: dict = {}
    try:
        qty = float(qty or 0)
    except (TypeError, ValueError):
        qty = 0.0
    if qty <= 0:
        return out
    key_pn = _norm(product_name)
    if not key_pn:
        return out
    rows = (await db.execute(text(
        "SELECT component_name, warehouse_component_name, norm "
        "FROM recipes WHERE LOWER(TRIM(product_name)) = :pn "
        "AND COALESCE(source,'warehouse') = 'warehouse'"
    ), {"pn": key_pn})).mappings().all()
    for r in rows:
        try:
            need = float(r["norm"] or 0) * qty
        except (TypeError, ValueError):
            need = 0.0
        name = (r["warehouse_component_name"] or "").strip() or (r["component_name"] or "").strip()
        if need <= 0 or not name:
            continue
        slot = out.setdefault(_norm(name), {"name": name, "required": 0.0})
        slot["required"] += need
    cases = (await db.execute(text(
        "SELECT case_name, qty FROM recipe_cases "
        "WHERE LOWER(TRIM(product_name)) = :pn AND COALESCE(source,'warehouse') = 'warehouse'"
    ), {"pn": key_pn})).mappings().all()
    for c in cases:
        cname = (c["case_name"] or "").strip()
        try:
            cqty = float(c["qty"] or 0) * qty
        except (TypeError, ValueError):
            cqty = 0.0
        if cqty <= 0 or not cname:
            continue
        slot = out.setdefault(_norm(cname), {"name": cname, "required": 0.0})
        slot["required"] += cqty
    return out


async def direct_subproducts(db, product_name: str, qty: float) -> list:
    """Прямые суб-изделия (source='product') изделия: [{"name", "required"}].
    Это полуфабрикаты, которые делают на заводе и которые нужно либо взять с ГП,
    либо произвести отдельным под-заказом."""
    out: list = []
    try:
        qty = float(qty or 0)
    except (TypeError, ValueError):
        qty = 0.0
    if qty <= 0:
        return out
    key_pn = _norm(product_name)
    if not key_pn:
        return out
    rows = (await db.execute(text(
        "SELECT component_name, warehouse_component_name, norm "
        "FROM recipes WHERE LOWER(TRIM(product_name)) = :pn "
        "AND COALESCE(source,'warehouse') = 'product'"
    ), {"pn": key_pn})).mappings().all()
    agg: dict = {}
    for r in rows:
        name = (r["warehouse_component_name"] or "").strip() or (r["component_name"] or "").strip()
        try:
            need = float(r["norm"] or 0) * qty
        except (TypeError, ValueError):
            need = 0.0
        if need <= 0 or not name:
            continue
        slot = agg.setdefault(_norm(name), {"name": name, "required": 0.0})
        slot["required"] += need
    return list(agg.values())


async def explode_warehouse_demand(db, product_name: str, qty: float,
                                   *, net_finished_goods: bool = True,
                                   _visited=None, _depth: int = 0) -> dict:
    """Развернуть потребность `qty` штук изделия `product_name` до складских компонентов.

    Возвращает {норм_имя: {"name": <складское имя>, "required": float}} — суммарную
    потребность по каждому складскому компоненту с учётом вложенных под-изделий.
    """
    out: dict = {}
    try:
        qty = float(qty or 0)
    except (TypeError, ValueError):
        qty = 0.0
    if qty <= 0 or _depth > _MAX_DEPTH:
        return out

    key_pn = _norm(product_name)
    if not key_pn:
        return out
    visited = set(_visited or ())
    if key_pn in visited:
        return out  # защита от цикла A↔B
    visited.add(key_pn)

    rows = (await db.execute(text(
        "SELECT component_name, warehouse_component_name, norm, "
        "COALESCE(source,'warehouse') AS source "
        "FROM recipes WHERE LOWER(TRIM(product_name)) = :pn"
    ), {"pn": key_pn})).mappings().all()

    for r in rows:
        try:
            per = float(r["norm"] or 0)
        except (TypeError, ValueError):
            per = 0.0
        need = per * qty
        if need <= 0:
            continue
        src = (r["source"] or "warehouse")
        name = (r["warehouse_component_name"] or "").strip() or (r["component_name"] or "").strip()
        if not name:
            continue

        if src == "product":
            # Под-изделие: вычитаем наличие ГП и разворачиваем только дефицит
            shortfall = need
            if net_finished_goods:
                on_hand = (await db.execute(text(
                    "SELECT COALESCE(good_qty,0) FROM finished_goods "
                    "WHERE LOWER(TRIM(product_name)) = :n"
                ), {"n": _norm(name)})).scalar() or 0
                shortfall = max(0.0, need - float(on_hand))
            if shortfall > 0:
                sub = await explode_warehouse_demand(
                    db, name, shortfall, net_finished_goods=net_finished_goods,
                    _visited=visited, _depth=_depth + 1)
                for k, v in sub.items():
                    slot = out.setdefault(k, {"name": v["name"], "required": 0.0})
                    slot["required"] += v["required"]
        elif src == "warehouse":
            k = _norm(name)
            slot = out.setdefault(k, {"name": name, "required": 0.0})
            slot["required"] += need
        # smd | engraving | 3d_print | purchase — со склада не списываются, пропускаем

    # Корпуса (recipe_cases) со склада — тоже складская потребность
    cases = (await db.execute(text(
        "SELECT case_name, qty, COALESCE(source,'warehouse') AS source "
        "FROM recipe_cases WHERE LOWER(TRIM(product_name)) = :pn"
    ), {"pn": key_pn})).mappings().all()
    for c in cases:
        if (c["source"] or "warehouse") != "warehouse":
            continue
        cname = (c["case_name"] or "").strip()
        if not cname:
            continue
        try:
            cqty = float(c["qty"] or 0) * qty
        except (TypeError, ValueError):
            cqty = 0.0
        if cqty <= 0:
            continue
        k = _norm(cname)
        slot = out.setdefault(k, {"name": cname, "required": 0.0})
        slot["required"] += cqty

    return out
