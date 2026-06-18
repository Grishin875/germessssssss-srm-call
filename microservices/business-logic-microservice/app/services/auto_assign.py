"""
Авто-назначение этапов заказа на исполнителей.

Логика:
1. Для каждого этапа без исполнителя определяем требуемую роль:
   - stage.required_role, если задана;
   - иначе роли из system_roles, у которых allowed_stage_types содержит stage_type.
2. Среди активных пользователей этих ролей выбираем наименее загруженного
   (по количеству незавершённых назначенных этапов).
3. Назначаем и шлём уведомление исполнителю.
"""
import json
from sqlalchemy import text, select, update, func
from sqlalchemy.ext.asyncio import AsyncSession

from shared.core.notify import notify_user
from app.models.business import OrderStage


async def _roles_for_stage_type(db: AsyncSession, stage_type: str) -> list[str]:
    rows = (await db.execute(text(
        "SELECT code, allowed_stage_types FROM system_roles WHERE is_active = true"
    ))).mappings().all()
    roles = []
    for r in rows:
        try:
            allowed = json.loads(r["allowed_stage_types"] or "[]")
        except (ValueError, TypeError):
            allowed = []
        if stage_type in allowed:
            roles.append(r["code"])
    return roles


async def _least_loaded_user(db: AsyncSession, roles: list[str]) -> dict | None:
    """Активный пользователь одной из ролей с минимумом незавершённых этапов."""
    if not roles:
        return None
    from sqlalchemy import bindparam
    stmt = text("""
        SELECT u.id, u.username, u.full_name,
               COUNT(s.id) FILTER (WHERE s.status IN ('pending', 'in_progress')) AS load
        FROM users u
        LEFT JOIN order_stages s ON s.assigned_to = CAST(u.id AS VARCHAR)
        WHERE u.is_active = true AND u.role IN :roles
        GROUP BY u.id, u.username, u.full_name
        ORDER BY load ASC, u.id ASC
        LIMIT 1
    """).bindparams(bindparam("roles", expanding=True))
    row = (await db.execute(stmt, {"roles": roles})).mappings().one_or_none()
    return dict(row) if row else None


async def auto_assign_stages(db: AsyncSession, order_id: int,
                             product_name: str = "") -> list[dict]:
    """Назначить всех свободных этапов заказа. Возвращает список назначений."""
    stages = (await db.execute(
        select(OrderStage).where(
            OrderStage.order_id == order_id,
            OrderStage.status.in_(["pending", "blocked"]),
        ).order_by(OrderStage.sort_order)
    )).scalars().all()

    assigned = []
    for stage in stages:
        if stage.assigned_to:
            continue
        if stage.required_role:
            roles = [stage.required_role]
        else:
            roles = await _roles_for_stage_type(db, stage.stage_type or "")
        if not roles:
            continue
        user = await _least_loaded_user(db, roles)
        if not user:
            continue
        name = user["full_name"] or user["username"]
        await db.execute(
            update(OrderStage)
            .where(OrderStage.id == stage.id)
            .values(assigned_to=str(user["id"]), assigned_name=name,
                    updated_at=func.now())
        )
        await notify_user(
            db, user["id"],
            f"Вам назначен этап «{stage.stage_name}»",
            f"Заказ №{order_id}" + (f" — {product_name}" if product_name else ""),
            link="/my-tasks", type_="info",
        )
        assigned.append({
            "stage_id": stage.id, "stage_name": stage.stage_name,
            "user_id": user["id"], "user_name": name,
        })
    return assigned
