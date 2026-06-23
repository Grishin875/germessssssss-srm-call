"""
Сервис маппинга номенклатуры 1С ↔ product_name CRM.
Хранит маппинг в таблице integration_nomenclature_mapping.
"""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.shareholder import IntegrationNomenclatureMapping, IntegrationOrder


async def ensure_tables(db: AsyncSession):
    """Tables are managed via Alembic migrations - this is a no-op kept for compatibility."""
    pass


async def resolve_product_name(db: AsyncSession, onec_code: str, onec_name: str) -> str:
    """Возвращает crm_product_name по коду 1С, или onec_name если маппинг не найден."""
    result = await db.execute(
        select(IntegrationNomenclatureMapping.crm_product_name)
        .where(IntegrationNomenclatureMapping.onec_code == onec_code)
    )
    row = result.scalar_one_or_none()
    return row or onec_name


async def upsert_mapping(db: AsyncSession, onec_code: str, onec_name: str, crm_product_name: str):
    stmt = (
        pg_insert(IntegrationNomenclatureMapping)
        .values(onec_code=onec_code, onec_name=onec_name, crm_product_name=crm_product_name)
        .on_conflict_do_update(
            index_elements=["onec_code"],
            set_={"onec_name": onec_name, "crm_product_name": crm_product_name,
                  "updated_at": func.now()}
        )
    )
    await db.execute(stmt)


async def create_crm_order(db: AsyncSession, positions: "list[dict]",
                            deadline: Optional[str], comment: Optional[str]) -> int:
    """Создаёт заказ в CRM (шапка + N позиций) и возвращает его ID.

    positions — список словарей {product_name, qty}. Шапка заказа получает
    product_name = имя первой позиции, planned_qty = сумма qty по всем позициям
    (для обратной совместимости отображения). Для каждой позиции создаётся
    строка order_items. Эти заказы из вебхуков НЕ генерируют этапы/партии/резерв —
    только шапка + позиции.
    """
    from sqlalchemy import text

    norm_positions = []
    for p in positions:
        pn = (p.get("product_name") or "").strip()
        qty = int(p.get("qty") or 0)
        if not pn or qty <= 0:
            continue
        norm_positions.append({"product_name": pn, "qty": qty})
    if not norm_positions:
        raise ValueError("Нет валидных позиций для создания заказа")

    header_name = norm_positions[0]["product_name"]
    total_qty = sum(p["qty"] for p in norm_positions)

    order_id = (await db.execute(text("""
        INSERT INTO orders (product_name, planned_qty, status, priority, deadline, comment)
        VALUES (:pn, :qty, 'Создан', 'Обычный', :dl, :cm)
        RETURNING id
    """), {"pn": header_name, "qty": total_qty, "dl": deadline, "cm": comment})).scalar_one()

    for i, p in enumerate(norm_positions):
        await db.execute(text("""
            INSERT INTO order_items (order_id, product_name, planned_qty, actual_qty, status, sort_order)
            VALUES (:oid, :pn, :qty, 0, 'Создан', :so)
        """), {"oid": order_id, "pn": p["product_name"], "qty": p["qty"], "so": i})

    return order_id


async def register_integration_order(db: AsyncSession, source: str, external_id: str,
                                      crm_order_id: int, raw_payload: dict):
    stmt = (
        pg_insert(IntegrationOrder)
        .values(source=source, external_id=external_id,
                crm_order_id=crm_order_id, raw_payload=raw_payload, status="created")
        .on_conflict_do_update(
            constraint="uq_integration_order",
            set_={"crm_order_id": crm_order_id, "status": "created",
                  "updated_at": func.now()}
        )
    )
    await db.execute(stmt)
