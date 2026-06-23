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
    elif (shipped > 0 and ready == 0 and accepted == 0 and in_sc == 0
          and running == 0 and paused == 0 and (total == 0 or completed >= total)):
        # Всё отгружено, ничего не зависло в ОТК И нет незавершённого производства —
        # заказ закрыт. Для мультипозиции это не даёт закрыть заказ, пока другие
        # позиции ещё в работе (running/paused) или не сданы в ОТК (completed<total).
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
        # Заказ завершён (любым путём: отгрузка/ОТК/СЦ) → списываем резерв компонентов со склада
        if new_status in ("Завершен", "Завершён"):
            await consume_order_reserve(db, order_id)
        return True
    return False


async def consume_order_reserve(db, order_id: int) -> int:
    """Превратить резерв компонентов заказа в фактическое списание (stock −q, reserved −q).
    Вызывается при завершении/отгрузке заказа. Идемпотентно (метит списания ORDER-CONSUME-*);
    пропускается, если резерв уже снят возвратом (ORDER-RETURN-*). Обрабатывает только новые
    брони (operation_type='RESERVE'); у legacy-заказов сток списан при создании (WRITEOFF) —
    их строки пропускаются, повторного списания нет. Возвращает число обработанных позиций."""
    # Если резерв уже снят возвратом (отмена заказа) — не списываем.
    released = (await db.execute(text(
        "SELECT 1 FROM operations WHERE operation_id LIKE :r LIMIT 1"
    ), {"r": f"ORDER-RETURN-{order_id}-%"})).scalar()
    if released:
        return 0
    reserved = (await db.execute(text(
        "SELECT component_name, quantity FROM operations "
        "WHERE operation_id LIKE :p AND operation_type = 'RESERVE' "
        "ORDER BY operation_id"
    ), {"p": f"ORDER-RESERVE-{order_id}-%"})).mappings().all()
    consumed = 0
    for idx, r in enumerate(reserved):
        if not r["quantity"]:
            continue
        # Сначала пытаемся вставить маркер списания. operations.operation_id UNIQUE —
        # при гонке/повторном вызове вставка по тому же operation_id не пройдёт
        # (ON CONFLICT DO NOTHING), и stock/reserved не будут списаны второй раз.
        marker = await db.execute(text(
            "INSERT INTO operations (operation_type, component_name, quantity, note, operation_id) "
            "VALUES ('WRITEOFF', :cn, :q, :note, :oid) "
            "ON CONFLICT (operation_id) DO NOTHING"
        ), {"cn": r["component_name"], "q": r["quantity"],
            "note": f"Списание по завершении заказа #{order_id}",
            "oid": f"ORDER-CONSUME-{order_id}-{idx}"})
        if marker.rowcount != 1:
            # Маркер уже существует — списание по этой позиции уже сделано, пропускаем.
            continue
        await db.execute(text(
            "UPDATE warehouse_components "
            "SET stock = GREATEST(COALESCE(stock,0) - :q, 0), "
            "    reserved = GREATEST(COALESCE(reserved,0) - :q, 0) "
            "WHERE LOWER(TRIM(name)) = LOWER(TRIM(:n))"
        ), {"q": r["quantity"], "n": r["component_name"]})
        consumed += 1
    return consumed


async def release_order_reserve(db, order_id: int) -> int:
    """Снять резерв компонентов заказа (при отмене). Идемпотентно (метит ORDER-RETURN-*);
    пропускается, если резерв уже списан (ORDER-CONSUME-*). Для новых броней (RESERVE) снимает
    бронь (reserved −q); для legacy (WRITEOFF, сток был уменьшен при создании) возвращает сток
    (+q). Возвращает число обработанных позиций."""
    # Если резерв уже превращён в фактическое списание (заказ завершён) — не снимаем.
    consumed = (await db.execute(text(
        "SELECT 1 FROM operations WHERE operation_id LIKE :c LIMIT 1"
    ), {"c": f"ORDER-CONSUME-{order_id}-%"})).scalar()
    if consumed:
        return 0
    reserved = (await db.execute(text(
        "SELECT component_name, quantity, operation_type FROM operations "
        "WHERE operation_id LIKE :p AND operation_type IN ('RESERVE', 'WRITEOFF') "
        "ORDER BY operation_id"
    ), {"p": f"ORDER-RESERVE-{order_id}-%"})).mappings().all()
    released = 0
    for idx, r in enumerate(reserved):
        if not r["quantity"]:
            continue
        if r["operation_type"] == "RESERVE":
            note = f"Снятие резерва отменённого заказа #{order_id}"
        else:
            note = f"Возврат резерва отменённого заказа #{order_id}"
        # Сначала маркер. operations.operation_id UNIQUE — при гонке/повторе вставка
        # по тому же operation_id не пройдёт (ON CONFLICT DO NOTHING), и изменение
        # stock/reserved не применится дважды.
        marker = await db.execute(text(
            "INSERT INTO operations (operation_type, component_name, quantity, note, operation_id) "
            "VALUES ('RESERVE_RELEASE', :cn, :q, :note, :oid) "
            "ON CONFLICT (operation_id) DO NOTHING"
        ), {"cn": r["component_name"], "q": r["quantity"], "note": note,
            "oid": f"ORDER-RETURN-{order_id}-{idx}"})
        if marker.rowcount != 1:
            # Маркер уже существует — снятие по этой позиции уже сделано, пропускаем.
            continue
        if r["operation_type"] == "RESERVE":
            await db.execute(text(
                "UPDATE warehouse_components SET reserved = GREATEST(COALESCE(reserved,0) - :q, 0) "
                "WHERE LOWER(TRIM(name)) = LOWER(TRIM(:n))"
            ), {"q": r["quantity"], "n": r["component_name"]})
        else:
            await db.execute(text(
                "UPDATE warehouse_components SET stock = COALESCE(stock,0) + :q "
                "WHERE LOWER(TRIM(name)) = LOWER(TRIM(:n))"
            ), {"q": r["quantity"], "n": r["component_name"]})
        released += 1
    return released
