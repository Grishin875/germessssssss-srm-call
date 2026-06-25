"""
Фоновый SLA-монитор.

Каждые SLA_CHECK_INTERVAL секунд проверяет заказы, висящие в статусе дольше
max_hours из активных правил sla_rules, и создаёт уведомления пользователям
ролей из notify_roles (по умолчанию admin + manager).

Дедупликация: по одному заказу уведомление не чаще раза в 24 часа
(проверка по заголовку в таблице notifications).
"""
import asyncio
import json
import logging

from sqlalchemy import text, bindparam

logger = logging.getLogger("sla_monitor")

SLA_CHECK_INTERVAL = 300  # 5 минут
TERMINAL_STATUSES = ("Завершен", "Завершён", "Отменен", "Отменён", "Выполнен")


async def check_sla_once(session) -> int:
    """Один проход проверки SLA. Возвращает число созданных уведомлений."""
    rules = (await session.execute(text(
        "SELECT status, max_hours, notify_roles FROM sla_rules WHERE is_active = true"
    ))).mappings().all()
    created = 0
    for rule in rules:
        if rule["status"] in TERMINAL_STATUSES:
            continue
        overdue = (await session.execute(text("""
            SELECT id, product_name, status,
                   FLOOR(EXTRACT(EPOCH FROM (NOW() - updated_at)) / 3600)::int AS hours_in_status
            FROM orders
            WHERE status = :st
              AND updated_at < NOW() - make_interval(hours => :mh)
        """), {"st": rule["status"], "mh": rule["max_hours"]})).mappings().all()

        try:
            roles = json.loads(rule["notify_roles"] or "[]")
        except (ValueError, TypeError):
            roles = []
        if not roles:
            roles = ["admin", "manager"]

        for order in overdue:
            title = f"SLA нарушен: заказ №{order['id']} в статусе «{order['status']}»"
            overdue_h = int(order["hours_in_status"]) - int(rule["max_hours"])
            # Дедуп ПО ПОЛУЧАТЕЛЮ (NOT EXISTS на user), а не глобально по заголовку:
            # иначе вновь добавленный/ранее офлайн получатель не получил бы активное
            # оповещение, потому что заголовок уже существует у кого-то другого.
            stmt = text("""
                INSERT INTO notifications (user_id, type, title, message, link, is_read)
                SELECT u.id, 'warning', :t, :msg, :link, false
                FROM users u
                WHERE u.is_active = true AND u.role IN :roles
                  AND NOT EXISTS (
                    SELECT 1 FROM notifications n
                    WHERE n.user_id = u.id AND n.title = :t
                      AND n.created_at > NOW() - INTERVAL '24 hours'
                  )
            """).bindparams(bindparam("roles", expanding=True))
            res = await session.execute(stmt, {
                "t": title,
                "msg": f"{order['product_name']}: лимит {rule['max_hours']} ч, "
                       f"просрочка {max(overdue_h, 1)} ч.",
                "link": f"/orders/{order['id']}",
                "roles": list(roles),
            })
            created += res.rowcount or 0
    return created


async def sla_monitor_loop(session_factory):
    """Бесконечный цикл мониторинга. Запускается из lifespan приложения."""
    await asyncio.sleep(15)  # даём приложению подняться
    while True:
        try:
            async with session_factory() as session:
                created = await check_sla_once(session)
                await session.commit()
                if created:
                    logger.info("SLA-монитор: создано уведомлений: %s", created)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("SLA-монитор: ошибка прохода: %s", e)
        await asyncio.sleep(SLA_CHECK_INTERVAL)
