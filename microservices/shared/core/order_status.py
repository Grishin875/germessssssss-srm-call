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
            COUNT(*) FILTER (WHERE status = 'брак')              AS brak,
            COUNT(*) FILTER (WHERE status = 'Списан')            AS scrapped
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
    scrapped  = otk["scrapped"] or 0

    # Мультипозиция: позиции, ещё не дошедшие до терминала (нет ОТК-партий вовсе /
    # висит незавершённая ОТК-партия / незавершённое производство). Для legacy-заказов
    # без order_items вернётся 0 → работает прежняя order-level логика.
    pending_positions = (await db.execute(text("""
        SELECT COUNT(*) FROM order_items oi
        WHERE oi.order_id = :id AND (
            NOT EXISTS (SELECT 1 FROM otk_batches ob WHERE ob.order_item_id = oi.id)
            OR EXISTS (SELECT 1 FROM otk_batches ob WHERE ob.order_item_id = oi.id
                       AND ob.status NOT IN ('отгружено','Списан','Переделан'))
            OR EXISTS (SELECT 1 FROM production_batches pb WHERE pb.order_item_id = oi.id
                       AND pb.production_type != 'Сборка'
                       AND pb.status NOT IN ('Завершена','Готов к проверке ОТК','Отменена'))
        )
    """), {"id": order_id})).scalar() or 0

    new_status = current

    if brak > 0 or in_sc > 0:
        # Незакрытый брак (100% критич. из otk_check result=3) ИЛИ партия в СЦ
        # ('Передан в СЦ') держат заказ в «Доработка»: нельзя закрывать и двигать
        # дальше, пока не переделают/спишут (СЦ: repaired>0 → 'Принята', полный
        # брак → 'Списан'). Руководитель может закрыть принудительно (TERMINAL обходит пересчёт).
        new_status = "Доработка"
    elif ((shipped > 0 or scrapped > 0) and ready == 0 and accepted == 0
          and running == 0 and paused == 0 and (total == 0 or completed >= total)
          and pending_positions == 0):
        # Всё разрешено: годное отгружено, невосстановимый брак списан, ничего не висит
        # в ОТК/производстве, И все позиции дошли до терминала (мультипозиция) — заказ закрыт.
        new_status = "Завершен"
    elif accepted > 0:
        # Есть партии, ещё ожидающие проверки ОТК
        new_status = "На проверке ОТК"
    elif ready > 0:
        # Все проверенные партии годны и ждут отгрузки
        new_status = "Готов к отгрузке"
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
        # и приходуем готовую продукцию (для заказов без этапа warehouse_fg, напр. под-заказы).
        if new_status in ("Завершен", "Завершён"):
            await consume_order_reserve(db, order_id)
            await credit_finished_goods_on_complete(db, order_id)
        return True
    return False


async def credit_finished_goods_on_complete(db, order_id: int) -> int:
    """Оприходовать ГП по завершении заказа, ЕСЛИ у заказа нет этапа warehouse_fg
    (тот сам приходует ГП на своём завершении — не дублируем). Нужно, чтобы заказы
    по рецептурным маршрутам (в т.ч. авто под-заказы на полуфабрикаты) попадали в
    finished_goods и могли потребляться заказами-родителями. Идемпотентно."""
    has_fg_stage = (await db.execute(text(
        "SELECT 1 FROM order_stages WHERE order_id=:oid AND stage_type='warehouse_fg' LIMIT 1"
    ), {"oid": order_id})).scalar()
    if has_fg_stage:
        return 0
    rows = (await db.execute(text(
        "SELECT product_name, COALESCE(SUM(good_qty),0) AS good FROM otk_batches "
        "WHERE order_id=:oid GROUP BY product_name ORDER BY product_name"
    ), {"oid": order_id})).mappings().all()
    credited = 0
    for idx, r in enumerate(rows):
        good = int(r["good"] or 0)
        pn = (r["product_name"] or "").strip()
        if good <= 0 or not pn:
            continue
        marker = await db.execute(text(
            "INSERT INTO operations (operation_type, component_name, quantity, note, operation_id) "
            "VALUES ('FG_RECEIPT', :pn, :q, :note, :oid) ON CONFLICT (operation_id) DO NOTHING"
        ), {"pn": pn, "q": good, "note": f"Оприходование ГП по завершении заказа #{order_id}",
            "oid": f"ORDER-FGCREDIT-{order_id}-{idx}"})
        if marker.rowcount != 1:
            continue
        await db.execute(text(
            "INSERT INTO finished_goods (product_name, good_qty, defect_qty, total_qty, updated_at) "
            "VALUES (:pn, :q, 0, :q, NOW()) ON CONFLICT (product_name) DO UPDATE "
            "SET good_qty = finished_goods.good_qty + :q, total_qty = finished_goods.total_qty + :q, "
            "updated_at = NOW()"
        ), {"pn": pn, "q": good})
        credited += 1
    return credited


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

    # Списание зарезервированной ГП под-изделий: good_qty −q, reserved −q (потребление).
    fg = (await db.execute(text(
        "SELECT component_name, quantity FROM operations "
        "WHERE operation_id LIKE :p AND operation_type='FG_RESERVE' ORDER BY operation_id"
    ), {"p": f"ORDER-FGRESERVE-{order_id}-%"})).mappings().all()
    for idx, r in enumerate(fg):
        if not r["quantity"]:
            continue
        marker = await db.execute(text(
            "INSERT INTO operations (operation_type, component_name, quantity, note, operation_id) "
            "VALUES ('FG_CONSUME', :cn, :q, :note, :oid) ON CONFLICT (operation_id) DO NOTHING"
        ), {"cn": r["component_name"], "q": r["quantity"],
            "note": f"Списание ГП под-изделия по завершении заказа #{order_id}",
            "oid": f"ORDER-FGCONSUME-{order_id}-{idx}"})
        if marker.rowcount != 1:
            continue
        await db.execute(text(
            "UPDATE finished_goods SET good_qty = GREATEST(COALESCE(good_qty,0) - :q, 0), "
            "reserved = GREATEST(COALESCE(reserved,0) - :q, 0), "
            "total_qty = GREATEST(COALESCE(total_qty,0) - :q, 0), updated_at = NOW() "
            "WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(:n))"
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

    # Снятие резерва ГП под-изделий (при отмене заказа): reserved −q (good_qty не трогаем).
    fg = (await db.execute(text(
        "SELECT component_name, quantity FROM operations "
        "WHERE operation_id LIKE :p AND operation_type='FG_RESERVE' ORDER BY operation_id"
    ), {"p": f"ORDER-FGRESERVE-{order_id}-%"})).mappings().all()
    for idx, r in enumerate(fg):
        if not r["quantity"]:
            continue
        marker = await db.execute(text(
            "INSERT INTO operations (operation_type, component_name, quantity, note, operation_id) "
            "VALUES ('FG_RESERVE_RELEASE', :cn, :q, :note, :oid) ON CONFLICT (operation_id) DO NOTHING"
        ), {"cn": r["component_name"], "q": r["quantity"],
            "note": f"Снятие резерва ГП под-изделия отменённого заказа #{order_id}",
            "oid": f"ORDER-FGRETURN-{order_id}-{idx}"})
        if marker.rowcount != 1:
            continue
        await db.execute(text(
            "UPDATE finished_goods SET reserved = GREATEST(COALESCE(reserved,0) - :q, 0), updated_at = NOW() "
            "WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(:n))"
        ), {"q": r["quantity"], "n": r["component_name"]})
        released += 1
    return released
