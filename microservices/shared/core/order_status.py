"""
Единая статус-машина заказа — один источник правды для всех сервисов.

Раньше существовали две расходящиеся копии (business-logic и otk), которые при
одном и том же наборе партий могли выставить разный статус. Теперь логика здесь.

Статусы заказа:
  Создан → В работе → Готов к проверке ОТК → На проверке ОТК
         → Готов к отгрузке → Завершен | Отменён
  (+ Доработка — при браке: otk_check выставляет её напрямую, и пока у заказа
     есть партия со статусом 'брак', этот пересчёт держит заказ в «Доработка»
     — не закрывает и не пускает на отгрузку, пока брак не переделают.)

Партии otk_batches: Принята (ждёт проверки) → готово к отгрузке → отгружено
                    | Передан в СЦ | брак
Партии production_batches: Запланировано → Запущена → На паузе
                    → Готов к проверке ОТК → Завершена | Отменена
"""
from sqlalchemy import text

TERMINAL = ("Завершен", "Завершён", "Отменен", "Отменён")


async def update_order_status(db, order_id: int) -> bool:
    """Пересчитать и сохранить статус заказа по его партиям.
    Возвращает True, если статус изменился."""
    order = (await db.execute(
        text("SELECT status FROM orders WHERE id = :id"), {"id": order_id}
    )).mappings().one_or_none()
    if not order:
        return False
    current = order["status"]
    if current in TERMINAL:
        return False

    # Производственные партии (кроме Сборки — она вторична)
    pb = (await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status NOT IN ('Отменена')) AS total,
            COUNT(*) FILTER (WHERE status IN ('Готов к проверке ОТК', 'Завершена')) AS completed,
            COUNT(*) FILTER (WHERE status = 'Запущена') AS running,
            COUNT(*) FILTER (WHERE status = 'На паузе') AS paused
        FROM production_batches
        WHERE order_id = :id AND production_type != 'Сборка'
    """), {"id": order_id})).mappings().one()

    # Партии ОТК
    otk = (await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE status = 'готово к отгрузке') AS ready,
            COUNT(*) FILTER (WHERE status = 'отгружено')         AS shipped,
            COUNT(*) FILTER (WHERE status = 'Принята')           AS accepted,
            COUNT(*) FILTER (WHERE status = 'Передан в СЦ')      AS in_sc,
            COUNT(*) FILTER (WHERE status = 'брак')              AS brak
        FROM otk_batches WHERE order_id = :id
    """), {"id": order_id})).mappings().one()

    total     = pb["total"]     or 0
    completed = pb["completed"] or 0
    running   = pb["running"]   or 0
    paused    = pb["paused"]    or 0
    ready     = otk["ready"]    or 0
    shipped   = otk["shipped"]  or 0
    accepted  = otk["accepted"] or 0
    in_sc     = otk["in_sc"]    or 0
    brak      = otk["brak"]     or 0

    new_status = current

    if brak > 0:
        # Есть забракованная партия (100% критич. брак из otk_check result=3).
        # Заказ нельзя закрывать и нельзя двигать дальше по маршруту, пока брак
        # не переделают (повторная сдача в ОТК пометит партию 'Переделан') или
        # руководитель не закроет заказ принудительно (TERMINAL обходит этот пересчёт).
        new_status = "Доработка"
    elif shipped > 0 and ready == 0 and accepted == 0 and in_sc == 0:
        # Всё отгружено, ничего не зависло — заказ закрыт
        new_status = "Завершен"
    elif accepted > 0:
        # Есть партии, ещё ожидающие проверки ОТК
        new_status = "На проверке ОТК"
    elif ready > 0:
        # Все проверенные партии годны и ждут отгрузки
        new_status = "Готов к отгрузке"
    elif in_sc > 0 and ready == 0 and accepted == 0:
        # Всё, что осталось — в сервис-центре; держим заказ открытым
        new_status = "На проверке ОТК"
    elif total > 0 and completed >= total:
        # Производство завершено, ОТК-партий ещё нет
        new_status = "Готов к проверке ОТК"
    elif running > 0 or paused > 0:
        new_status = "В работе"

    if new_status != current:
        await db.execute(
            text("UPDATE orders SET status = :s, updated_at = NOW() WHERE id = :id"),
            {"s": new_status, "id": order_id},
        )
        return True
    return False
