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


async def create_crm_order(db: AsyncSession, product_name: str, planned_qty: int,
                            deadline: Optional[str], comment: Optional[str]) -> int:
    """Создаёт заказ в CRM и возвращает его ID."""
    from sqlalchemy import text
    row = (await db.execute(text("""
        INSERT INTO orders (product_name, planned_qty, status, priority, deadline, comment)
        VALUES (:pn, :qty, 'Создан', 'Обычный', :dl, :cm)
        RETURNING id
    """), {"pn": product_name, "qty": planned_qty, "dl": deadline, "cm": comment})).scalar_one()
    return row


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
