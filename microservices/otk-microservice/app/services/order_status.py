"""Order status updater for OTK service — делегирует в единую статус-машину."""
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.order_status import update_order_status


async def auto_update_order_status(db: AsyncSession, order_id: int):
    """Тонкая обёртка над единой статус-машиной (shared.core.order_status)."""
    await update_order_status(db, order_id)
