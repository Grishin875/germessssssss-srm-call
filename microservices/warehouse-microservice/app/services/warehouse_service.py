import time, random, string
from typing import List, Optional, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func, text

from app.models.warehouse import (
    WarehouseComponent, Operation, ProductionStock, Case,
    Warehouse, WarehouseStock, DEFAULT_WAREHOUSES, WAREHOUSE_TYPE_LABELS,
    Supplier, PurchaseRequest, PurchaseRequestItem, PURCHASE_STATUSES, PURCHASE_STATUS_LABELS,
    ComponentRequest, COMPONENT_REQUEST_STATUS_LABELS,
)
from app.schemas.warehouse import (
    ComponentCreate, ComponentUpdate, BatchOperationRequest, CaseCreate, CaseUpdate,
    ReserveForOrderRequest, WarehouseCreate, WarehouseUpdate, WarehouseOut,
    WarehouseStockOut, StockTransferRequest,
    SupplierCreate, SupplierUpdate, PurchaseRequestCreate, PurchaseRequestUpdate,
    FromShortageRequest, ComponentRequestCreate,
)

WAREHOUSE_OP_TYPES = ["RECEIVE", "WRITEOFF", "CREATE", "UPDATE", "DELETE", "CANCEL", "TRANSFER",
                      "RESERVE", "RESERVE_RELEASE"]


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
        c.reserved_qty = _to_float(c.reserved)
        c.available = c.stock - c.reserved_qty
        c.min_stock = _to_float(c.min_stock) if c.min_stock else None
        c.units_per_reel = _to_float(c.units_per_reel) if c.units_per_reel else None
        c.block = c.block or "СМД"
    return items


async def get_component_by_name(db: AsyncSession, name: str) -> Optional[WarehouseComponent]:
    c = await _get_by_name(db, name)
    if c:
        c.stock = _to_float(c.stock)
        c.reserved_qty = _to_float(c.reserved)
        c.available = c.stock - c.reserved_qty
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
        c.reserved_qty = _to_float(c.reserved)
        c.available = _to_float(c.stock) - c.reserved_qty
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
    comp.reserved_qty = _to_float(comp.reserved)
    comp.available = _to_float(comp.stock) - comp.reserved_qty
    return comp


async def update_component(db: AsyncSession, comp_id: int, data: ComponentUpdate) -> WarehouseComponent:
    comp = await get_component_by_id(db, comp_id)
    if not comp:
        raise ValueError("Компонент не найден")
    old_name = comp.name.strip()
    new_name = data.name.strip()
    # None = не трогаем остаток (правка прочих полей не должна обнулять склад).
    reserved = _to_float(comp.reserved)
    new_stock = _to_float(comp.stock) if data.stock is None else _to_float(data.stock)
    # Инвариант 0 <= reserved <= stock: нельзя опустить остаток ниже зарезервированного.
    if new_stock < reserved:
        raise ValueError(f"Нельзя установить остаток {new_stock} ниже зарезервированного {reserved}")
    await db.execute(
        update(WarehouseComponent).where(WarehouseComponent.id == comp_id).values(
            name=new_name, stock=new_stock, category=data.category or "Разное",
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
        # warehouse_stock (по-складские остатки) тоже переименовываем, иначе мульти-
        # складской баланс задвоится под старым/новым именем. uq(warehouse_id, component_name)
        # обходим слиянием количеств в уже существующую строку нового имени.
        p = {"new_name": new_name, "old_name": old_name}
        await db.execute(text(
            "UPDATE warehouse_stock w SET quantity = w.quantity + o.quantity, "
            "reserved = COALESCE(w.reserved,0) + COALESCE(o.reserved,0) "
            "FROM warehouse_stock o "
            "WHERE o.warehouse_id = w.warehouse_id "
            "AND LOWER(TRIM(o.component_name)) = LOWER(:old_name) AND w.component_name = :new_name"), p)
        await db.execute(text(
            "DELETE FROM warehouse_stock o WHERE LOWER(TRIM(o.component_name)) = LOWER(:old_name) "
            "AND EXISTS (SELECT 1 FROM warehouse_stock w WHERE w.warehouse_id = o.warehouse_id "
            "AND w.component_name = :new_name)"), p)
        await db.execute(text(
            "UPDATE warehouse_stock SET component_name = :new_name "
            "WHERE LOWER(TRIM(component_name)) = LOWER(:old_name)"), p)
    await _log_op(db, "UPDATE", new_name, new_stock, f"Обновление. Категория: {data.category}")
    await db.commit()
    c = await get_component_by_id(db, comp_id)
    c.reserved_qty = _to_float(c.reserved)
    c.available = _to_float(c.stock) - c.reserved_qty
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
            # Атомарное списание: гард (stock - reserved) >= qty внутри UPDATE,
            # чтобы исключить гонку и не списать ЗАРЕЗЕРВИРОВАННЫЙ под заказы остаток
            # (иначе ломается инвариант 0 <= reserved <= stock). Как в issue_component_request.
            res = await db.execute(
                text(
                    "UPDATE warehouse_components SET stock = COALESCE(stock,0) - :qty "
                    "WHERE LOWER(TRIM(name)) = :n AND COALESCE(stock,0) - COALESCE(reserved,0) >= :qty"
                ),
                {"qty": item.qty, "n": _norm(item.name)},
            )
            if res.rowcount == 0:
                available = _to_float(comp.stock) - _to_float(comp.reserved)
                raise ValueError(
                    f"Недостаточно доступного остатка для \"{item.name}\" (с учётом брони). "
                    f"Доступно: {available}, запрошено: {item.qty}"
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
    # Журналируем изменение остатка корпуса (для аудита/сверки, как у компонентов).
    await _log_op(db, "CASE_RECEIVE" if delta > 0 else "CASE_WRITEOFF", c.name, abs(delta),
                  note or f"Корректировка остатка корпуса {c.name}: {delta:+d}")
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
    """Проверка целостности складских остатков и резервов.

    Инвариант: 0 <= reserved <= stock (и stock не отрицателен).

    Чинятся ТОЛЬКО однозначные аномалии (даже при fix=True):
      * stock  < 0          → 0 (логируется корректирующая RECEIVE);
      * reserved < 0        → 0 (явный мусор, легитимной брони быть не может).

    Случай reserved > stock НЕ обрезается молча — это может быть легитимная
    бронь под активные заказы (ORDER-RESERVE без CONSUME/RETURN), и обрезка
    убила бы реальный резерв. Такая аномалия только логируется и попадает в
    отчёт с флагом needs_manual_review. Исключение: если по компоненту НЕТ ни
    одной активной операции RESERVE (т.е. бронь явно «висит» без основания),
    тогда reserved безопасно обрезается до stock.
    """
    rows = (await db.execute(select(WarehouseComponent))).scalars().all()

    anomalies = []
    corrected = 0
    manual_review = 0
    for c in rows:
        stock = _to_float(c.stock)
        reserved = _to_float(c.reserved)

        new_stock = max(0.0, stock)          # stock < 0 → 0
        new_reserved = reserved
        needs_manual_review = False

        if reserved < 0:
            new_reserved = 0.0               # явный мусор
        elif reserved > new_stock:
            # Потенциально легитимная бронь — не режем молча.
            has_active_reserve = (await db.execute(
                select(Operation.id).where(
                    Operation.operation_type == "RESERVE",
                    func.lower(Operation.component_name) == _norm(c.name),
                ).limit(1)
            )).scalar_one_or_none() is not None
            if has_active_reserve:
                needs_manual_review = True    # оставляем reserved как есть
            else:
                new_reserved = new_stock      # брони нет — безопасно обрезаем

        if (abs(new_stock - stock) < 1e-9
                and abs(new_reserved - reserved) < 1e-9
                and not needs_manual_review):
            continue

        entry = {
            "component_name": c.name,
            "stock": stock, "reserved": reserved,
            "new_stock": new_stock, "new_reserved": new_reserved,
            "needs_manual_review": needs_manual_review,
            "fixed": False,
        }

        if needs_manual_review:
            # Только лог для ручного разбора, состояние не трогаем.
            manual_review += 1
            if fix:
                await _log_op(
                    db, "RESERVE", c.name, reserved - new_stock,
                    "АНОМАЛИЯ verify-reservations: reserved > stock при активной броне, "
                    "требуется ручной разбор (не обрезаем)",
                    op_id=_op_id("VERIFY-RESERVE-ANOMALY"),
                )
            anomalies.append(entry)
            continue

        if fix:
            await db.execute(
                update(WarehouseComponent)
                .where(WarehouseComponent.id == c.id)
                .values(stock=new_stock, reserved=new_reserved)
            )
            if abs(new_stock - stock) > 1e-9:
                await _log_op(
                    db, "RECEIVE", c.name, new_stock - stock,
                    "Корректировка отрицательного остатка (verify-reservations)",
                    op_id=_op_id("FIX-NEGSTOCK"),
                )
            entry["fixed"] = True
            corrected += 1
        anomalies.append(entry)

    if fix and (corrected or manual_review):
        await db.commit()

    return {
        "success": True,
        "message": (
            f"Исправлено аномалий: {corrected}, требует ручного разбора: {manual_review}"
            if fix else
            f"Найдено аномалий: {len(anomalies)} (из них на ручной разбор: {manual_review})"
        ),
        "checked": "reserved_within_stock",
        "anomalies_count": len(anomalies),
        "corrected_count": corrected,
        "manual_review_count": manual_review,
        "corrections": anomalies,
    }


# ── Warehouses (мультисклад) ──────────────────────────────────────────────────

async def seed_warehouses(db: AsyncSession):
    """Завести дефолтные склады, если их ещё нет (вызывается при старте)."""
    existing = (await db.execute(select(func.count()).select_from(Warehouse))).scalar_one()
    if existing:
        return
    for w in DEFAULT_WAREHOUSES:
        db.add(Warehouse(code=w["code"], name=w["name"], warehouse_type=w["warehouse_type"], is_active=True))
    await db.commit()


async def _main_warehouse_id(db: AsyncSession) -> Optional[int]:
    r = await db.execute(
        select(Warehouse.id).where(Warehouse.warehouse_type == "main").order_by(Warehouse.id).limit(1)
    )
    mid = r.scalar_one_or_none()
    if mid is None:
        r = await db.execute(select(Warehouse.id).order_by(Warehouse.id).limit(1))
        mid = r.scalar_one_or_none()
    return mid


async def reconcile_stock(db: AsyncSession):
    """Поддерживает инвариант: сумма остатков по складам == warehouse_components.stock.
    Разницу (новые компоненты, изменения через batch/reserve) относит на Основной склад."""
    main_id = await _main_warehouse_id(db)
    if main_id is None:
        return

    comps = (await db.execute(select(WarehouseComponent.name, WarehouseComponent.stock))).all()
    sums = (await db.execute(
        select(WarehouseStock.component_name, func.coalesce(func.sum(WarehouseStock.quantity), 0))
        .group_by(WarehouseStock.component_name)
    )).all()
    # Ключи нормализуем (LOWER+TRIM): иначе строки с разным регистром/пробелами
    # не сматчатся и остаток задвоится (diff посчитается от нуля).
    sum_map = {_norm(name): _to_float(s) for name, s in sums}

    # Все строки складских остатков по компонентам — нужны, чтобы разносить
    # недостачу (отрицательный diff) по складам с остатком, а не топить Основной в минус.
    all_rows = (await db.execute(select(WarehouseStock))).scalars().all()
    rows_by_name: dict = {}
    for r in all_rows:
        rows_by_name.setdefault(_norm(r.component_name), []).append(r)
    main_by_name = {_norm(r.component_name): r for r in all_rows if r.warehouse_id == main_id}

    changed = False
    for name, stock in comps:
        total = _to_float(stock)
        diff = total - sum_map.get(_norm(name), 0.0)
        if abs(diff) < 1e-9:
            continue

        if diff > 0:
            # Излишек относим на Основной склад (как и раньше).
            row = main_by_name.get(_norm(name))
            if row:
                await db.execute(
                    update(WarehouseStock).where(WarehouseStock.id == row.id)
                    .values(quantity=_to_float(row.quantity) + diff)
                )
            else:
                db.add(WarehouseStock(warehouse_id=main_id, component_name=name, quantity=diff))
            changed = True
            continue

        # diff < 0: общий stock уменьшился — нужно списать недостачу со складов,
        # не опуская ни одну строку ниже 0. Сначала с Основного, затем с остальных.
        shortage = -diff
        rows = rows_by_name.get(_norm(name), [])
        rows_sorted = sorted(rows, key=lambda r: (r.warehouse_id != main_id, r.warehouse_id))
        for r in rows_sorted:
            if shortage <= 1e-9:
                break
            qty = _to_float(r.quantity)
            if qty <= 0:
                continue
            take = min(qty, shortage)
            await db.execute(
                update(WarehouseStock).where(WarehouseStock.id == r.id)
                .values(quantity=func.greatest(qty - take, 0))
            )
            shortage -= take
            changed = True

        if shortage > 1e-9:
            # Остатков по складам не хватило для покрытия недостачи —
            # аномалия (рассинхрон). Логируем для ручного разбора; в минус не уходим.
            main_row = main_by_name.get(_norm(name))
            if main_row is None:
                main_row = next(iter(rows_sorted), None)
            if main_row is not None:
                await db.execute(
                    update(WarehouseStock).where(WarehouseStock.id == main_row.id)
                    .values(quantity=func.greatest(WarehouseStock.quantity, 0))
                )
            await _log_op(
                db, "WRITEOFF", name, shortage,
                "АНОМАЛИЯ reconcile_stock: недостача превышает остатки по складам, "
                "требуется ручной разбор (в минус не уводим)",
                op_id=_op_id("RECONCILE-ANOMALY"),
            )
            changed = True
    if changed:
        await db.commit()


async def list_warehouses(db: AsyncSession, include_inactive: bool = False) -> List[WarehouseOut]:
    await reconcile_stock(db)
    q = select(Warehouse).order_by(Warehouse.id)
    if not include_inactive:
        q = q.where(Warehouse.is_active.is_(True))
    whs = (await db.execute(q)).scalars().all()

    agg = (await db.execute(
        select(WarehouseStock.warehouse_id, func.count(), func.coalesce(func.sum(WarehouseStock.quantity), 0))
        .where(WarehouseStock.quantity != 0)
        .group_by(WarehouseStock.warehouse_id)
    )).all()
    agg_map = {wid: (cnt, _to_float(s)) for wid, cnt, s in agg}

    out = []
    for w in whs:
        cnt, total = agg_map.get(w.id, (0, 0.0))
        out.append(WarehouseOut(
            id=w.id, code=w.code, name=w.name, warehouse_type=w.warehouse_type,
            type_label=WAREHOUSE_TYPE_LABELS.get(w.warehouse_type, w.warehouse_type),
            address=w.address, is_active=bool(w.is_active),
            positions_count=cnt, total_quantity=total,
        ))
    return out


async def get_warehouse_by_id(db: AsyncSession, wid: int) -> Optional[Warehouse]:
    r = await db.execute(select(Warehouse).where(Warehouse.id == wid))
    return r.scalar_one_or_none()


async def create_warehouse(db: AsyncSession, data: WarehouseCreate) -> WarehouseOut:
    if not data.code.strip() or not data.name.strip():
        raise ValueError("Код и название склада обязательны")
    dup = await db.execute(select(Warehouse).where(func.lower(Warehouse.code) == _norm(data.code)))
    if dup.scalar_one_or_none():
        raise ValueError(f"Склад с кодом '{data.code}' уже существует")
    w = Warehouse(
        code=data.code.strip(), name=data.name.strip(),
        warehouse_type=data.warehouse_type or "main",
        address=data.address, is_active=data.is_active,
    )
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return WarehouseOut(
        id=w.id, code=w.code, name=w.name, warehouse_type=w.warehouse_type,
        type_label=WAREHOUSE_TYPE_LABELS.get(w.warehouse_type, w.warehouse_type),
        address=w.address, is_active=bool(w.is_active),
    )


async def update_warehouse(db: AsyncSession, wid: int, data: WarehouseUpdate) -> WarehouseOut:
    w = await get_warehouse_by_id(db, wid)
    if not w:
        raise ValueError("Склад не найден")
    vals = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None or k == "address"}
    if "code" in vals and vals["code"]:
        dup = await db.execute(
            select(Warehouse).where(func.lower(Warehouse.code) == _norm(vals["code"]), Warehouse.id != wid)
        )
        if dup.scalar_one_or_none():
            raise ValueError(f"Склад с кодом '{vals['code']}' уже существует")
    if vals:
        await db.execute(update(Warehouse).where(Warehouse.id == wid).values(**vals))
        await db.commit()
    w = await get_warehouse_by_id(db, wid)
    return WarehouseOut(
        id=w.id, code=w.code, name=w.name, warehouse_type=w.warehouse_type,
        type_label=WAREHOUSE_TYPE_LABELS.get(w.warehouse_type, w.warehouse_type),
        address=w.address, is_active=bool(w.is_active),
    )


async def delete_warehouse(db: AsyncSession, wid: int):
    w = await get_warehouse_by_id(db, wid)
    if not w:
        raise ValueError("Склад не найден")
    if w.warehouse_type == "main":
        raise ValueError("Нельзя удалить Основной склад")
    has = (await db.execute(
        select(func.coalesce(func.sum(WarehouseStock.quantity), 0)).where(WarehouseStock.warehouse_id == wid)
    )).scalar_one()
    if _to_float(has) != 0:
        raise ValueError("Склад не пуст — перенесите остатки перед удалением")
    await db.execute(delete(WarehouseStock).where(WarehouseStock.warehouse_id == wid))
    await db.execute(delete(Warehouse).where(Warehouse.id == wid))
    await db.commit()


async def get_warehouse_stock(db: AsyncSession, wid: int) -> List[WarehouseStockOut]:
    await reconcile_stock(db)
    w = await get_warehouse_by_id(db, wid)
    if not w:
        raise ValueError("Склад не найден")
    rows = (await db.execute(
        select(WarehouseStock)
        .where(WarehouseStock.warehouse_id == wid, WarehouseStock.quantity != 0)
        .order_by(func.lower(WarehouseStock.component_name))
    )).scalars().all()
    return [
        WarehouseStockOut(
            warehouse_id=wid, warehouse_name=w.name, warehouse_type=w.warehouse_type,
            component_name=r.component_name, quantity=_to_float(r.quantity),
            reserved=_to_float(r.reserved), available=_to_float(r.quantity) - _to_float(r.reserved),
        ) for r in rows
    ]


async def get_component_distribution(db: AsyncSession, component_name: str) -> List[WarehouseStockOut]:
    """Распределение одного компонента по всем складам."""
    await reconcile_stock(db)
    whs = {w.id: w for w in (await db.execute(select(Warehouse).where(Warehouse.is_active.is_(True)))).scalars().all()}
    rows = (await db.execute(
        select(WarehouseStock).where(func.lower(WarehouseStock.component_name) == _norm(component_name))
    )).scalars().all()
    out = []
    for r in rows:
        w = whs.get(r.warehouse_id)
        if not w:
            continue
        out.append(WarehouseStockOut(
            warehouse_id=r.warehouse_id, warehouse_name=w.name, warehouse_type=w.warehouse_type,
            component_name=r.component_name, quantity=_to_float(r.quantity),
            reserved=_to_float(r.reserved), available=_to_float(r.quantity) - _to_float(r.reserved),
        ))
    out.sort(key=lambda x: x.warehouse_id)
    return out


async def transfer_stock(db: AsyncSession, data: StockTransferRequest) -> dict:
    """Перемещение компонента между складами. Общий остаток не меняется."""
    if data.quantity <= 0:
        raise ValueError("Количество должно быть больше нуля")
    if data.from_warehouse_id == data.to_warehouse_id:
        raise ValueError("Склад-источник и склад-получатель совпадают")
    src_w = await get_warehouse_by_id(db, data.from_warehouse_id)
    dst_w = await get_warehouse_by_id(db, data.to_warehouse_id)
    if not src_w or not dst_w:
        raise ValueError("Склад не найден")

    await reconcile_stock(db)

    src = (await db.execute(
        select(WarehouseStock).where(
            WarehouseStock.warehouse_id == data.from_warehouse_id,
            func.lower(WarehouseStock.component_name) == _norm(data.component_name),
        )
    )).scalar_one_or_none()

    # Резерв учитывается на уровне компонента (warehouse_components.reserved),
    # а WarehouseStock.reserved по складам сейчас всегда 0 — поэтому считать
    # доступное как quantity - src.reserved нельзя (можно увести зарезервированное).
    # Минимально-безопасный вариант: общий резерв компонента должен оставаться
    # физически обеспеченным где-то на складах. На источнике обязаны остаться
    # минимум те единицы резерва, которые не могут быть покрыты остальными складами:
    #   reserve_to_hold_at_source = max(0, total_reserved - stock_on_other_warehouses)
    # Перемещать можно не больше, чем quantity_src - reserve_to_hold_at_source.
    comp = await _get_by_name(db, data.component_name)
    total_reserved = _to_float(comp.reserved) if comp else 0.0

    src_qty = _to_float(src.quantity) if src else 0.0
    other_sum = (await db.execute(
        select(func.coalesce(func.sum(WarehouseStock.quantity), 0)).where(
            func.lower(WarehouseStock.component_name) == _norm(data.component_name),
            WarehouseStock.warehouse_id != data.from_warehouse_id,
        )
    )).scalar_one()
    other_sum = _to_float(other_sum)

    reserve_to_hold_at_source = max(0.0, total_reserved - other_sum)
    avail = max(0.0, src_qty - reserve_to_hold_at_source)
    if avail < data.quantity:
        raise ValueError(
            f"Недостаточно доступного '{data.component_name}' на складе «{src_w.name}» "
            f"с учётом брони: доступно к переносу {avail}, запрошено {data.quantity}"
        )

    await db.execute(
        update(WarehouseStock).where(WarehouseStock.id == src.id)
        .values(quantity=_to_float(src.quantity) - data.quantity)
    )

    dst = (await db.execute(
        select(WarehouseStock).where(
            WarehouseStock.warehouse_id == data.to_warehouse_id,
            func.lower(WarehouseStock.component_name) == _norm(data.component_name),
        )
    )).scalar_one_or_none()
    if dst:
        await db.execute(
            update(WarehouseStock).where(WarehouseStock.id == dst.id)
            .values(quantity=_to_float(dst.quantity) + data.quantity)
        )
    else:
        # Каноническое имя из warehouse_components — чтобы строки не расходились по
        # регистру между складами (иначе reconcile/uq могут задвоить остаток).
        canon_name = (comp.name if comp else (src.component_name if src else data.component_name))
        db.add(WarehouseStock(
            warehouse_id=data.to_warehouse_id,
            component_name=canon_name,
            quantity=data.quantity,
        ))

    note = f"Перемещение: {src_w.name} → {dst_w.name}"
    if data.note:
        note += f". {data.note}"
    await _log_op(db, "TRANSFER", data.component_name, data.quantity, note, op_id=_op_id("TRANSFER"))

    await db.commit()
    return {
        "success": True,
        "component_name": data.component_name,
        "quantity": data.quantity,
        "from": src_w.name,
        "to": dst_w.name,
    }


async def reserve_for_order(db: AsyncSession, data: ReserveForOrderRequest) -> dict:
    """
    Резервирует складские компоненты под заказ: reserved += qty.
    Остаток stock НЕ списывается (списание происходит при отгрузке/закрытии).
    Идемпотентно: повторный вызов с тем же order_id будет отклонён.
    """
    op_prefix = f"ORDER-RESERVE-{data.order_id}"
    # Проверяем, не было ли уже резервирования для этого заказа.
    # Разделитель '-' обязателен: без него LIKE 'ORDER-RESERVE-1%' ловил бы и
    # заказы 10, 15, 100… (id пишутся как f"{op_prefix}-{idx}") и блокировал чужие резервы.
    existing = await db.execute(
        select(Operation).where(Operation.operation_id.like(f"{op_prefix}-%")).limit(1)
    )
    if existing.scalar_one_or_none():
        raise ValueError(f"Компоненты для заказа #{data.order_id} уже были зарезервированы")

    # Сначала проверяем доступность всего: available = stock - COALESCE(reserved,0)
    for idx, item in enumerate(data.items):
        if _to_float(item.quantity) <= 0:
            raise ValueError(f"Количество для '{item.component_name}' должно быть > 0")
        comp = await _get_by_name(db, item.component_name)
        if not comp:
            raise ValueError(f"Компонент не найден: '{item.component_name}'")
        available = _to_float(comp.stock) - _to_float(comp.reserved)
        if available < item.quantity:
            raise ValueError(
                f"Недостаточно '{item.component_name}': "
                f"нужно {item.quantity}, доступно {available}"
            )

    # Всё есть — резервируем (reserved += qty) с guard'ом на доступность
    for idx, item in enumerate(data.items):
        res = await db.execute(
            update(WarehouseComponent)
            .where(
                func.lower(WarehouseComponent.name) == _norm(item.component_name),
                (WarehouseComponent.stock - func.coalesce(WarehouseComponent.reserved, 0)) >= item.quantity,
            )
            .values(reserved=func.coalesce(WarehouseComponent.reserved, 0) + item.quantity)
        )
        if res.rowcount == 0:
            raise ValueError(
                f"Недостаточно '{item.component_name}' для резервирования "
                f"(нужно {item.quantity})"
            )
        await _log_op(
            db, "RESERVE", item.component_name, item.quantity,
            f"Резервирование под заказ #{data.order_id} / {data.product_name}",
            op_id=f"{op_prefix}-{idx}",
        )

    await db.commit()
    return {"success": True, "order_id": data.order_id, "reserved_count": len(data.items)}


# ── Закупка (procurement) ─────────────────────────────────────────────────────

async def list_suppliers(db: AsyncSession, include_inactive: bool = False) -> List[dict]:
    q = select(Supplier).order_by(func.lower(Supplier.name))
    if not include_inactive:
        q = q.where(Supplier.is_active.is_(True))
    rows = (await db.execute(q)).scalars().all()
    return [{
        "id": s.id, "name": s.name, "contact": s.contact, "phone": s.phone,
        "email": s.email, "note": s.note, "is_active": bool(s.is_active),
    } for s in rows]


async def create_supplier(db: AsyncSession, data: SupplierCreate) -> dict:
    if not data.name.strip():
        raise ValueError("Название поставщика обязательно")
    dup = (await db.execute(
        select(Supplier).where(func.lower(Supplier.name) == _norm(data.name))
    )).scalar_one_or_none()
    if dup:
        raise ValueError(f"Поставщик «{data.name}» уже существует")
    s = Supplier(
        name=data.name.strip(), contact=data.contact, phone=data.phone,
        email=data.email, note=data.note, is_active=data.is_active,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return {"id": s.id, "name": s.name, "contact": s.contact, "phone": s.phone,
            "email": s.email, "note": s.note, "is_active": bool(s.is_active)}


async def update_supplier(db: AsyncSession, sid: int, data: SupplierUpdate) -> dict:
    s = (await db.execute(select(Supplier).where(Supplier.id == sid))).scalar_one_or_none()
    if not s:
        raise ValueError("Поставщик не найден")
    vals = data.model_dump(exclude_unset=True)
    if vals.get("name"):
        dup = (await db.execute(
            select(Supplier).where(func.lower(Supplier.name) == _norm(vals["name"]), Supplier.id != sid)
        )).scalar_one_or_none()
        if dup:
            raise ValueError(f"Поставщик «{vals['name']}» уже существует")
    if vals:
        await db.execute(update(Supplier).where(Supplier.id == sid).values(**vals))
        await db.commit()
    s = (await db.execute(select(Supplier).where(Supplier.id == sid))).scalar_one()
    return {"id": s.id, "name": s.name, "contact": s.contact, "phone": s.phone,
            "email": s.email, "note": s.note, "is_active": bool(s.is_active)}


async def delete_supplier(db: AsyncSession, sid: int):
    s = (await db.execute(select(Supplier).where(Supplier.id == sid))).scalar_one_or_none()
    if not s:
        raise ValueError("Поставщик не найден")
    await db.execute(update(Supplier).where(Supplier.id == sid).values(is_active=False))
    await db.commit()


async def _pr_to_out(db: AsyncSession, pr: PurchaseRequest) -> dict:
    items = (await db.execute(
        select(PurchaseRequestItem).where(PurchaseRequestItem.request_id == pr.id).order_by(PurchaseRequestItem.id)
    )).scalars().all()
    supplier_name = None
    if pr.supplier_id:
        supplier_name = (await db.execute(
            select(Supplier.name).where(Supplier.id == pr.supplier_id)
        )).scalar_one_or_none()
    item_out = []
    total_qty = 0.0
    total_cost = 0.0
    for it in items:
        qty = _to_float(it.quantity)
        price = _to_float(it.unit_price) if it.unit_price is not None else None
        total_qty += qty
        if price:
            total_cost += qty * price
        item_out.append({
            "id": it.id, "component_name": it.component_name, "quantity": qty,
            "received_qty": _to_float(it.received_qty), "unit_price": price, "note": it.note,
        })
    return {
        "id": pr.id, "supplier_id": pr.supplier_id, "supplier_name": supplier_name,
        "status": pr.status, "status_label": PURCHASE_STATUS_LABELS.get(pr.status, pr.status),
        "note": pr.note, "order_ref": pr.order_ref, "created_by": pr.created_by,
        "created_at": pr.created_at, "items": item_out,
        "total_qty": round(total_qty, 3), "total_cost": round(total_cost, 2),
    }


async def list_purchase_requests(db: AsyncSession, status: str = None) -> List[dict]:
    q = select(PurchaseRequest).order_by(PurchaseRequest.id.desc())
    if status:
        q = q.where(PurchaseRequest.status == status)
    prs = (await db.execute(q)).scalars().all()
    return [await _pr_to_out(db, pr) for pr in prs]


async def get_purchase_request(db: AsyncSession, pid: int) -> dict:
    pr = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == pid))).scalar_one_or_none()
    if not pr:
        raise ValueError("Заявка не найдена")
    return await _pr_to_out(db, pr)


async def create_purchase_request(db: AsyncSession, data: PurchaseRequestCreate, created_by: str = None) -> dict:
    pr = PurchaseRequest(
        supplier_id=data.supplier_id, status="draft",
        note=data.note, order_ref=data.order_ref, created_by=created_by,
    )
    db.add(pr)
    await db.flush()
    for it in data.items:
        if not it.component_name.strip():
            continue
        db.add(PurchaseRequestItem(
            request_id=pr.id, component_name=it.component_name.strip(),
            quantity=it.quantity, unit_price=it.unit_price, note=it.note,
        ))
    await db.commit()
    await db.refresh(pr)
    return await _pr_to_out(db, pr)


async def _receive_into_stock(db: AsyncSession, pr: PurchaseRequest):
    """Оприходовать все позиции заявки на склад.
    Идемпотентно по стабильному operation_id PR-{pr.id}-ITEM-{item.id}
    (привязан к id позиции, а не к порядковому индексу — устойчив к изменению
    состава/порядка позиций заявки)."""
    items = (await db.execute(
        select(PurchaseRequestItem).where(PurchaseRequestItem.request_id == pr.id).order_by(PurchaseRequestItem.id)
    )).scalars().all()
    for it in items:
        qty = _to_float(it.quantity)
        if qty <= 0:
            continue
        op_id = f"PR-{pr.id}-ITEM-{it.id}"
        exists = (await db.execute(
            select(Operation.id).where(Operation.operation_id == op_id)
        )).scalar_one_or_none()
        if exists:
            continue
        comp = await _get_by_name(db, it.component_name)
        if comp:
            await db.execute(
                update(WarehouseComponent)
                .where(func.lower(WarehouseComponent.name) == _norm(it.component_name))
                .values(stock=WarehouseComponent.stock + qty)
            )
        else:
            db.add(WarehouseComponent(name=it.component_name.strip(), stock=qty, source="purchase"))
        await db.execute(
            update(PurchaseRequestItem).where(PurchaseRequestItem.id == it.id)
            .values(received_qty=qty)
        )
        await _log_op(
            db, "RECEIVE", it.component_name, qty,
            f"Приёмка по заявке закупки #{pr.id}", op_id=op_id,
        )


async def update_purchase_request(db: AsyncSession, pid: int, data: PurchaseRequestUpdate) -> dict:
    pr = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == pid))).scalar_one_or_none()
    if not pr:
        raise ValueError("Заявка не найдена")
    if pr.status == "received":
        raise ValueError("Полученную заявку нельзя редактировать")

    new_status = data.status
    if new_status and new_status not in PURCHASE_STATUSES:
        raise ValueError(f"Недопустимый статус: {new_status}")
    # Отменённую заявку нельзя оприходовать (как в receive_purchase_request).
    if new_status == "received" and pr.status == "cancelled":
        raise ValueError("Отменённую заявку нельзя оприходовать")

    # Замена позиций (только пока не получено)
    if data.items is not None:
        await db.execute(delete(PurchaseRequestItem).where(PurchaseRequestItem.request_id == pid))
        for it in data.items:
            if not it.component_name.strip():
                continue
            db.add(PurchaseRequestItem(
                request_id=pid, component_name=it.component_name.strip(),
                quantity=it.quantity, unit_price=it.unit_price, note=it.note,
            ))
        await db.flush()

    vals = {}
    for k in ("supplier_id", "note", "order_ref"):
        v = getattr(data, k)
        if v is not None:
            vals[k] = v
    if new_status:
        vals["status"] = new_status

    # Переход в «получено» — оприходовать на склад
    if new_status == "received":
        await _receive_into_stock(db, pr)

    if vals:
        await db.execute(update(PurchaseRequest).where(PurchaseRequest.id == pid).values(**vals))
    await db.commit()

    if new_status == "received":
        await reconcile_stock(db)

    pr = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == pid))).scalar_one()
    return await _pr_to_out(db, pr)


async def receive_purchase_request(db: AsyncSession, pid: int) -> dict:
    pr = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == pid))).scalar_one_or_none()
    if not pr:
        raise ValueError("Заявка не найдена")
    if pr.status == "received":
        raise ValueError("Заявка уже получена")
    if pr.status == "cancelled":
        raise ValueError("Заявка отменена")
    await _receive_into_stock(db, pr)
    await db.execute(update(PurchaseRequest).where(PurchaseRequest.id == pid).values(status="received"))
    await db.commit()
    await reconcile_stock(db)
    pr = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == pid))).scalar_one()
    return await _pr_to_out(db, pr)


async def delete_purchase_request(db: AsyncSession, pid: int):
    pr = (await db.execute(select(PurchaseRequest).where(PurchaseRequest.id == pid))).scalar_one_or_none()
    if not pr:
        raise ValueError("Заявка не найдена")
    if pr.status == "received":
        raise ValueError("Полученную заявку нельзя удалить")
    await db.execute(delete(PurchaseRequestItem).where(PurchaseRequestItem.request_id == pid))
    await db.execute(delete(PurchaseRequest).where(PurchaseRequest.id == pid))
    await db.commit()


async def create_from_shortage(db: AsyncSession, data: FromShortageRequest, created_by: str = None) -> dict:
    items = [it for it in data.items if it.component_name.strip() and it.quantity > 0]
    if not items:
        raise ValueError("Нет позиций с дефицитом для заявки")
    pr = PurchaseRequest(
        supplier_id=data.supplier_id, status="draft",
        note=data.note or "Авто-заявка по дефициту", order_ref=data.order_ref, created_by=created_by,
    )
    db.add(pr)
    await db.flush()
    for it in items:
        db.add(PurchaseRequestItem(
            request_id=pr.id, component_name=it.component_name.strip(), quantity=it.quantity,
        ))
    await db.commit()
    await db.refresh(pr)
    return await _pr_to_out(db, pr)


# ── Заявки на компоненты (брак / дозапрос) ────────────────────────────────────

def _cr_to_out(cr: ComponentRequest) -> dict:
    return {
        "id": cr.id,
        "order_id": cr.order_id,
        "stage_id": cr.stage_id,
        "component_name": cr.component_name,
        "qty": _to_float(cr.qty),
        "reason": cr.reason,
        "status": cr.status,
        "status_label": COMPONENT_REQUEST_STATUS_LABELS.get(cr.status, cr.status),
        "requested_by": cr.requested_by,
        "requested_by_name": cr.requested_by_name,
        "issued_by": cr.issued_by,
        "issued_by_name": cr.issued_by_name,
        "comment": cr.comment,
        "created_at": cr.created_at,
        "updated_at": cr.updated_at,
    }


async def create_component_request(db: AsyncSession, data: ComponentRequestCreate,
                                   user_id: int = None, user_name: str = None) -> dict:
    if not data.component_name.strip():
        raise ValueError("Название компонента обязательно")
    cr = ComponentRequest(
        order_id=data.order_id,
        stage_id=data.stage_id,
        component_name=data.component_name.strip(),
        qty=data.qty,
        reason=data.reason or "брак",
        status="pending",
        requested_by=user_id,
        requested_by_name=user_name,
        comment=data.comment,
    )
    db.add(cr)
    await db.commit()
    await db.refresh(cr)
    return _cr_to_out(cr)


async def list_component_requests(db: AsyncSession, status: str = None) -> List[dict]:
    q = select(ComponentRequest).order_by(ComponentRequest.id.desc())
    if status:
        q = q.where(ComponentRequest.status == status)
    rows = (await db.execute(q)).scalars().all()
    return [_cr_to_out(cr) for cr in rows]


async def issue_component_request(db: AsyncSession, req_id: int,
                                  user_id: int = None, user_name: str = None) -> dict:
    cr = (await db.execute(
        select(ComponentRequest).where(ComponentRequest.id == req_id)
    )).scalar_one_or_none()
    if not cr:
        raise ValueError("Заявка не найдена")
    if cr.status == "issued":
        raise ValueError("Заявка уже выдана")
    qty = _to_float(cr.qty)
    # Отрицательная/нулевая выдача недопустима: иначе UPDATE stock - (-q) надувал
    # бы остаток. Перепроверяем и сохранённое значение (старые заявки до фикса схемы).
    if qty <= 0:
        raise ValueError("Количество в заявке должно быть > 0")
    # Атомарно списываем доступный остаток со склада с учётом брони:
    # available = stock - reserved. Гард внутри UPDATE исключает уход available в минус.
    res = await db.execute(
        text(
            "UPDATE warehouse_components SET stock = COALESCE(stock,0) - :qty "
            "WHERE LOWER(TRIM(name)) = :n "
            "AND COALESCE(stock,0) - COALESCE(reserved,0) >= :qty"
        ),
        {"qty": qty, "n": _norm(cr.component_name)},
    )
    if res.rowcount == 0:
        raise PermissionError("Недостаточно доступного на складе (с учётом брони)")
    await _log_op(
        db, "WRITEOFF", cr.component_name, qty,
        f"Выдача по заявке #{cr.id} (причина: {cr.reason})",
        operator_id=str(user_id) if user_id is not None else None,
        op_id=f"COMPREQ-{cr.id}",
    )
    await db.execute(
        update(ComponentRequest).where(ComponentRequest.id == req_id).values(
            status="issued", issued_by=user_id, issued_by_name=user_name,
        )
    )
    await db.commit()
    cr = (await db.execute(
        select(ComponentRequest).where(ComponentRequest.id == req_id)
    )).scalar_one()
    return _cr_to_out(cr)


async def reject_component_request(db: AsyncSession, req_id: int) -> dict:
    cr = (await db.execute(
        select(ComponentRequest).where(ComponentRequest.id == req_id)
    )).scalar_one_or_none()
    if not cr:
        raise ValueError("Заявка не найдена")
    if cr.status != "pending":
        raise ValueError("Отклонить можно только заявку в статусе 'ожидает'")
    await db.execute(
        update(ComponentRequest).where(ComponentRequest.id == req_id).values(status="rejected")
    )
    await db.commit()
    cr = (await db.execute(
        select(ComponentRequest).where(ComponentRequest.id == req_id)
    )).scalar_one()
    return _cr_to_out(cr)
