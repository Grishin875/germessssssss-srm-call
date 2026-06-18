import logging
from typing import Optional, List
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, delete, func, text, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.products import Recipe, RecipeProductOrder, RecipeAttachment, FinishedGoods, Planning, RecipeCase, RecipeStage, ProductCatalog
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
    stock_result = await db.execute(text("SELECT name, stock FROM warehouse_components"))
    stock_map = {_norm(r["name"]): float(r["stock"] or 0) for r in stock_result.mappings().all()}

    all_recipes = (await db.execute(select(Recipe))).scalars().all()

    demand: dict = {}
    for entry in body.plan:
        if not entry.product or entry.qty <= 0:
            continue
        pn = _norm(entry.product)
        for rec in all_recipes:
            if _norm(rec.product_name) != pn:
                continue
            wname = (rec.warehouse_component_name or "").strip() or rec.component_name
            key = _norm(wname)
            demand.setdefault(key, {"component": wname, "total": 0})
            demand[key]["total"] += float(rec.norm) * entry.qty

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
    """
    _perm(request, "recipes.view")
    db = _db(request)
    body = await request.json()
    product_name = body.get("product_name", "")
    planned_qty = int(body.get("planned_qty", 0))
    production_type = body.get("production_type")

    if not product_name or not planned_qty:
        raise HTTPException(400, "product_name и planned_qty обязательны")

    q = select(Recipe).where(func.lower(Recipe.product_name) == _norm(product_name))
    if production_type:
        q = q.where(Recipe.production_type == production_type)

    recipes = (await db.execute(q)).scalars().all()
    if not recipes:
        return {"canProduce": False, "message": "Рецептура не найдена", "components": [], "by_department": {}}

    # Берём актуальные остатки из warehouse_components
    stock_rows = (await db.execute(text(
        "SELECT name, stock FROM warehouse_components"
    ))).mappings().all()
    stock_map = {_norm(r["name"]): float(r["stock"] or 0) for r in stock_rows}

    components = []
    can_produce = True
    by_department: dict = {}  # production_type -> list of components

    for rec in recipes:
        wname = (rec.warehouse_component_name or "").strip() or rec.component_name
        avail = stock_map.get(_norm(wname), 0)
        norm = float(rec.norm)
        required = norm * planned_qty
        shortage = max(0, required - avail)
        source = rec.source or "warehouse"

        # Нехватку считаем только для warehouse-компонентов
        if source == "warehouse" and shortage > 0:
            can_produce = False

        entry = {
            "component_name": wname,
            "production_type": rec.production_type or "SMD",
            "source": source,
            "norm": norm,
            "required": required,
            "available": avail,
            "shortage": shortage if source == "warehouse" else 0,
            "canProduce": shortage == 0 or source != "warehouse",
        }
        components.append(entry)

        dept = rec.production_type or "SMD"
        by_department.setdefault(dept, []).append(entry)

    return {
        "canProduce": can_produce,
        "components": components,
        "by_department": by_department,
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
    stage = RecipeStage(
        product_name=body.product_name.strip(),
        stage_name=body.stage_name.strip(),
        stage_type=body.stage_type or "assembly",
        sort_order=body.sort_order,
        description=body.description,
        instructions=body.instructions,
        required_role=body.required_role,
        depends_on_previous=body.depends_on_previous,
        transfer_qty=body.transfer_qty,
    )
    db.add(stage)
    await db.flush()
    await db.refresh(stage)
    await _ensure_in_catalog(db, body.product_name)
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
    vals = body.model_dump(exclude_none=True)
    if not vals:
        raise HTTPException(400, "Нет данных для обновления")
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
    await _cleanup_if_empty(db, row)
    await db.commit()
    return {"success": True}


# ── Finished goods ────────────────────────────────────────────────────────────

@router.get("/recipes/finished-goods")
async def list_finished_goods(request: Request):
    _perm(request, "recipes.view")
    db = _db(request)
    result = await db.execute(
        select(FinishedGoods).order_by(func.lower(FinishedGoods.product_name))
    )
    return [_m(r) for r in result.scalars().all()]


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
    side = body.board_side.upper() if body.board_side and body.board_side.upper() in ("TOP", "BOTTOM") else None
    stmt = (
        pg_insert(Recipe)
        .values(component_name=body.component_name.strip(), product_name=body.product_name.strip(),
                norm=body.norm, production_type=body.production_type,
                source=body.source or "warehouse",
                warehouse_component_name=body.warehouse_component_name,
                designator=body.designator, board_side=side, component_size=body.component_size)
        .on_conflict_do_nothing()
        .returning(Recipe)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()

    if not row:
        # update existing
        upd = (
            update(Recipe)
            .where(func.lower(Recipe.component_name) == _norm(body.component_name),
                   func.lower(Recipe.product_name) == _norm(body.product_name),
                   Recipe.production_type == body.production_type)
            .values(norm=body.norm, source=body.source or "warehouse",
                    warehouse_component_name=body.warehouse_component_name,
                    designator=body.designator, board_side=side,
                    component_size=body.component_size, updated_at=func.now())
            .returning(Recipe)
        )
        row = (await db.execute(upd)).mappings().one_or_none()
    await _ensure_in_catalog(db, body.product_name)
    await db.commit()
    return dict(row) if row else {}


@router.put("/recipes/{recipe_id}")
async def update_recipe(recipe_id: int, body: RecipeUpdate, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    side = body.board_side.upper() if body.board_side and body.board_side.upper() in ("TOP", "BOTTOM") else None
    stmt = (
        update(Recipe)
        .where(Recipe.id == recipe_id)
        .values(component_name=body.component_name.strip(), product_name=body.product_name.strip(),
                norm=body.norm, production_type=body.production_type,
                source=body.source or "warehouse",
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
    allowed = ["name", "sku", "category", "description", "unit", "is_active"]
    for k in allowed:
        if k in body:
            setattr(item, k, body[k])
    await db.flush()
    return _m(item)


@router.delete("/catalog/{item_id}")
async def delete_catalog_item(item_id: int, request: Request):
    _perm(request, "recipes.edit")
    db = _db(request)
    item = (await db.execute(select(ProductCatalog).where(ProductCatalog.id == item_id))).scalar_one_or_none()
    if not item:
        raise HTTPException(404, "Не найдено")
    await db.delete(item)
    return {"ok": True}


@router.get("/catalog/categories")
async def list_catalog_categories(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(
        select(ProductCatalog.category).where(ProductCatalog.category.isnot(None)).distinct()
    )).scalars().all()
    return sorted([r for r in rows if r])
