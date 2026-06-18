import time, random, string
from typing import List, Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func, text

from app.models.warehouse import WarehouseComponent, Operation, ProductionStock, Case
from app.schemas.warehouse import ComponentCreate, ComponentUpdate, BatchOperationRequest, CaseCreate, CaseUpdate, ReserveForOrderRequest

WAREHOUSE_OP_TYPES = ["RECEIVE", "WRITEOFF", "CREATE", "UPDATE", "DELETE", "CANCEL"]


def _norm(s: str) -> str:
    return s.strip().lower()


def _op_id(prefix: str) -> str:
    return f"{prefix}-{int(time.time()*1000)}-{''.join(random.choices(string.ascii_lowercase, k=6))}"


def _to_float(v) -> float:
    return float(v) if v is not None else 0.0


async def _get_by_name(db: AsyncSession, name: str) -> Optional[WarehouseComponent]:
    r = await db.execute(
        select(WarehouseComponent).where(func.lower(WarehouseComponent.name) == _norm(name))
    )
    return r.scalar_one_or_none()


async def list_components(db: AsyncSession) -> List[WarehouseComponent]:
    r = await db.execute(select(WarehouseComponent).order_by(func.lower(WarehouseComponent.name)))
    items = r.scalars().all()
    for c in items:
        c.stock = _to_float(c.stock)
        c.available = _to_float(c.stock)
        c.reserved_qty = 0.0
        c.min_stock = _to_float(c.min_stock) if c.min_stock else None
        c.units_per_reel = _to_float(c.units_per_reel) if c.units_per_reel else None
        c.block = c.block or "СМД"
    return items


async def get_component_by_name(db: AsyncSession, name: str) -> Optional[WarehouseComponent]:
    c = await _get_by_name(db, name)
    if c:
        c.stock = _to_float(c.stock)
        c.available = _to_float(c.stock)
        c.reserved_qty = 0.0
    return c


async def get_component_by_id(db: AsyncSession, comp_id: int) -> Optional[WarehouseComponent]:
    r = await db.execute(select(WarehouseComponent).where(WarehouseComponent.id == comp_id))
    return r.scalar_one_or_none()


async def create_component(db: AsyncSession, data: ComponentCreate) -> WarehouseComponent:
    if not data.name.strip():
        raise ValueError("Название компонента обязательно")
    existing = await _get_by_name(db, data.name)
    if existing:
        # upsert: add stock
        await db.execute(
            update(WarehouseComponent)
            .where(func.lower(WarehouseComponent.name) == _norm(data.name))
            .values(stock=WarehouseComponent.stock + (data.stock or 0), category=data.category, unit=data.unit,
                    comment=data.comment, units_per_reel=data.units_per_reel,
                    block=(data.block or "СМД"), package_type=data.package_type,
                    size=data.size, capacitance=data.capacitance, voltage=data.voltage, tolerance=data.tolerance,
                    **({} if data.min_stock is None else {"min_stock": data.min_stock}))
        )
        await _log_op(db, "CREATE", data.name, data.stock or 0, f"Категория: {data.category}")
        await db.commit()
        c = await _get_by_name(db, data.name)
        c.available = _to_float(c.stock)
        c.reserved_qty = 0.0
        return c

    comp = WarehouseComponent(
        name=data.name.strip(), stock=data.stock or 0, category=data.category,
        unit=data.unit, min_stock=data.min_stock, comment=data.comment,
        units_per_reel=data.units_per_reel, block=data.block or "СМД",
        source=data.source or "warehouse",
        package_type=data.package_type, size=data.size, capacitance=data.capacitance,
        voltage=data.voltage, tolerance=data.tolerance,
    )
    db.add(comp)
    await db.flush()
    await _log_op(db, "CREATE", data.name, data.stock or 0, f"Категория: {data.category}")
    await db.commit()
    await db.refresh(comp)
    comp.available = _to_float(comp.stock)
    comp.reserved_qty = 0.0
    return comp


async def update_component(db: AsyncSession, comp_id: int, data: ComponentUpdate) -> WarehouseComponent:
    comp = await get_component_by_id(db, comp_id)
    if not comp:
        raise ValueError("Компонент не найден")
    old_name = comp.name.strip()
    new_name = data.name.strip()
    await db.execute(
        update(WarehouseComponent).where(WarehouseComponent.id == comp_id).values(
            name=new_name, stock=data.stock or 0, category=data.category or "Разное",
            unit=data.unit, min_stock=data.min_stock, comment=data.comment,
            units_per_reel=data.units_per_reel, block=data.block or "СМД",
            source=data.source or "warehouse",
            package_type=data.package_type, size=data.size, capacitance=data.capacitance,
            voltage=data.voltage, tolerance=data.tolerance,
        )
    )
    if old_name.lower() != new_name.lower():
        await db.execute(text("UPDATE recipes SET component_name=:new_name WHERE LOWER(TRIM(component_name))=LOWER(:old_name)"), {"new_name": new_name, "old_name": old_name})
        await db.execute(text("UPDATE production_stock SET component_name=:new_name WHERE LOWER(TRIM(component_name))=LOWER(:old_name)"), {"new_name": new_name, "old_name": old_name})
    await _log_op(db, "UPDATE", new_name, data.stock or 0, f"Обновление. Категория: {data.category}")
    await db.commit()
    c = await get_component_by_id(db, comp_id)
    c.available = _to_float(c.stock)
    c.reserved_qty = 0.0
    return c


async def delete_component(db: AsyncSession, comp_id: int):
    comp = await get_component_by_id(db, comp_id)
    if not comp:
        raise ValueError("Компонент не найден")
    await _log_op(db, "DELETE", comp.name, 0, "Удаление компонента")
    await db.execute(delete(WarehouseComponent).where(WarehouseComponent.id == comp_id))
    await db.commit()


async def batch_operation(db: AsyncSession, data: BatchOperationRequest):
    if data.operationType not in ("incoming", "writeoff"):
        raise ValueError("Неверный тип операции")
    if not data.items:
        raise ValueError("Список компонентов пуст")

    base_id = data.operationId or _op_id(f"BATCH-{data.operationType.upper()}")

    if data.operationId:
        existing = await db.execute(
            select(Operation).where(
                (Operation.operation_id == data.operationId) |
                Operation.operation_id.like(data.operationId + "-%")
            ).limit(1)
        )
        if existing.scalar_one_or_none():
            raise ValueError("⚠️ Эта операция уже выполнена. Повторное списание/оприходование запрещено.")

    log_type = "RECEIVE" if data.operationType == "incoming" else "WRITEOFF"

    for idx, item in enumerate(data.items):
        if data.operationType == "writeoff":
            comp = await _get_by_name(db, item.name)
            if not comp:
                raise ValueError(f"Компонент не найден для списания: \"{item.name}\"")
            current = _to_float(comp.stock)
            if current < item.qty:
                raise ValueError(f"Недостаточно остатка для \"{item.name}\". Доступно: {current}, запрошено: {item.qty}")
            await db.execute(
                update(WarehouseComponent)
                .where(func.lower(WarehouseComponent.name) == _norm(item.name))
                .values(stock=WarehouseComponent.stock - item.qty)
            )
            if data.toProduction:
                await _upsert_production_stock(db, item.name, item.qty, comp.category or item.category or "Разное", comp.block or "СМД")
        else:
            existing_comp = await _get_by_name(db, item.name)
            if existing_comp:
                await db.execute(
                    update(WarehouseComponent)
                    .where(func.lower(WarehouseComponent.name) == _norm(item.name))
                    .values(stock=WarehouseComponent.stock + item.qty)
                )
            else:
                db.add(WarehouseComponent(name=item.name.strip(), stock=item.qty, category=item.category or "Разное"))

        reason_labels = {
            "production": "В запасы производства", "issued": "Выдано сотруднику",
            "defect": "Брак", "expired": "Истёк срок годности",
            "damage": "Повреждение", "other": "Другое",
        }
        note = "Успешно"
        if data.operationType == "writeoff" and data.writeoffReason:
            note = reason_labels.get(data.writeoffReason, data.writeoffReason)
            if data.writeoffComment:
                note += ": " + data.writeoffComment

        await _log_op(db, log_type, item.name, item.qty, note,
                      operator_id=data.employeeId, op_id=f"{base_id}-{idx}",
                      additional_info="Новый компонент" if item.isNew else "")

    await db.commit()
    return {"success": True, "operationId": base_id}


async def _upsert_production_stock(db: AsyncSession, name: str, qty: float, category: str, block: str):
    existing = await db.execute(
        select(ProductionStock).where(func.lower(ProductionStock.component_name) == _norm(name))
    )
    ps = existing.scalar_one_or_none()
    if ps:
        await db.execute(
            update(ProductionStock)
            .where(func.lower(ProductionStock.component_name) == _norm(name))
            .values(quantity=ProductionStock.quantity + qty)
        )
    else:
        db.add(ProductionStock(component_name=name.strip(), quantity=qty, category=category, block=block))


async def _log_op(db: AsyncSession, op_type: str, name: str, qty: float, note: str,
                  operator_id: str = None, op_id: str = None, additional_info: str = ""):
    db.add(Operation(
        operation_type=op_type, component_name=name, quantity=qty, note=note,
        operator_id=operator_id, operation_id=op_id or _op_id(op_type),
        additional_info=additional_info,
    ))


async def list_categories(db: AsyncSession) -> List[str]:
    r = await db.execute(
        select(WarehouseComponent.category)
        .where(WarehouseComponent.category.isnot(None))
        .distinct()
        .order_by(WarehouseComponent.category)
    )
    return [row[0] for row in r.all()]


async def get_inventory(db: AsyncSession) -> dict:
    r = await db.execute(
        select(WarehouseComponent.category, WarehouseComponent.name, WarehouseComponent.stock)
        .order_by(WarehouseComponent.category, func.lower(WarehouseComponent.name))
    )
    inventory: dict = {}
    for cat, name, stock in r.all():
        cat = cat or "Разное"
        inventory.setdefault(cat, []).append({"name": name, "qty": _to_float(stock)})
    return inventory


async def list_operations(db: AsyncSession, limit: int = 100, offset: int = 0,
                          component_name: str = None, operation_type: str = None,
                          date_from: str = None, date_to: str = None) -> Tuple[List[Operation], int]:
    q = select(Operation).where(Operation.operation_type.in_(WAREHOUSE_OP_TYPES))
    if component_name:
        q = q.where(func.lower(Operation.component_name).contains(component_name.lower()))
    if operation_type and operation_type in WAREHOUSE_OP_TYPES:
        q = q.where(Operation.operation_type == operation_type)
    if date_from:
        q = q.where(Operation.operation_date >= date_from)
    if date_to:
        q = q.where(Operation.operation_date <= text("CAST(:dt AS date) + INTERVAL '1 day'").bindparams(dt=date_to))

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.order_by(Operation.operation_date.desc(), Operation.id.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()
    return rows, total


async def list_production_stock(db: AsyncSession) -> List[ProductionStock]:
    r = await db.execute(select(ProductionStock).order_by(func.lower(ProductionStock.component_name)))
    return r.scalars().all()


# ── Cases ─────────────────────────────────────────────────────────────────────

async def list_cases(db: AsyncSession) -> List[Case]:
    r = await db.execute(select(Case).order_by(func.lower(Case.name)))
    return r.scalars().all()


async def get_case_by_id(db: AsyncSession, case_id: int) -> Optional[Case]:
    r = await db.execute(select(Case).where(Case.id == case_id))
    return r.scalar_one_or_none()


async def create_case(db: AsyncSession, data: CaseCreate) -> Case:
    if not data.name.strip():
        raise ValueError("Название корпуса обязательно")
    existing = await db.execute(select(Case).where(func.lower(Case.name) == _norm(data.name)))
    if existing.scalar_one_or_none():
        raise ValueError(f"Корпус с именем '{data.name}' уже существует")
    c = Case(
        name=data.name.strip(), source=data.source or "warehouse",
        stock=data.stock or 0, min_stock=data.min_stock or 0,
        color=data.color, material=data.material, comment=data.comment,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return c


async def update_case(db: AsyncSession, case_id: int, data: CaseUpdate) -> Case:
    c = await get_case_by_id(db, case_id)
    if not c:
        raise ValueError("Корпус не найден")
    await db.execute(
        update(Case).where(Case.id == case_id).values(
            name=data.name.strip(), source=data.source or "warehouse",
            stock=data.stock or 0, min_stock=data.min_stock or 0,
            color=data.color, material=data.material, comment=data.comment,
        )
    )
    await db.commit()
    return await get_case_by_id(db, case_id)


async def delete_case(db: AsyncSession, case_id: int):
    c = await get_case_by_id(db, case_id)
    if not c:
        raise ValueError("Корпус не найден")
    await db.execute(delete(Case).where(Case.id == case_id))
    await db.commit()


async def adjust_case_stock(db: AsyncSession, case_id: int, delta: int, note: str = "") -> Case:
    """Изменить остаток корпуса (delta > 0 = приход, delta < 0 = списание)."""
    c = await get_case_by_id(db, case_id)
    if not c:
        raise ValueError("Корпус не найден")
    new_stock = c.stock + delta
    if new_stock < 0:
        raise ValueError(f"Недостаточно корпусов '{c.name}'. Доступно: {c.stock}, запрошено: {abs(delta)}")
    await db.execute(update(Case).where(Case.id == case_id).values(stock=new_stock))
    await db.commit()
    return await get_case_by_id(db, case_id)


# ── Reserve for order ─────────────────────────────────────────────────────────

async def check_availability(db: AsyncSession, items: List[dict]) -> dict:
    """
    Проверяет наличие компонентов для заказа.
    items: [{"component_name": str, "quantity": float}, ...]
    Возвращает {"can_produce": bool, "missing": [...], "available": [...]}
    """
    missing = []
    available = []
    for item in items:
        name = item["component_name"]
        needed = float(item["quantity"])
        comp = await _get_by_name(db, name)
        stock = _to_float(comp.stock) if comp else 0.0
        shortage = max(0.0, needed - stock)
        entry = {
            "component_name": name,
            "needed": needed,
            "stock": stock,
            "shortage": shortage,
            "ok": shortage == 0,
        }
        if shortage > 0:
            missing.append(entry)
        else:
            available.append(entry)
    return {
        "can_produce": len(missing) == 0,
        "missing": missing,
        "available": available,
        "total_items": len(items),
    }


async def verify_reservations(db: AsyncSession, fix: bool = False) -> dict:
    """Проверка целостности складских остатков.

    В этой системе «резервирование» реализовано как немедленное списание
    (WRITEOFF c operation_id ORDER-RESERVE-…), поэтому отдельного поля
    reserved_qty в БД нет. Реальный инвариант, который имеет смысл
    проверять — отсутствие отрицательных остатков (могут возникнуть при
    ручном редактировании или гонке списаний).

    fix=False — только отчёт об аномалиях.
    fix=True  — отрицательные остатки приводятся к 0 с логированием
                корректирующей операции RECEIVE.
    """
    rows = (await db.execute(
        select(WarehouseComponent).where(WarehouseComponent.stock < 0)
    )).scalars().all()

    anomalies = []
    corrected = 0
    for c in rows:
        before = _to_float(c.stock)
        entry = {"component_name": c.name, "stock": before, "fixed": False}
        if fix:
            delta = -before  # сколько добавить, чтобы выйти в 0
            await db.execute(
                update(WarehouseComponent)
                .where(WarehouseComponent.id == c.id)
                .values(stock=0)
            )
            await _log_op(
                db, "RECEIVE", c.name, delta,
                "Корректировка отрицательного остатка (verify-reservations)",
                op_id=_op_id("FIX-NEGSTOCK"),
            )
            entry["fixed"] = True
            corrected += 1
        anomalies.append(entry)

    if fix and corrected:
        await db.commit()

    return {
        "success": True,
        "message": (
            f"Исправлено отрицательных остатков: {corrected}" if fix
            else f"Найдено аномалий: {len(anomalies)}"
        ),
        "checked": "negative_stock",
        "anomalies_count": len(anomalies),
        "corrected_count": corrected,
        "corrections": anomalies,
    }


async def reserve_for_order(db: AsyncSession, data: ReserveForOrderRequest) -> dict:
    """
    Списывает складские компоненты под заказ.
    Идемпотентно: повторный вызов с тем же order_id будет отклонён.
    """
    op_prefix = f"ORDER-RESERVE-{data.order_id}"
    # Проверяем, не было ли уже резервирования для этого заказа
    existing = await db.execute(
        select(Operation).where(Operation.operation_id.like(f"{op_prefix}%")).limit(1)
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"Компоненты для заказа #{data.order_id} уже были зарезервированы")

    # Сначала проверяем наличие всего
    for idx, item in enumerate(data.items):
        comp = await _get_by_name(db, item.component_name)
        if not comp:
            raise ValueError(f"Компонент не найден: '{item.component_name}'")
        if _to_float(comp.stock) < item.quantity:
            raise ValueError(
                f"Недостаточно '{item.component_name}': "
                f"нужно {item.quantity}, доступно {_to_float(comp.stock)}"
            )

    # Всё есть — списываем
    for idx, item in enumerate(data.items):
        await db.execute(
            update(WarehouseComponent)
            .where(func.lower(WarehouseComponent.name) == _norm(item.component_name))
            .values(stock=WarehouseComponent.stock - item.quantity)
        )
        await _log_op(
            db, "WRITEOFF", item.component_name, item.quantity,
            f"Резервирование под заказ #{data.order_id} / {data.product_name}",
            op_id=f"{op_prefix}-{idx}",
        )

    await db.commit()
    return {"success": True, "order_id": data.order_id, "reserved_count": len(data.items)}
