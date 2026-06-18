"""
Авто-уведомления для всех микросервисов.

Вставляет записи в таблицу `notifications` (admin-service) напрямую через text() —
БД общая, поэтому хелпер работает из любого сервиса без HTTP-вызовов.
Ошибка уведомления никогда не должна ломать основной поток — всё в try/except.
"""
import logging

from sqlalchemy import text, bindparam

logger = logging.getLogger(__name__)


async def notify_user(db, user_id, title: str, message: str = None,
                      link: str = None, type_: str = "info") -> None:
    """Создать уведомление одному пользователю. user_id может быть str или int."""
    try:
        uid = int(str(user_id).strip())
    except (ValueError, TypeError):
        return
    try:
        await db.execute(text("""
            INSERT INTO notifications (user_id, type, title, message, link, is_read)
            VALUES (:uid, :t, :title, :msg, :link, false)
        """), {"uid": uid, "t": type_, "title": title[:300], "msg": message, "link": link})
    except Exception:
        logger.exception("notify_user failed (user_id=%s, title=%r)", user_id, title)


async def notify_roles(db, roles: list[str], title: str, message: str = None,
                       link: str = None, type_: str = "info",
                       exclude_user_id=None) -> None:
    """Создать уведомление всем активным пользователям перечисленных ролей."""
    if not roles:
        return
    try:
        stmt = text("""
            INSERT INTO notifications (user_id, type, title, message, link, is_read)
            SELECT id, :t, :title, :msg, :link, false
            FROM users
            WHERE is_active = true AND role IN :roles AND id != :exclude
        """).bindparams(bindparam("roles", expanding=True))
        await db.execute(stmt, {
            "t": type_, "title": title[:300], "msg": message, "link": link,
            "roles": list(roles), "exclude": int(exclude_user_id) if exclude_user_id else -1,
        })
    except Exception:
        logger.exception("notify_roles failed (roles=%s, title=%r)", roles, title)


async def notify_managers(db, title: str, message: str = None,
                          link: str = None, type_: str = "info") -> None:
    """Уведомить руководителей (admin + manager)."""
    await notify_roles(db, ["admin", "manager"], title, message, link, type_)
