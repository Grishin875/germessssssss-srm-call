import logging
from typing import Optional, List
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, delete, func, text, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.products import Recipe, RecipeProductOrder, RecipeAttachment, FinishedGoods, Planning, RecipeCase, RecipeStage, ProductCatalog
from shared.core.bom import explode_warehouse_demand, direct_warehouse_demand
from app.schemas.recipes import (
    RecipeCreate, RecipeUpdate, CalculateDemandRequest, ProductOrderItem,
    RecipeCaseCreate, RecipeCaseUpdate, RecipeCaseOut,
    RecipeStageCreate, RecipeStageUpdate,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _db(r: Request):
    return r.state.db


def _user(r: Request):
    u = r.state.current_user
    if not u:
        raise HTTPException(401, "Не авторизован")
    return u


def _perm(r: Request, p: str):
    u = _user(r)
    if u.role == "admin":
        return u
    if not (u.user_permissions or {}).get(p):
        raise HTTPException(403, f"Недостаточно прав: {p}")
    return u


def _norm(s: str) -> str:
    return s.strip().lower()

def _m(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}


async def _ensure_in_catalog(db, product_name: str):
    """Синхронизация Рецептура → Каталог: завести изделие в каталог, если его там нет.
    Атомарно (INSERT ... ON CONFLICT DO NOTHING) — устойчиво к параллельным запросам
    при создании продукта. Не коммитит (вызывается внутри транзакции эндпоинта)."""
    name = (product_name or "").strip()
    if not name:
        return
    await db.execute(
        pg_insert(ProductCatalog)
        .values(name=name, unit="шт", is_active=True)
        .on_conflict_do_nothing(index_elements=["name"])
    )


async def _resolve_product_id(db, product_name: str):
    """id изделия из каталога по имени (регистронезависимо, детерминированно min(id)).
    Каталог гарантируется вызовом _ensure_in_catalog перед этим. ФАЗА 1/2: новые строки
    рецептуры рождаются с product_id, а не только backfill старых при старте."""
    name = (product_name or "").strip()
    if not name:
        return None
    return (await db.execute(text(
        "SELECT min(id) FROM product_catalog WHERE lower(trim(name)) = lower(trim(:n))"
    ), {"n": name})).scalar()


async def _resolve_operation_type_id(db, stage_type: str):
    """id операции из справочника operation_types по коду stage_type (ФАЗА 1/2)."""
    code = (stage_type or "").strip()
    if not code:
        return None
    return (await db.execute(text(
        "SELECT id FROM operation_types WHERE code = :c LIMIT 1"
    ), {"c": code})).scalar()


async def _ensure_in_recipe_registry(db, product_name: str, production_type: str = "SMD"):
    """Синхронизация Каталог → Рецептура: зарегистрировать изделие в производственном
    реестре (recipe_product_order). Атомарно, устойчиво к гонкам."""
    name = (product_name or "").strip()
    if not name:
        return
    await db.execute(
        pg_insert(RecipeProductOrder)
        .values(product_name=name, production_type=production_type, sort_order=0)
        .on_conflict_do_nothing(index_elements=["product_name"])
    )


async def _cleanup_if_empty(db, product_name: str):
    """Если у изделия не осталось ни компонентов, ни этапов, ни корпусов —
    удалить его полностью (реестр, каталог, вложения). Не коммитит."""
    name = (product_name or "").strip()
    if not name:
        return
    pn = name.lower()
    rc = (await db.execute(select(func.count()).select_from(Recipe).where(func.lower(Recipe.product_name) == pn))).scalar() or 0
    sc = (await db.execute(select(func.count()).select_from(RecipeStage).where(func.lower(RecipeStage.product_name) == pn))).scalar() or 0
    cc = (await db.execute(select(func.count()).select_from(RecipeCase).where(func.lower(RecipeCase.product_name) == pn))).scalar() or 0
    if rc == 0 and sc == 0 and cc == 0:
        await db.execute(delete(RecipeProductOrder).where(func.lower(RecipeProductOrder.product_name) == pn))
        await db.execute(delete(ProductCatalog).where(func.lower(ProductCatalog.name) == pn))
        await db.execute(delete(RecipeAttachment).where(func.lower(func.trim(RecipeAttachment.product_name)) == pn))


# ── Recipes ───────────────────────────────────────────────────────────────────

@router.get("/recipes")
async def list_recipes(request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    # Complex JOIN with warehouse - keep as text()
    rows = (await db.execute(text("""
        SELECT r.*,
               COALESCE(w.stock, 0) as stock_on_warehouse,
               w.category as warehouse_category
        FROM recipes r
        LEFT JOIN warehouse_components w
          ON LOWER(TRIM(COALESCE(NULLIF(TRIM(r.warehouse_component_name),''), r.component_name))) = LOWER(TRIM(w.name))
        ORDER BY LOWER(r.product_name), LOWER(r.component_name)
    """))).mappings().all()
    return list(rows)


@router.get("/recipes/products")
async def list_products(request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    result = await db.execute(
        select(Recipe.product_name)
        .group_by(Recipe.product_name)
        .order_by(Recipe.product_name)
    )
    return [r[0] for r in result.all()]


@router.get("/recipes/products/type/{ptype}")
async def products_by_type(ptype: str, request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    result = await db.execute(
        select(Recipe.product_name)
        .where(Recipe.production_type == ptype)
        .group_by(Recipe.product_name)
        .order_by(Recipe.product_name)
    )
    return [r[0] for r in result.all()]


@router.get("/recipes/product/{product_name}/{ptype}")
async def recipes_by_product_type(product_name: str, ptype: str, request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    rows = (await db.execute(text("""
        SELECT r.*, COALESCE(w.stock, 0) as stock_on_warehouse
        FROM recipes r
        LEFT JOIN warehouse_components w
          ON LOWER(TRIM(COALESCE(NULLIF(TRIM(r.warehouse_component_name),''), r.component_name))) = LOWER(TRIM(w.name))
        WHERE LOWER(r.product_name)=:pn AND r.production_type=:pt
    """), {"pn": _norm(product_name), "pt": ptype})).mappings().all()
    return list(rows)


@router.get("/recipes/product-order/list")
async def product_order_list(request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    try:
        result = await db.execute(
            select(RecipeProductOrder)
            .order_by(RecipeProductOrder.production_type, RecipeProductOrder.sort_order)
        )
        return [_m(r) for r in result.scalars().all()]
    except Exception:
        logger.exception("Запрос списка не выполнен")
        return []


@router.post("/recipes/product-order/update")
async def update_product_order(items: List[ProductOrderItem], request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    for item in items:
        if not item.product_name:
            continue
        stmt = (
            pg_insert(RecipeProductOrder)
            .values(product_name=item.product_name, production_type=item.production_type,
                    sort_order=item.sort_order)
            .on_conflict_do_update(
                index_elements=["product_name"],
                set_={"sort_order": item.sort_order, "production_type": item.production_type,
                      "assigned_role": item.assigned_role, "updated_at": func.now()}
            )
        )
        await db.execute(stmt)
        await _ensure_in_catalog(db, item.product_name)
    await db.commit()
    return {"success": True}


@router.post("/recipes/calculate-demand")
async def calculate_demand(body: CalculateDemandRequest, request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    # Доступно = stock − reserved (свободный остаток), как при создании заказа.
    stock_rows = (await db.execute(text("SELECT name, stock, reserved FROM warehouse_components"))).mappings().all()
    stock_map = {_norm(r["name"]): max(0.0, float(r["stock"] or 0) - float(r["reserved"] or 0)) for r in stock_rows}

    # Потребность разворачиваем общим помощником: складские листья + вложенные
    # под-изделия (source='product', с зачётом ГП) + складские корпуса.
    demand: dict = {}
    for entry in body.plan:
        if not entry.product or entry.qty <= 0:
            continue
        sub = await explode_warehouse_demand(db, entry.product, entry.qty)
        for key, v in sub.items():
            slot = demand.setdefault(key, {"component": v["name"], "total": 0.0})
            slot["total"] += v["required"]

    result = []
    for key, d in demand.items():
        stock = stock_map.get(key, 0)
        result.append({
            "component": d["component"],
            "totalRequired": round(d["total"], 3),
            "stock": round(stock, 3),
            "shortage": round(max(0, d["total"] - stock), 3),
        })
    result.sort(key=lambda x: x["component"])
    return result


@router.post("/recipes/calculate-order-demand")
async def calculate_order_demand(request: Request):
    """
    Проверяет наличие складских компонентов (warehouse_components) для создания заказа.
    Возвращает список компонентов с source='warehouse' и их доступность.

    Поддерживает два режима:
      • одно изделие — body: {product_name, planned_qty, production_type?}
      • несколько позиций — body: {positions: [{product_name, qty, production_type?}, ...]}.
        Потребность суммируется по всем позициям и агрегируется по компоненту.
    Форма ответа одинакова в обоих режимах.
    """
    _perm(request, "recipes.view")
    db = _db(request)
    body = await request.json()

    # Нормализуем вход в список позиций (product_name, qty, production_type)
    raw_positions = body.get("positions")
    positions: list[dict] = []
    if raw_positions:
        for p in raw_positions:
            pn = (p.get("product_name") or "").strip()
            qty = int(p.get("qty") or p.get("planned_qty") or 0)
            if not pn or qty <= 0:
                continue
            positions.append({
                "product_name": pn,
                "qty": qty,
                "production_type": p.get("production_type"),
            })
        if not positions:
            raise HTTPException(400, "positions не содержит валидных позиций")
    else:
        product_name = body.get("product_name", "")
        planned_qty = int(body.get("planned_qty", 0))
        if not product_name or not planned_qty:
            raise HTTPException(400, "product_name и planned_qty обязательны")
        positions.append({
            "product_name": product_name,
            "qty": planned_qty,
            "production_type": body.get("production_type"),
        })

    # Свободный остаток (stock − reserved) — как гейт при создании заказа.
    stock_rows = (await db.execute(text(
        "SELECT name, stock, reserved FROM warehouse_components"
    ))).mappings().all()
    free_map = {_norm(r["name"]): max(0.0, float(r["stock"] or 0) - float(r["reserved"] or 0)) for r in stock_rows}

    # Складская потребность через общий помощник — ровно тот же набор, что создаёт и
    # резервирует create_order: листья source='warehouse' + развёртка под-изделий
    # (source='product', зачёт ГП) + складские корпуса. Один остаток выделяется один раз.
    demand: dict = {}
    found_any = False
    total_qty = 0.0   # суммарное кол-во изделий по позициям с рецептурой — для расчёта нормы
    for pos in positions:
        has_recipe = (await db.execute(text(
            "SELECT 1 FROM recipes WHERE LOWER(TRIM(product_name))=:pn LIMIT 1"
        ), {"pn": _norm(pos["product_name"])})).scalar()
        if not has_recipe:
            continue
        found_any = True
        total_qty += float(pos["qty"] or 0)
        # Прямые складские компоненты — ровно то, что гейтит/резервирует create_order
        # (под-изделия в модели авто-подзаказа создаются отдельными заказами, не блокируют).
        sub = await direct_warehouse_demand(db, pos["product_name"], pos["qty"])
        for key, v in sub.items():
            slot = demand.setdefault(key, {"component_name": v["name"], "required": 0.0})
            slot["required"] += v["required"]

    if not found_any:
        return {"canProduce": False, "message": "Рецептура не найдена", "components": [], "by_department": {}}

    components = []
    can_produce = True
    for key, slot in demand.items():
        wname = slot["component_name"]
        required = slot["required"]
        avail = free_map.get(key, 0)
        shortage = max(0, required - avail)
        if shortage > 0:
            can_produce = False
        # Норма расхода на 1 изделие. При нескольких позициях — средневзвешенная
        # (required / суммарное кол-во); для одного изделия = точная норма рецептуры.
        norm = round(required / total_qty, 4) if total_qty else 0
        components.append({
            "component_name": wname, "production_type": "Склад", "source": "warehouse",
            "norm": norm,
            "required": required, "available": avail,
            "shortage": shortage, "canProduce": shortage == 0,
        })
    components.sort(key=lambda c: c["component_name"])
    return {
        "canProduce": can_produce,
        "components": components,
        "by_department": {"Склад": components},
    }


@router.get("/recipes/recipe-cases")
async def list_recipe_cases(request: Request, product_name: str = None):
    _perm(request, "recipes.view")
    db = _db(request)
    q = select(RecipeCase)
    if product_name:
        q = q.where(func.lower(RecipeCase.product_name) == product_name.strip().lower())
    q = q.order_by(func.lower(RecipeCase.product_name), func.lower(RecipeCase.case_name))
    result = await db.execute(q)
    return [_m(r) for r in result.scalars().all()]


@router.post("/recipes/recipe-cases", status_code=201)
async def create_recipe_case(body: RecipeCaseCreate, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    stmt = (
        pg_insert(RecipeCase)
        .values(
            product_name=body.product_name.strip(),
            case_name=body.case_name.strip(),
            source=body.source or "warehouse",
            qty=body.qty or 1,
            comment=body.comment,
        )
        .on_conflict_do_update(
            index_elements=["product_name", "case_name"],
            set_={"source": body.source or "warehouse", "qty": body.qty or 1,
                  "comment": body.comment, "updated_at": func.now()}
        )
        .returning(RecipeCase)
    )
    row = (await db.execute(stmt)).mappings().one()
    await db.commit()
    return dict(row)


@router.put("/recipes/recipe-cases/{rc_id}")
async def update_recipe_case(rc_id: int, body: RecipeCaseUpdate, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    stmt = (
        update(RecipeCase)
        .where(RecipeCase.id == rc_id)
        .values(source=body.source or "warehouse", qty=body.qty or 1,
                comment=body.comment, updated_at=func.now())
        .returning(RecipeCase)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Запись не найдена")
    await db.commit()
    return dict(row)


@router.delete("/recipes/recipe-cases/{rc_id}")
async def delete_recipe_case(rc_id: int, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    row = (await db.execute(delete(RecipeCase).where(RecipeCase.id == rc_id).returning(RecipeCase.product_name))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Запись не найдена")
    await _cleanup_if_empty(db, row)
    await db.commit()
    return {"success": True}


@router.get("/recipes/recipe-stages")
async def list_recipe_stages(request: Request, product_name: str = None):
    _perm(request, "recipes.view")
    db = _db(request)
    q = select(RecipeStage)
    if product_name:
        q = q.where(func.lower(RecipeStage.product_name) == product_name.strip().lower())
    q = q.order_by(RecipeStage.sort_order, RecipeStage.id)
    result = await db.execute(q)
    return [_m(r) for r in result.scalars().all()]


@router.post("/recipes/recipe-stages", status_code=201)
async def create_recipe_stage(body: RecipeStageCreate, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    # Запрет дубля этапа с тем же именем у изделия (параллельные группы с равным
    # sort_order, но разными именами — допустимы).
    dup = (await db.execute(text(
        "SELECT 1 FROM recipe_stages WHERE LOWER(TRIM(product_name))=:pn "
        "AND LOWER(TRIM(stage_name))=:sn LIMIT 1"
    ), {"pn": _norm(body.product_name), "sn": _norm(body.stage_name)})).scalar()
    if dup:
        raise HTTPException(409, f"Этап «{body.stage_name}» у изделия уже существует")
    await _ensure_in_catalog(db, body.product_name)
    _stype = body.stage_type or "assembly"
    stage = RecipeStage(
        product_name=body.product_name.strip(),
        product_id=await _resolve_product_id(db, body.product_name),
        stage_name=body.stage_name.strip(),
        stage_type=_stype,
        operation_type_id=await _resolve_operation_type_id(db, _stype),
        sort_order=body.sort_order,
        description=body.description,
        instructions=body.instructions,
        required_role=body.required_role,
        depends_on_previous=body.depends_on_previous,
        transfer_qty=body.transfer_qty,
        require_transfer=body.require_transfer,
        is_final=body.is_final,
        rework_target_stage_id=body.rework_target_stage_id,
        output_name=(body.output_name or "").strip() or None,
    )
    db.add(stage)
    await db.flush()
    await db.refresh(stage)
    await db.commit()
    return _m(stage)


@router.get("/recipes/product-stages/{product_name}")
async def product_stages_info(product_name: str, request: Request):
    """Возвращает этапы и нужные роли для продукта — для формы создания заказа."""
    _perm(request, "recipes.view")
    db = _db(request)
    pn_lower = product_name.strip().lower()

    stages = (await db.execute(
        select(RecipeStage)
        .where(func.lower(RecipeStage.product_name) == pn_lower)
        .order_by(RecipeStage.sort_order, RecipeStage.id)
    )).scalars().all()

    # Инфо о продукте (назначенная роль)
    product_order = (await db.execute(
        select(RecipeProductOrder)
        .where(func.lower(RecipeProductOrder.product_name) == pn_lower)
    )).scalar_one_or_none()

    assigned_role = product_order.assigned_role if product_order else None
    production_type = product_order.production_type if product_order else None

    # Если роль не задана явно — определяем автоматически из production_type рецептуры
    if not assigned_role:
        type_to_role = {
            "SMD": "operator_smd",
            "Сборка": "montažnik",
            "3D Печать": "operator_3d",
            "Гравировка": "operator_engraving",
        }
        # Берём первый production_type из рецептуры
        first_type = (await db.execute(
            select(Recipe.production_type)
            .where(func.lower(func.trim(Recipe.product_name)) == pn_lower)
            .limit(1)
        )).scalar_one_or_none()
        if first_type:
            assigned_role = type_to_role.get(first_type)
            production_type = first_type

    return {
        "stages": [_m(s) for s in stages],
        "assigned_role": assigned_role,
        "production_type": production_type,
    }


@router.put("/recipes/recipe-stages/{stage_id}")
async def update_recipe_stage(stage_id: int, body: RecipeStageUpdate, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    # exclude_unset (а НЕ exclude_none): обновляем ровно те поля, что прислал фронт —
    # включая явный null для ОЧИСТКИ (роль→«любой», описание/инструкция→пусто,
    # rework→«авто»). С exclude_none такие сбросы молча терялись.
    vals = body.model_dump(exclude_unset=True)
    if not vals:
        raise HTTPException(400, "Нет данных для обновления")
    if "output_name" in vals:
        vals["output_name"] = (vals["output_name"] or "").strip() or None  # "" / null очищает результат
    if "stage_type" in vals:
        # ФАЗА 1/2: держим ссылку на справочник операций в согласии с кодом типа
        vals["operation_type_id"] = await _resolve_operation_type_id(db, vals["stage_type"])
    vals["updated_at"] = func.now()
    stmt = (
        update(RecipeStage)
        .where(RecipeStage.id == stage_id)
        .values(**vals)
        .returning(RecipeStage)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Этап не найден")
    await db.commit()
    return dict(row)


@router.delete("/recipes/recipe-stages/{stage_id}")
async def delete_recipe_stage(stage_id: int, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    row = (await db.execute(
        delete(RecipeStage).where(RecipeStage.id == stage_id).returning(RecipeStage.product_name)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Этап не найден")
    # Снять привязки компонентов к удалённому этапу (FK нет — иначе висячий stage_id).
    await db.execute(update(Recipe).where(Recipe.stage_id == stage_id).values(stage_id=None))
    await _cleanup_if_empty(db, row)
    await db.commit()
    return {"success": True}


@router.get("/recipes/validate/{product_name}")
async def validate_recipe(product_name: str, request: Request):
    """ФАЗА 2: проверка рецептуры перед сохранением/запуском — «как она разложится».
    Возвращает список предупреждений, чтобы технолог видел проблемы в рецептуре, а не
    ловил их на живом заказе. Только чтение, ничего не меняет.
    level: 'error' — рецептура развернётся криво; 'warn' — вероятная ошибка."""
    _perm(request, "recipes.view")
    db = _db(request)
    pn = _norm(product_name)
    stages = (await db.execute(text("""
        SELECT rs.id, rs.stage_name, rs.stage_type, rs.operation_type_id, rs.is_final,
               rs.sort_order, ot.consumes_components, ot.production_type AS op_ptype,
               ot.display_name AS op_name
        FROM recipe_stages rs
        LEFT JOIN operation_types ot ON ot.id = rs.operation_type_id
        WHERE LOWER(TRIM(rs.product_name)) = :pn
        ORDER BY rs.sort_order, rs.id
    """), {"pn": pn})).mappings().all()
    comps = (await db.execute(text("""
        SELECT id, component_name, production_type, source, stage_id
        FROM recipes WHERE LOWER(TRIM(product_name)) = :pn
    """), {"pn": pn})).mappings().all()

    warnings: list[dict] = []
    stage_ids = {s["id"] for s in stages}

    # Неизвестный тип этапа (не сматчился со справочником операций).
    for s in stages:
        if s["operation_type_id"] is None:
            warnings.append({"level": "error", "code": "unknown_stage_type",
                             "message": f"Этап «{s['stage_name']}»: тип «{s['stage_type']}» отсутствует в справочнике операций.",
                             "stage_id": s["id"]})

    # Висячая привязка компонента к несуществующему этапу.
    for c in comps:
        if c["stage_id"] is not None and c["stage_id"] not in stage_ids:
            warnings.append({"level": "error", "code": "dangling_stage_id",
                             "message": f"Компонент «{c['component_name']}» привязан к несуществующему этапу.",
                             "recipe_id": c["id"]})

    # Есть компоненты, но нет этапов — маршрут не задан. Дальше пер-компонентные
    # проверки не имеют смысла (иначе предупреждение на КАЖДЫЙ компонент).
    if comps and not stages:
        warnings.append({"level": "warn", "code": "no_stages",
                         "message": "У изделия есть компоненты, но не задан ни один этап маршрута."})
        return {"product_name": product_name,
                "ok": not any(w["level"] == "error" for w in warnings),
                "stage_count": 0, "component_count": len(comps), "warnings": warnings}

    # Матчинг компонент→этап — та же логика, что при РЕАЛЬНОЙ разложке заказа
    # (orders.py::_component_matches_stage): явный stage_id; source='product'→сборка;
    # заданный production_type→по справочнику операций (op_ptype); пустой тип (легаси)
    # →source-эвристика. Иначе валидатор ложно ругался бы на старые рецептуры, которые
    # в заказе разложатся нормально.
    _SRC_MAP = {
        "smd": ("warehouse", "smd"),
        "assembly": ("warehouse", "smd", "3d_print", "purchase", "case"),
        "assembly_rea": ("warehouse", "smd", "3d_print", "purchase", "case"),
        "3d_print": ("3d_print", "purchase"),
        "engraving": ("warehouse", "engraving"),
        "warehouse": ("warehouse",),
    }

    def _matches(c, s) -> bool:
        if c["stage_id"] is not None:
            return c["stage_id"] == s["id"]
        if c["source"] == "product":
            return s["stage_type"] in ("assembly", "assembly_rea")
        if c["production_type"]:
            return c["production_type"] == s["op_ptype"]
        return (c["source"] or "warehouse") in _SRC_MAP.get(s["stage_type"], ("warehouse",))

    # Компонент, который не попадёт ни на один этап (даже эвристикой).
    orphan_comp = False
    for c in comps:
        if c["stage_id"] is not None and c["stage_id"] not in stage_ids:
            continue  # уже отмечен как dangling выше
        if not any(_matches(c, s) for s in stages):
            orphan_comp = True
            warnings.append({"level": "warn", "code": "component_without_stage",
                             "message": f"Компонент «{c['component_name']}» не попадёт ни на один этап "
                                        f"(тип «{c['production_type'] or '—'}» / источник «{c['source']}»).",
                             "recipe_id": c["id"]})

    # Потребляющий этап без компонентов. Учитываем фолбэк «все непривязанные →
    # на потребляющий этап»: если есть компонент-сирота, он туда упадёт, поэтому
    # предупреждаем только когда сирот нет (этап реально останется пустым).
    if not orphan_comp:
        for s in stages:
            if s["consumes_components"] and not any(_matches(c, s) for c in comps):
                warnings.append({"level": "warn", "code": "stage_without_components",
                                 "message": f"Этап «{s['stage_name']}» должен брать компоненты, но к нему ничего не привязано.",
                                 "stage_id": s["id"]})

    # Финальный этап (выпускает готовое изделие): должен быть ровно один.
    if stages:
        finals = [s for s in stages if s["is_final"]]
        if not finals:
            max_sort = max((s["sort_order"] or 0) for s in stages)
            tail = [s for s in stages if (s["sort_order"] or 0) == max_sort]
            if len(tail) > 1:
                warnings.append({"level": "warn", "code": "ambiguous_final",
                                 "message": "Финальный этап не отмечен явно, а по порядку их несколько — "
                                            "непонятно, какой выпускает готовое изделие."})
        elif len(finals) > 1:
            warnings.append({"level": "warn", "code": "multiple_final",
                             "message": "Отмечено больше одного финального этапа — готовая продукция задвоится."})

    has_error = any(w["level"] == "error" for w in warnings)
    return {"product_name": product_name, "ok": not has_error,
            "stage_count": len(stages), "component_count": len(comps),
            "warnings": warnings}


# ── Finished goods ────────────────────────────────────────────────────────────

@router.get("/recipes/finished-goods")
async def list_finished_goods(request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    # available_qty = произведено − отгружено (отгрузка не уменьшает good_qty в БД,
    # поэтому считаем доступный остаток на чтении — идемпотентно, без расхождений).
    rows = (await db.execute(text("""
        SELECT fg.*, COALESCE(s.shipped, 0) AS shipped_qty,
               GREATEST(COALESCE(fg.good_qty,0) - COALESCE(s.shipped,0), 0) AS available_qty
        FROM finished_goods fg
        LEFT JOIN (
            SELECT LOWER(TRIM(product_name)) AS pn, SUM(COALESCE(shipped_qty,0)) AS shipped
            FROM otk_batches GROUP BY LOWER(TRIM(product_name))
        ) s ON s.pn = LOWER(TRIM(fg.product_name))
        ORDER BY LOWER(fg.product_name)
    """))).mappings().all()
    return [dict(r) for r in rows]


@router.post("/recipes/finished-goods", status_code=201)
async def create_finished_good(request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    body = await request.json()
    gq = body.get("good_qty", 0)
    dq = body.get("defect_qty", 0)
    tq = body.get("total_qty", 0)
    stmt = (
        pg_insert(FinishedGoods)
        .values(product_name=body["product_name"], good_qty=gq, defect_qty=dq, total_qty=tq)
        .on_conflict_do_update(
            index_elements=["product_name"],
            set_={
                "good_qty": FinishedGoods.good_qty + gq,
                "defect_qty": FinishedGoods.defect_qty + dq,
                "total_qty": FinishedGoods.total_qty + tq,
                "updated_at": func.now(),
            }
        )
        .returning(FinishedGoods)
    )
    row = (await db.execute(stmt)).mappings().one()
    await db.commit()
    return dict(row)


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: int, request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    rows = (await db.execute(text("""
        SELECT r.*, COALESCE(w.stock, 0) as stock_on_warehouse
        FROM recipes r
        LEFT JOIN warehouse_components w
          ON LOWER(TRIM(COALESCE(NULLIF(TRIM(r.warehouse_component_name),''), r.component_name))) = LOWER(TRIM(w.name))
        WHERE r.id=:id
    """), {"id": recipe_id})).mappings().one_or_none()
    if not rows:
        raise HTTPException(404, "Рецепт не найден")
    return dict(rows)


@router.post("/recipes", status_code=201)
async def create_recipe(body: RecipeCreate, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    # Само-ссылка в BOM запрещена (простейший цикл A←A); защищает рекурсивную развёртку.
    if _norm(body.component_name) == _norm(body.product_name):
        raise HTTPException(400, "Компонент не может совпадать с изделием (само-ссылка в BOM)")
    side = body.board_side.upper() if body.board_side and body.board_side.upper() in ("TOP", "BOTTOM") else None
    # Upsert БЕЗ зависимости от ON CONFLICT: на recipes нет уникального ключа, поэтому
    # ON CONFLICT DO NOTHING не срабатывал и каждый POST плодил дубль → задвоение BOM.
    # Сначала пробуем обновить существующий рецепт (без учёта регистра), иначе вставляем.
    # stage_id НЕ трогаем, если не прислан (Excel-реимпорт/массовое создание не должны
    # стирать явные привязки компонент→этап). Сброс привязки — через PUT /recipes/{id}.
    await _ensure_in_catalog(db, body.product_name)
    pid = await _resolve_product_id(db, body.product_name)   # ФАЗА 1/2: связь по id, а не по тексту имени
    upd_vals = dict(norm=body.norm, source=body.source or "warehouse",
                    product_id=pid,
                    warehouse_component_name=body.warehouse_component_name,
                    designator=body.designator, board_side=side,
                    component_size=body.component_size, updated_at=func.now())
    if body.stage_id is not None:
        upd_vals["stage_id"] = body.stage_id
    upd = (
        update(Recipe)
        .where(func.lower(Recipe.component_name) == _norm(body.component_name),
               func.lower(Recipe.product_name) == _norm(body.product_name),
               Recipe.production_type == body.production_type)
        .values(**upd_vals)
        .returning(Recipe)
    )
    row = (await db.execute(upd)).mappings().first()
    if not row:
        ins = (
            pg_insert(Recipe)
            .values(component_name=body.component_name.strip(), product_name=body.product_name.strip(),
                    norm=body.norm, production_type=body.production_type,
                    source=body.source or "warehouse",
                    product_id=pid,
                    stage_id=body.stage_id,
                    warehouse_component_name=body.warehouse_component_name,
                    designator=body.designator, board_side=side, component_size=body.component_size)
            .returning(Recipe)
        )
        row = (await db.execute(ins)).mappings().one_or_none()
    await db.commit()
    return dict(row) if row else {}


@router.put("/recipes/{recipe_id}")
async def update_recipe(recipe_id: int, body: RecipeUpdate, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    if _norm(body.component_name) == _norm(body.product_name):
        raise HTTPException(400, "Компонент не может совпадать с изделием (само-ссылка в BOM)")
    side = body.board_side.upper() if body.board_side and body.board_side.upper() in ("TOP", "BOTTOM") else None
    stmt = (
        update(Recipe)
        .where(Recipe.id == recipe_id)
        .values(component_name=body.component_name.strip(), product_name=body.product_name.strip(),
                norm=body.norm, production_type=body.production_type,
                source=body.source or "warehouse",
                stage_id=body.stage_id,
                warehouse_component_name=body.warehouse_component_name,
                designator=body.designator, board_side=side,
                component_size=body.component_size, updated_at=func.now())
        .returning(Recipe)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row:
        raise HTTPException(404, "Рецепт не найден")
    await db.commit()
    return dict(row)


@router.post("/recipes/product/delete")
async def delete_product_full(request: Request):
    """Полностью удалить изделие: компоненты, этапы, корпуса, вложения,
    производственный реестр и запись каталога."""
    _perm(request, "recipes.edit")
    db = _db(request)
    body = await request.json()
    name = (body.get("product_name") or "").strip()
    if not name:
        raise HTTPException(400, "Не указано изделие")
    pn = name.lower()
    deleted = {}
    targets = [
        ("recipes", Recipe, Recipe.product_name),
        ("stages", RecipeStage, RecipeStage.product_name),
        ("cases", RecipeCase, RecipeCase.product_name),
        ("attachments", RecipeAttachment, RecipeAttachment.product_name),
        ("registry", RecipeProductOrder, RecipeProductOrder.product_name),
        ("catalog", ProductCatalog, ProductCatalog.name),
    ]
    for label, model, col in targets:
        res = await db.execute(delete(model).where(func.lower(func.trim(col)) == pn))
        deleted[label] = res.rowcount
    await db.commit()
    return {"success": True, "product_name": name, "deleted": deleted}


@router.post("/recipes/product/rename")
async def rename_product_full(request: Request):
    """Переименовать изделие целиком: каскадно обновить product_name во всех таблицах,
    где идентичность изделия хранится строкой (FK нет). Это единственный корректный
    способ переименования — PATCH /catalog имя больше не меняет (иначе рецептура осиротеет)."""
    _perm(request, "recipes.edit")
    db = _db(request)
    body = await request.json()
    old = (body.get("old_name") or "").strip()
    new = (body.get("new_name") or "").strip()
    if not old or not new:
        raise HTTPException(400, "Нужны old_name и new_name")
    if _norm(old) == _norm(new):
        return {"success": True, "old_name": old, "new_name": new, "updated": {}}
    old_n, new_n = _norm(old), _norm(new)
    # Коллизия: новое имя не должно уже принадлежать ДРУГОМУ изделию в каталоге.
    clash = (await db.execute(
        select(func.count()).select_from(ProductCatalog)
        .where(func.lower(func.trim(ProductCatalog.name)) == new_n)
    )).scalar() or 0
    if clash:
        raise HTTPException(409, f"Изделие «{new}» уже существует")
    updated = {}
    # Неуникальные по имени таблицы — простое обновление.
    plain = [
        ("recipes", Recipe, Recipe.product_name),
        ("stages", RecipeStage, RecipeStage.product_name),
        ("cases", RecipeCase, RecipeCase.product_name),
        ("attachments", RecipeAttachment, RecipeAttachment.product_name),
    ]
    for label, model, col in plain:
        res = await db.execute(
            update(model).where(func.lower(func.trim(col)) == old_n).values({col.key: new})
        )
        updated[label] = res.rowcount
    # Уникальные по имени таблицы — на всякий случай снести возможный «осиротевший»
    # дубликат нового имени, затем переименовать (защита от UNIQUE-violation → 500).
    for label, model, col in [
        ("registry", RecipeProductOrder, RecipeProductOrder.product_name),
        ("finished", FinishedGoods, FinishedGoods.product_name),
        ("catalog", ProductCatalog, ProductCatalog.name),
    ]:
        await db.execute(delete(model).where(func.lower(func.trim(col)) == new_n))
        res = await db.execute(
            update(model).where(func.lower(func.trim(col)) == old_n).values({col.key: new})
        )
        updated[label] = res.rowcount
    await db.commit()
    return {"success": True, "old_name": old, "new_name": new, "updated": updated}


@router.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: int, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    stmt = delete(Recipe).where(Recipe.id == recipe_id).returning(Recipe.product_name)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Рецепт не найден")
    await _cleanup_if_empty(db, row)
    await db.commit()
    return {"success": True}


# ── Attachments ───────────────────────────────────────────────────────────────

@router.get("/recipes/attachments/by-product/{product_name}")
async def attachments_by_product(product_name: str, request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    result = await db.execute(
        select(RecipeAttachment)
        .where(func.lower(func.trim(RecipeAttachment.product_name)) == product_name.strip().lower())
        .order_by(RecipeAttachment.attachment_type, RecipeAttachment.created_at)
    )
    return [_m(r) for r in result.scalars().all()]


@router.delete("/recipes/attachments/{att_id}")
async def delete_attachment(att_id: int, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    result = await db.execute(
        select(RecipeAttachment.file_path).where(RecipeAttachment.id == att_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Вложение не найдено")
    await db.execute(delete(RecipeAttachment).where(RecipeAttachment.id == att_id))
    await db.commit()
    return {"success": True}


# ── Planning ──────────────────────────────────────────────────────────────────

@router.get("/planning")
async def list_planning(request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    try:
        result = await db.execute(
            select(Planning).order_by(Planning.created_at.desc())
        )
        return [_m(r) for r in result.scalars().all()]
    except Exception:
        logger.exception("Запрос списка не выполнен")
        return []


# ── Product Catalog ────────────────────────────────────────────────────────────

@router.get("/catalog")
async def list_catalog(
    request: Request,
    q: Optional[str] = None,
    category: Optional[str] = None,
    active_only: bool = False,
):
    _user(request)
    db = _db(request)
    stmt = select(ProductCatalog).order_by(ProductCatalog.name)
    if q:
        stmt = stmt.where(ProductCatalog.name.ilike(f"%{q}%"))
    if category:
        stmt = stmt.where(ProductCatalog.category == category)
    if active_only:
        stmt = stmt.where(ProductCatalog.is_active == True)
    rows = (await db.execute(stmt)).scalars().all()
    return [_m(r) for r in rows]


@router.post("/catalog")
async def create_catalog_item(request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Название обязательно")
    existing = (await db.execute(select(ProductCatalog).where(ProductCatalog.name == name))).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "Изделие с таким названием уже есть в каталоге")
    item = ProductCatalog(
        name=name,
        sku=body.get("sku"),
        category=body.get("category"),
        description=body.get("description"),
        unit=body.get("unit", "шт"),
        is_active=body.get("is_active", True),
        needs_smd=body.get("needs_smd", True),
        is_receiver=body.get("is_receiver", False),
        needs_assembly=body.get("needs_assembly", True),
    )
    db.add(item)
    await db.flush()
    # Каталог → Рецептура: регистрируем изделие в производственном реестре,
    # чтобы оно сразу было доступно при построении рецептуры.
    await _ensure_in_recipe_registry(db, name)
    return _m(item)


@router.patch("/catalog/{item_id}")
async def update_catalog_item(item_id: int, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(ProductCatalog).where(ProductCatalog.id == item_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Не найдено")
    # ВНИМАНИЕ: name здесь НЕ меняется — переименование только через
    # POST /recipes/product/rename (каскад по всем name-keyed таблицам).
    allowed = ["sku", "category", "description", "unit", "is_active",
               "needs_smd", "is_receiver", "needs_assembly"]
    for k in allowed:
        if k in body:
            setattr(item, k, body[k])
    await db.flush()
    await db.refresh(item)  # onupdate updated_at — во избежание implicit-IO при сериализации
    return _m(item)


@router.delete("/catalog/{item_id}")
async def delete_catalog_item(item_id: int, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    item = (await db.execute(select(ProductCatalog).where(ProductCatalog.id == item_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Не найдено")
    # Не удаляем изделие из каталога, пока у него есть рецептура/этапы/корпуса —
    # иначе остаются «осиротевшие» строки. Полное удаление — через /recipes/product/delete.
    pn = _norm(item.name)
    deps = (await db.execute(text("""
        SELECT (SELECT COUNT(*) FROM recipes WHERE LOWER(TRIM(product_name))=:pn)
             + (SELECT COUNT(*) FROM recipe_stages WHERE LOWER(TRIM(product_name))=:pn)
             + (SELECT COUNT(*) FROM recipe_cases WHERE LOWER(TRIM(product_name))=:pn)
    """), {"pn": pn})).scalar() or 0
    if deps:
        raise HTTPException(409, "У изделия есть рецептура/этапы/корпуса — используйте полное удаление изделия")
    await db.delete(item)
    await db.commit()
    return {"ok": True}


@router.get("/catalog/categories")
async def list_catalog_categories(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(
        select(ProductCatalog.category).where(ProductCatalog.category.isnot(None)).distinct()
    )).scalars().all()
    return sorted([r for r in rows if r])
