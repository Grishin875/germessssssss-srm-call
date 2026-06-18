"""
Order status machine — mirrors orderStatusManager.js logic.

Order statuses:
  Создан → В работе → Готов к проверке ОТК → На проверке ОТК → Завершен | Отменен

Batch statuses:
  Запланировано → Запущена → На паузе → Готов к проверке ОТК → Завершена | Отменена
"""
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func

from app.models.business import Order, ProductionBatch, ProductionDailyProgress
from shared.core.order_status import update_order_status


async def auto_update_order_status(db: AsyncSession, order_id: int) -> bool:
    """Тонкая обёртка над единой статус-машиной (shared.core.order_status)."""
    return await update_order_status(db, order_id)


async def check_and_create_assembly(db: AsyncSession, order_id: int, product_name: str) -> dict | None:
    """
    After primary OTK passes, create an assembly (Сборка) batch if recipe exists
    and no assembly batch exists yet.
    """
    from sqlalchemy import text
    recipe_check = (await db.execute(text("""
        SELECT COUNT(*) FROM recipes
        WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(:pn)) AND production_type = 'Сборка'
    """), {"pn": product_name})).scalar_one()

    if not recipe_check:
        return None

    result = await db.execute(
        select(ProductionBatch.batch_id).where(
            ProductionBatch.order_id == order_id,
            ProductionBatch.production_type == "Сборка"
        ).limit(1)
    )
    if result.scalar_one_or_none():
        return None

    order = (await db.execute(
        select(Order.planned_qty).where(Order.id == order_id)
    )).one_or_none()
    if not order:
        return None

    qty = order.planned_qty
    date_part = datetime.utcnow().strftime("%y%m%d")
    base_id = f"P{date_part}-SB000"
    batch_id = base_id
    suffix = 1
    while (await db.execute(
        select(ProductionBatch.batch_id).where(ProductionBatch.batch_id == batch_id)
    )).scalar_one_or_none():
        batch_id = f"{base_id}-{suffix}"
        suffix += 1

    batch = ProductionBatch(
        batch_id=batch_id, product_name=product_name,
        production_type="Сборка", planned_qty=qty,
        status="Запланировано", order_id=order_id
    )
    db.add(batch)
    return {"assemblyBatchId": batch_id, "qty": qty}
