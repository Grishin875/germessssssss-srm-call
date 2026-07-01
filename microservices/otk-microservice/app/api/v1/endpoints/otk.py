import logging, time, random, string
from typing import Optional, List
from datetime import datetime, timedelta
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, delete, func, text, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from pydantic import BaseModel, Field

from app.models.otk import (
    OtkBatch, DefectRecord as DefectRecordModel, ScRepair, OtkDefectType, DefectCategory,
    OtkRegulationProblem, OtkRegulationMeasurement,
    OtkRegulationReplacement, OtkRegulationTool,
)
from shared.core.notify import notify_user, notify_roles, notify_managers

router = APIRouter()
logger = logging.getLogger(__name__)


def _db(r: Request):
    return r.state.db


def _user(r: Request):
    u = r.state.current_user
    if not u:
        raise HTTPException(401, "Не авторизован")
    return u


def _perm(r: Request, p: str):
    u = _user(r)
    if u.role == "admin":
        return u
    if not (u.user_permissions or {}).get(p):
        raise HTTPException(403, f"Недостаточно прав: {p}")
    return u


def _op_id(prefix: str) -> str:
    return f"{prefix}-{int(time.time()*1000)}-{''.join(random.choices(string.ascii_lowercase,k=6))}"

def _m(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}


# ── Аналитика качества (дашборд ОТК) ──────────────────────────────────────────

@router.get("/otk/analytics/summary")
async def otk_analytics_summary(request: Request, days: int = 30):
    """Сводка качества за период: KPI, брак по отделам, Парето причин, тренд."""
    _perm(request, "otk.view")
    db = _db(request)
    days = max(1, min(int(days or 30), 365))
    cutoff = datetime.utcnow() - timedelta(days=days)

    # KPI + разбивка по отделам (production_type проверенных партий)
    dept_rows = (await db.execute(text("""
        SELECT COALESCE(NULLIF(TRIM(production_type), ''), '—') AS dept,
               COALESCE(SUM(released_qty), 0) AS released,
               COALESCE(SUM(good_qty), 0)     AS good,
               COALESCE(SUM(defect_qty), 0)   AS defect,
               COUNT(*)                        AS batches
        FROM otk_batches
        WHERE check_date IS NOT NULL AND check_date >= :cutoff
        GROUP BY COALESCE(NULLIF(TRIM(production_type), ''), '—')
        ORDER BY defect DESC
    """), {"cutoff": cutoff})).mappings().all()

    by_department = []
    tot_released = tot_good = tot_defect = tot_batches = 0
    for r in dept_rows:
        released, good, defect = int(r["released"]), int(r["good"]), int(r["defect"])
        base = good + defect
        by_department.append({
            "label": r["dept"], "released": released, "good": good, "defect": defect,
            "batches": int(r["batches"]),
            "rate": round(defect * 100.0 / base, 1) if base else 0.0,
        })
        tot_released += released; tot_good += good; tot_defect += defect
        tot_batches += int(r["batches"])
    kpi_base = tot_good + tot_defect
    kpi = {
        "released": tot_released, "good": tot_good, "defect": tot_defect,
        "batches": tot_batches,
        "defect_rate": round(tot_defect * 100.0 / kpi_base, 1) if kpi_base else 0.0,
    }

    # Парето причин брака (defect_records → otk_defect_types)
    pareto = [
        {"label": r["cause"], "value": int(r["qty"])}
        for r in (await db.execute(text("""
            SELECT COALESCE(NULLIF(TRIM(dt.subdescription), ''), NULLIF(TRIM(dt.category), ''), 'Прочее') AS cause,
                   COALESCE(SUM(dr.quantity), 0) AS qty
            FROM defect_records dr
            JOIN otk_batches b ON dr.otk_batch_id = b.id
            LEFT JOIN otk_defect_types dt ON dr.otk_defect_type_id = dt.id
            WHERE b.check_date >= :cutoff
            GROUP BY COALESCE(NULLIF(TRIM(dt.subdescription), ''), NULLIF(TRIM(dt.category), ''), 'Прочее')
            HAVING COALESCE(SUM(dr.quantity), 0) > 0
            ORDER BY qty DESC
            LIMIT 12
        """), {"cutoff": cutoff})).mappings().all()
    ]

    # Тренд брака по дням
    trend = [
        {"date": r["d"], "defect": int(r["defect"]), "released": int(r["released"])}
        for r in (await db.execute(text("""
            SELECT to_char(date_trunc('day', check_date), 'YYYY-MM-DD') AS d,
                   COALESCE(SUM(defect_qty), 0)   AS defect,
                   COALESCE(SUM(released_qty), 0) AS released
            FROM otk_batches
            WHERE check_date IS NOT NULL AND check_date >= :cutoff
            GROUP BY date_trunc('day', check_date)
            ORDER BY d
        """), {"cutoff": cutoff})).mappings().all()
    ]

    return {"days": days, "kpi": kpi, "by_department": by_department, "pareto": pareto, "trend": trend}


# ── Schemas ──────────────────────────────────────────────────────────────────

class DefectRecord(BaseModel):
    quantity: int = Field(ge=0)
    comment: Optional[str] = None
    designator: Optional[str] = None
    defect_type_id: Optional[int] = None
    category_id: Optional[int] = None


class OtkCheckRequest(BaseModel):
    batchId: str
    otkId: str
    result: Optional[int] = None
    defect_comment: Optional[str] = None
    rejection_photo_url: Optional[str] = None
    records: Optional[List[DefectRecord]] = None
    good_qty: Optional[int] = Field(None, ge=0)      # годных не может быть < 0
    defect_qty: Optional[int] = Field(None, ge=0)    # брака не может быть < 0
    good: Optional[int] = Field(None, ge=0)
    defect: Optional[int] = Field(None, ge=0)
    is_firmware_done: Optional[bool] = None
    firmware_qty: Optional[int] = Field(None, ge=0)
    firmware_version: Optional[str] = None
    # ОТК может указать, на какой отдел/этап вернуть брак (stage_type или id этапа).
    # Если не указан — авто-выбор последнего завершённого производственного этапа.
    rework_stage_type: Optional[str] = None
    rework_stage_id: Optional[int] = None


class ShipmentItem(BaseModel):
    batchId: str
    qty: int = Field(gt=0)   # запрет 0/отрицательного кол-ва (иначе можно «разотгрузить»)
    shipperId: str
    invoiceNumber: Optional[str] = None
    recipient: Optional[str] = None


class ShipPartialRequest(BaseModel):
    shipments: List[ShipmentItem]


class RegulationProblem(BaseModel):
    product_name: str
    problem: str
    solution: str


class RegulationMeasurement(BaseModel):
    product_name: str
    point_name: str
    expected_value: Optional[str] = None
    unit: Optional[str] = None
    comment: Optional[str] = None


class RegulationReplacement(BaseModel):
    product_name: str
    original_component: str
    replacement: str
    comment: Optional[str] = None


class RegulationTool(BaseModel):
    product_name: str
    tool_name: str
    comment: Optional[str] = None


# ── Batches ───────────────────────────────────────────────────────────────────

@router.get("/otk/batches")
async def list_batches(request: Request, status: Optional[str] = None):
    _perm(request, "otk.view")
    db = _db(request)
    q = select(OtkBatch)
    if status:
        q = q.where(OtkBatch.status == status)
    q = q.order_by(OtkBatch.receive_date.desc())
    result = await db.execute(q)
    batches = result.scalars().all()
    rows = []
    for b in batches:
        d = _m(b)
        if b.maker_id:
            maker = (await db.execute(text(
                "SELECT name FROM operators WHERE employee_id=:e"
            ), {"e": b.maker_id})).scalar_one_or_none()
            d["maker_name"] = maker
        else:
            d["maker_name"] = None
        rows.append(d)
    return rows


@router.delete("/otk/batches/{batch_id}")
async def delete_batch(batch_id: str, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    result = await db.execute(
        select(OtkBatch.id, OtkBatch.status).where(OtkBatch.batch_id == batch_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Партия не найдена")
    if row.status != "Принята":
        raise HTTPException(400, "Удалить можно только партии со статусом \"Принята\"")
    oid = row.id
    await db.execute(delete(DefectRecordModel).where(DefectRecordModel.otk_batch_id == oid))
    await db.execute(delete(ScRepair).where(ScRepair.otk_batch_id == oid))
    await db.execute(delete(OtkBatch).where(OtkBatch.batch_id == batch_id))
    await db.commit()
    return {"success": True}


@router.post("/otk/check")
async def otk_check(body: OtkCheckRequest, request: Request):
    _perm(request, "otk.view")
    db = _db(request)

    result = await db.execute(select(OtkBatch).where(OtkBatch.batch_id == body.batchId))
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(404, f"Партия {body.batchId} не найдена")
    if batch.status != "Принята":
        raise HTTPException(400, f"Партия уже проверена (статус: {batch.status})")

    released = int(batch.released_qty)
    good_qty, defect_qty, new_status = 0, 0, "готово к отгрузке"

    if body.result is not None:
        r = body.result
        if r == 1:
            good_qty, defect_qty, new_status = released, 0, "готово к отгрузке"
        elif r == 2:
            good_qty = body.good_qty or 0
            defect_qty = body.defect_qty or 0
            if good_qty + defect_qty != released:
                raise HTTPException(400, f"Сумма годных ({good_qty}) и брака ({defect_qty}) ≠ выпущенному ({released})")
            if not body.records:
                raise HTTPException(400, "При result=2 укажите записи о дефектах")
            new_status = "готово к отгрузке" if good_qty > 0 else "Передан в СЦ"
        elif r == 3:
            good_qty, defect_qty, new_status = 0, released, "брак"
            if not body.defect_comment:
                raise HTTPException(400, "При result=3 укажите комментарий")
        else:
            raise HTTPException(400, "result должен быть 1, 2 или 3")
    else:
        good_qty = body.good or 0
        defect_qty = body.defect or 0
        if good_qty + defect_qty != released:
            raise HTTPException(400, "Сумма годных и брака ≠ выпущенному количеству")

    # При частичном браке (result=2, есть и годные, и брак) брак выносится в
    # ОТДЕЛЬНУЮ SC-партию, а ИСХОДНАЯ партия несёт ТОЛЬКО годное. Иначе брак
    # учитывался бы дважды (в исходной defect_qty И в SC defect_qty), а после
    # ремонта — трижды. Поэтому при создании SC-партии у исходной обнуляем
    # defect_qty и сводим released_qty к good_qty.
    create_sc = body.result == 2 and good_qty > 0 and defect_qty > 0

    update_vals: dict = {
        "good_qty": good_qty, "defect_qty": defect_qty,
        "status": new_status, "check_date": func.now(), "maker_id": body.otkId,
    }
    if create_sc:
        update_vals["defect_qty"] = 0
        update_vals["released_qty"] = good_qty
    if body.defect_comment:
        update_vals["defect_comment"] = body.defect_comment
    if body.rejection_photo_url:
        update_vals["rejection_photo_url"] = body.rejection_photo_url
    # Данные о прошивке (приходят с формы ОТК для SMD): раньше принимались, но не
    # сохранялись. Теперь пишем их в партию, чтобы «Кол-во прошитых»/«Версия» не терялись.
    if body.is_firmware_done is not None:
        update_vals["is_firmware_done"] = body.is_firmware_done
    if body.firmware_qty is not None:
        update_vals["firmware_qty"] = body.firmware_qty
    if body.firmware_version:
        update_vals["firmware_version"] = body.firmware_version

    await db.execute(
        update(OtkBatch).where(OtkBatch.batch_id == body.batchId).values(**update_vals)
    )

    # Единый путь учёта брака для result=2:
    #  • good>0 и defect>0  → отдельная SC-партия несёт весь брак (create_sc),
    #                         defect_records привязываются к НЕЙ;
    #  • good==0 (всё брак) → исходная партия САМА становится SC-партией
    #                         (status='Передан в СЦ', defect_qty=defect_qty),
    #                         defect_records привязываются к ней.
    # В обоих случаях defect_records живут на той партии, что несёт брак и
    # имеет status='Передан в СЦ' — sc.py/sc_batches находит её по статусу,
    # а отчёты суммируют defect_qty ровно один раз (на партии-носителе брака).
    sc_batch_id = None
    defect_target_id = batch.id  # партия, к которой крепим defect_records
    if create_sc:
        sc_batch_id = body.batchId + "-SC"
        sc_exists = (await db.execute(text(
            "SELECT 1 FROM otk_batches WHERE batch_id=:b"
        ), {"b": sc_batch_id})).scalar_one_or_none()
        if sc_exists:
            sc_batch_id = body.batchId + f"-SC-{int(time.time())%10000}"
        sc = OtkBatch(
            batch_id=sc_batch_id, product_name=batch.product_name,
            production_type=batch.production_type, released_qty=defect_qty,
            good_qty=0, defect_qty=defect_qty, status="Передан в СЦ",
            maker_id=body.otkId, check_date=datetime.utcnow(),
            order_id=batch.order_id, order_item_id=batch.order_item_id,
            defect_comment=body.defect_comment,
            source_batch_id=batch.source_batch_id or body.batchId,
            receive_date=datetime.utcnow(),
        )
        db.add(sc)
        await db.flush()  # получить sc.id, чтобы привязать defect_records к SC-партии
        defect_target_id = sc.id

    if body.result == 2 and body.records:
        for rec in body.records:
            if rec.quantity <= 0:
                continue
            dr = DefectRecordModel(
                otk_batch_id=defect_target_id, defect_category_id=rec.category_id,
                otk_defect_type_id=rec.defect_type_id, designator=rec.designator,
                quantity=rec.quantity, comment=rec.comment,
            )
            db.add(dr)

    if batch.order_id:
        is_defect = body.result == 3 or (body.result == 2 and defect_qty > 0)
        # Позиция (line item) бракованной партии. Если задана — доработку скоупим
        # только на эту позицию; иначе (legacy) работаем по всему заказу.
        item_id = batch.order_item_id
        # Фрагмент WHERE и параметры для скоупа по позиции (или весь заказ при legacy)
        item_clause = " AND order_item_id=:iid" if item_id is not None else ""
        item_params = {"iid": item_id} if item_id is not None else {}
        if is_defect:
            # Возвращаем заказ на доработку (статус заказа — общий, по order_id;
            # статус-машина ниже переагрегирует с учётом всех позиций)
            comment_text = body.defect_comment or ""
            if body.result == 2:
                comment_text = f"Частичный брак: {defect_qty} шт. {comment_text}"
            await db.execute(text("""
                UPDATE orders SET status='Доработка', otk_comment=:c,
                otk_rejection_photo=:p, otk_attempts=COALESCE(otk_attempts,0)+1, updated_at=NOW()
                WHERE id=:oid
            """), {"c": comment_text, "p": body.rejection_photo_url or "", "oid": batch.order_id})

            # Эскалация (#44): при 3+ возвратах с ОТК — отдельное уведомление руководству
            attempts = (await db.execute(text(
                "SELECT COALESCE(otk_attempts,0) FROM orders WHERE id=:oid"
            ), {"oid": batch.order_id})).scalar() or 0
            if attempts >= 3:
                await notify_managers(db,
                    f"⚠ Эскалация: заказ №{batch.order_id} возвращён ОТК {attempts}-й раз",
                    f"{batch.product_name}: систематический брак. Требуется вмешательство руководителя.",
                    link=f"/orders/{batch.order_id}", type_="warning")

            await db.execute(text(f"""
                UPDATE production_batches SET status='Запланировано', updated_at=NOW()
                WHERE order_id=:oid AND status='Готов к проверке ОТК'{item_clause}
            """), {"oid": batch.order_id, **item_params})

            # Возврат на доработку: реактивируем последний завершённый
            # ПРОИЗВОДСТВЕННЫЙ этап перед ОТК. next_stage_id ОТК-этапа указывает
            # вперёд по маршруту (склад/отгрузка) — реактивировать его нельзя,
            # иначе брак уходит дальше вместо возврата исполнителю.
            # Все выборки этапов скоупим на позицию (order_item_id), если она известна.
            otk_stage = (await db.execute(text(f"""
                SELECT id, sort_order FROM order_stages
                WHERE order_id=:oid AND stage_type='otk' AND status='done'{item_clause}
                ORDER BY completed_at DESC LIMIT 1
            """), {"oid": batch.order_id, **item_params})).mappings().one_or_none()

            rework_stage_id = None
            # 1) Явный id этапа от ОТК
            if body.rework_stage_id:
                rework_stage_id = (await db.execute(text(f"""
                    SELECT id FROM order_stages
                    WHERE id=:sid AND order_id=:oid AND stage_type != 'otk'{item_clause}
                """), {"sid": body.rework_stage_id, "oid": batch.order_id, **item_params})).scalar_one_or_none()
            # 2) Отдел (stage_type), указанный ОТК — берём последний завершённый этап этого типа
            if not rework_stage_id and body.rework_stage_type:
                rework_stage_id = (await db.execute(text(f"""
                    SELECT id FROM order_stages
                    WHERE order_id=:oid AND stage_type=:st AND status='done'{item_clause}
                    ORDER BY completed_at DESC LIMIT 1
                """), {"oid": batch.order_id, "st": body.rework_stage_type, **item_params})).scalar_one_or_none()
            # 3) Авто-выбор: последний завершённый производственный этап перед ОТК
            if not rework_stage_id:
                rework_stage_id = (await db.execute(text(f"""
                    SELECT id FROM order_stages
                    WHERE order_id=:oid AND stage_type != 'otk' AND status='done'{item_clause}
                      AND (CAST(:max_sort AS INTEGER) IS NULL OR sort_order <= :max_sort)
                    ORDER BY completed_at DESC LIMIT 1
                """), {"oid": batch.order_id,
                       "max_sort": otk_stage["sort_order"] if otk_stage else None,
                       **item_params}
                )).scalar_one_or_none()

            if rework_stage_id:
                await db.execute(text("""
                    UPDATE order_stages
                    SET status='pending', started_at=NULL, completed_at=NULL, updated_at=NOW()
                    WHERE id=:sid
                """), {"sid": rework_stage_id})
                # Исполнители этапа снова получают работу (иначе их части остаются «сдано»)
                await db.execute(text("""
                    UPDATE stage_assignees
                    SET status='pending', started_at=NULL, completed_at=NULL, updated_at=NOW()
                    WHERE stage_id=:sid
                """), {"sid": rework_stage_id})
            # ОТК-этап блокируем до повторной сдачи, чтобы маршрут отражал реальность
            if otk_stage:
                await db.execute(text("""
                    UPDATE order_stages
                    SET status='blocked', started_at=NULL, completed_at=NULL, updated_at=NOW()
                    WHERE id=:sid
                """), {"sid": otk_stage["id"]})
            # Переагрегируем статус заказа по всем позициям: для одной бракованной
            # позиции мы выставили 'Доработка', но статус-машина учитывает остальные.
            from app.services.order_status import auto_update_order_status
            await auto_update_order_status(db, batch.order_id)
        else:
            from app.services.order_status import auto_update_order_status
            await auto_update_order_status(db, batch.order_id)

        # ── Авто-уведомления по результату проверки ─────────────────────────
        if is_defect:
            # Исполнители этапов заказа + руководители — о возврате на доработку
            assignees = (await db.execute(text("""
                SELECT DISTINCT assigned_to FROM order_stages
                WHERE order_id=:oid AND assigned_to IS NOT NULL AND assigned_to != ''
            """), {"oid": batch.order_id})).scalars().all()
            notify_ids = {str(a) for a in assignees}
            if rework_stage_id:
                # Мульти-исполнители реактивированного этапа (stage_assignees)
                sa_ids = (await db.execute(text(
                    "SELECT DISTINCT user_id FROM stage_assignees WHERE stage_id=:sid"
                ), {"sid": rework_stage_id})).scalars().all()
                notify_ids |= {str(i) for i in sa_ids}
            msg = f"{batch.product_name}: брак {defect_qty} шт. {body.defect_comment or ''}".strip()
            for uid in notify_ids:
                await notify_user(db, uid,
                                  f"Заказ №{batch.order_id} возвращён на доработку",
                                  msg, link="/my-tasks", type_="warning")
            await notify_managers(db,
                                  f"ОТК: брак по заказу №{batch.order_id}",
                                  msg, link=f"/orders/{batch.order_id}", type_="warning")
    if good_qty > 0 and new_status == "готово к отгрузке":
        await notify_roles(db, ["operator_shipment"],
                           f"Партия {body.batchId} готова к отгрузке",
                           f"{batch.product_name} — {good_qty} шт.",
                           link="/shipment", type_="success")

    await db.commit()
    return {"success": True, "batchId": body.batchId, "status": new_status,
            "goodQty": good_qty, "defectQty": defect_qty, "scBatchId": sc_batch_id}


# ── Ready to ship / Ship ──────────────────────────────────────────────────────

@router.get("/otk/ready-to-ship")
async def ready_to_ship(request: Request):
    _perm(request, "otk.view")
    db = _db(request)
    # Группируем по (order_id, order_item_id): каждая позиция заказа — отдельная строка.
    # Legacy-партии (order_item_id IS NULL) дают одну строку с item_id=NULL и берут
    # имя/кол-во из шапки заказа.
    rows = (await db.execute(text("""
        SELECT o.id,
               otk.order_item_id AS order_item_id,
               COALESCE(oi.product_name, o.product_name) AS product_name,
               COALESCE(oi.planned_qty, o.planned_qty) AS planned_qty,
               o.status,
               json_agg(json_build_object(
                 'batch_id', otk.batch_id, 'good_qty', otk.good_qty,
                 'shipped_qty', COALESCE(otk.shipped_qty,0),
                 'remaining_qty', otk.good_qty - COALESCE(otk.shipped_qty,0),
                 'status', otk.status
               )) as batches
        FROM orders o
        JOIN otk_batches otk ON otk.order_id = o.id
        LEFT JOIN order_items oi ON oi.id = otk.order_item_id
        WHERE otk.status = 'готово к отгрузке'
          AND NOT EXISTS (
              SELECT 1 FROM otk_batches b
              WHERE b.order_id = o.id
                AND b.status = 'брак'
                AND b.order_item_id IS NOT DISTINCT FROM otk.order_item_id
          )
        GROUP BY o.id, otk.order_item_id, oi.product_name, oi.planned_qty,
                 o.product_name, o.planned_qty, o.status, o.created_at
        ORDER BY o.created_at DESC, otk.order_item_id
    """))).mappings().all()
    return list(rows)


@router.post("/otk/ship-partial")
async def ship_partial(body: ShipPartialRequest, request: Request):
    # Отгрузку выполняют: оператор отгрузки, руководители, либо любой с production.edit
    u = _user(request)
    if u.role not in ("admin", "manager", "operator_shipment") and not (u.user_permissions or {}).get("production.edit"):
        raise HTTPException(403, "Недостаточно прав для отгрузки")
    db = _db(request)
    shipped = []
    order_ids = set()
    for s in body.shipments:
        # FOR UPDATE: блокируем строку, чтобы параллельные частичные отгрузки
        # одной партии не перезаписали shipped_qty (read-then-write гонка).
        result = await db.execute(
            select(OtkBatch).where(OtkBatch.batch_id == s.batchId).with_for_update()
        )
        batch = result.scalar_one_or_none()
        if not batch:
            raise HTTPException(404, f"Партия {s.batchId} не найдена")
        if batch.status != "готово к отгрузке":
            raise HTTPException(400, f"Партия {s.batchId} не готова к отгрузке")
        # Позицию с незакрытым браком ИЛИ партией в СЦ ('Передан в СЦ') держим:
        # годную партию той же позиции не отгружаем, пока дефект не переделают/спишут.
        # Скоуп по позиции (order_item_id) — брак в одной позиции не блокирует другие.
        if batch.order_id:
            hold = (await db.execute(text(
                "SELECT 1 FROM otk_batches WHERE order_id=:oid "
                "AND order_item_id IS NOT DISTINCT FROM :iid "
                "AND status IN ('брак','Передан в СЦ') LIMIT 1"
            ), {"oid": batch.order_id, "iid": batch.order_item_id})).scalar_one_or_none()
            if hold:
                raise HTTPException(
                    400, f"Заказ №{batch.order_id}: по этой позиции есть незакрытый брак/ремонт (СЦ) — "
                         "отгрузка заблокирована, пока дефект не переделают или не спишут")
        good = int(batch.good_qty)
        already = int(batch.shipped_qty or 0)
        remaining = good - already
        if s.qty > remaining:
            raise HTTPException(400, f"Нельзя отгрузить {s.qty} из {s.batchId}. Доступно: {remaining}")
        new_shipped = already + s.qty
        is_full = new_shipped >= good
        update_vals: dict = {"shipped_qty": new_shipped, "shipper_id": s.shipperId}
        if s.invoiceNumber:
            update_vals["invoice_number"] = s.invoiceNumber
        if s.recipient:
            update_vals["recipient"] = s.recipient
        if is_full:
            update_vals["status"] = "отгружено"
            update_vals["ship_date"] = func.now()
        await db.execute(
            update(OtkBatch).where(OtkBatch.batch_id == s.batchId).values(**update_vals)
        )
        shipped.append({"batchId": s.batchId, "qty": s.qty,
                        "remainingQty": good - new_shipped, "isFullyShipped": is_full})
        if batch.order_id:
            order_ids.add(batch.order_id)
    for oid in order_ids:
        from app.services.order_status import auto_update_order_status
        await auto_update_order_status(db, oid)
    await db.commit()
    return {"success": True, "shippedBatches": shipped}


# ── Reports ───────────────────────────────────────────────────────────────────

@router.get("/otk/reports")
async def reports(request: Request, date_from: Optional[str] = None, date_to: Optional[str] = None):
    _perm(request, "otk.view")
    db = _db(request)
    df = date_from or datetime.utcnow().replace(day=1).strftime("%Y-%m-%d")
    dt = date_to or datetime.utcnow().strftime("%Y-%m-%d")
    q = (
        select(OtkBatch)
        .where(OtkBatch.status != "Принята", OtkBatch.check_date.isnot(None))
        .where(func.date(OtkBatch.check_date) >= df)
        .where(func.date(OtkBatch.check_date) <= dt)
        .order_by(OtkBatch.check_date.desc())
    )
    result = await db.execute(q)
    batches_objs = result.scalars().all()
    batches = []
    for b in batches_objs:
        d = _m(b)
        if b.maker_id:
            maker = (await db.execute(text(
                "SELECT name FROM operators WHERE employee_id=:e"
            ), {"e": b.maker_id})).scalar_one_or_none()
            d["maker_name"] = maker
        else:
            d["maker_name"] = None
        batches.append(d)
    total_good = sum(int(b["good_qty"] or 0) for b in batches)
    total_defect = sum(int(b["defect_qty"] or 0) for b in batches)
    total = total_good + total_defect
    return {
        "date_from": df, "date_to": dt,
        "summary": {"total_batches": len(batches), "total_good": total_good,
                    "total_defect": total_defect,
                    "quality_rate": round(100 * total_good / total) if total else 100},
        "batches": batches,
    }


@router.delete("/otk/reports/batch/{batch_id}")
async def delete_report_batch(batch_id: str, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    result = await db.execute(
        select(OtkBatch.id, OtkBatch.status).where(OtkBatch.batch_id == batch_id))
    row = result.first()
    if not row:
        raise HTTPException(404, "Партия не найдена")
    oid, status = row[0], row[1]
    # Нельзя стирать историю качества уже проверенной/отгруженной/бракованной партии
    # (как в delete_batch): удаление допустимо только для непроверенной «Принята».
    if status != "Принята":
        raise HTTPException(
            400, f"Партию в статусе «{status}» удалить нельзя — это уничтожит историю ОТК/брака/ремонта")
    await db.execute(delete(DefectRecordModel).where(DefectRecordModel.otk_batch_id == oid))
    await db.execute(delete(ScRepair).where(ScRepair.otk_batch_id == oid))
    await db.execute(delete(OtkBatch).where(OtkBatch.batch_id == batch_id))
    await db.commit()
    return {"success": True}


# ── Defect types ──────────────────────────────────────────────────────────────

DEFECT_TYPES_FALLBACK = [
    {"id": 1, "category": "Компоновка", "subdescription": "Отсутствие компонента"},
    {"id": 2, "category": "Компоновка", "subdescription": "Неверный компонент"},
    {"id": 3, "category": "Пайка (мало)", "subdescription": "Непропай"},
    {"id": 4, "category": "Пайка (много)", "subdescription": "Избыток припоя"},
    {"id": 5, "category": "Мосты", "subdescription": "Слипшиеся ножки"},
    {"id": 6, "category": "Полярность", "subdescription": "Неверная постановка ключа"},
    {"id": 7, "category": "Механика", "subdescription": "Повреждение компонента"},
    {"id": 8, "category": "Прошивка", "subdescription": "Не прошивается"},
    {"id": 9, "category": "Связь", "subdescription": "Не биндится"},
]


@router.get("/otk/defect-types")
async def defect_types(request: Request):
    _perm(request, "otk.view")
    db = _db(request)
    try:
        result = await db.execute(
            select(OtkDefectType).order_by(OtkDefectType.sort_order, OtkDefectType.category, OtkDefectType.id)
        )
        rows = result.scalars().all()
        return [_m(r) for r in rows] if rows else DEFECT_TYPES_FALLBACK
    except Exception:
        logger.exception("Не удалось загрузить типы дефектов из БД, используется fallback")
        return DEFECT_TYPES_FALLBACK


@router.get("/otk/defect-categories")
async def defect_categories(request: Request):
    _perm(request, "otk.view")
    db = _db(request)
    try:
        result = await db.execute(
            select(DefectCategory)
            .where(DefectCategory.is_active == True)
            .order_by(DefectCategory.name)
        )
        return [_m(r) for r in result.scalars().all()]
    except Exception:
        logger.exception("Запрос справочника ОТК не выполнен")
        return []


# ── Regulations ───────────────────────────────────────────────────────────────

@router.get("/otk/regulations/products")
async def regulation_products(request: Request):
    _perm(request, "otk.view")
    db = _db(request)
    rows = (await db.execute(text(
        "SELECT DISTINCT product_name FROM recipes WHERE product_name IS NOT NULL ORDER BY product_name"
    ))).all()
    return [r[0] for r in rows]


@router.get("/otk/regulations/problems")
async def regulation_problems(request: Request, product: Optional[str] = None):
    _perm(request, "otk.view")
    db = _db(request)
    q = select(OtkRegulationProblem).order_by(
        OtkRegulationProblem.product_name, OtkRegulationProblem.sort_order, OtkRegulationProblem.id
    )
    if product:
        q = q.where(func.lower(func.trim(OtkRegulationProblem.product_name)) == product.strip().lower())
    try:
        result = await db.execute(q)
        return [_m(r) for r in result.scalars().all()]
    except Exception:
        logger.exception("Запрос справочника ОТК не выполнен")
        return []


@router.post("/otk/regulations/problems", status_code=201)
async def create_problem(body: RegulationProblem, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    max_sort = (await db.execute(
        select(func.max(OtkRegulationProblem.sort_order))
        .where(func.lower(func.trim(OtkRegulationProblem.product_name)) == body.product_name.strip().lower())
    )).scalar_one_or_none()
    item = OtkRegulationProblem(
        product_name=body.product_name.strip(), problem=body.problem.strip(),
        solution=body.solution.strip(), sort_order=(max_sort + 1) if max_sort is not None else 0,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    await db.commit()
    return _m(item)


@router.put("/otk/regulations/problems/{item_id}")
async def update_problem(item_id: int, body: RegulationProblem, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    stmt = (
        update(OtkRegulationProblem)
        .where(OtkRegulationProblem.id == item_id)
        .values(problem=body.problem.strip(), solution=body.solution.strip(), updated_at=func.now())
        .returning(OtkRegulationProblem)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row: raise HTTPException(404, "Запись не найдена")
    await db.commit()
    return dict(row)


@router.delete("/otk/regulations/problems/{item_id}")
async def delete_problem(item_id: int, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    await db.execute(delete(OtkRegulationProblem).where(OtkRegulationProblem.id == item_id))
    await db.commit()
    return {"success": True}


@router.get("/otk/regulations/measurements")
async def regulation_measurements(request: Request, product: Optional[str] = None):
    _perm(request, "otk.view")
    db = _db(request)
    q = select(OtkRegulationMeasurement).order_by(
        OtkRegulationMeasurement.sort_order, OtkRegulationMeasurement.id
    )
    if product:
        q = q.where(func.lower(func.trim(OtkRegulationMeasurement.product_name)) == product.strip().lower())
    try:
        result = await db.execute(q)
        return [_m(r) for r in result.scalars().all()]
    except Exception:
        logger.exception("Запрос справочника ОТК не выполнен")
        return []


@router.post("/otk/regulations/measurements", status_code=201)
async def create_measurement(body: RegulationMeasurement, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    item = OtkRegulationMeasurement(
        product_name=body.product_name.strip(), point_name=body.point_name.strip(),
        expected_value=body.expected_value, unit=body.unit, comment=body.comment,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    await db.commit()
    return _m(item)


@router.delete("/otk/regulations/measurements/{item_id}")
async def delete_measurement(item_id: int, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    await db.execute(delete(OtkRegulationMeasurement).where(OtkRegulationMeasurement.id == item_id))
    await db.commit()
    return {"success": True}


@router.get("/otk/regulations/replacements")
async def regulation_replacements(request: Request, product: Optional[str] = None):
    _perm(request, "otk.view")
    db = _db(request)
    q = select(OtkRegulationReplacement).order_by(
        OtkRegulationReplacement.sort_order, OtkRegulationReplacement.id
    )
    if product:
        q = q.where(func.lower(func.trim(OtkRegulationReplacement.product_name)) == product.strip().lower())
    try:
        result = await db.execute(q)
        return [_m(r) for r in result.scalars().all()]
    except Exception:
        logger.exception("Запрос справочника ОТК не выполнен")
        return []


@router.post("/otk/regulations/replacements", status_code=201)
async def create_replacement(body: RegulationReplacement, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    item = OtkRegulationReplacement(
        product_name=body.product_name.strip(),
        original_component=body.original_component.strip(),
        replacement=body.replacement.strip(), comment=body.comment,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    await db.commit()
    return _m(item)


@router.delete("/otk/regulations/replacements/{item_id}")
async def delete_replacement(item_id: int, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    await db.execute(delete(OtkRegulationReplacement).where(OtkRegulationReplacement.id == item_id))
    await db.commit()
    return {"success": True}


@router.get("/otk/regulations/tools")
async def regulation_tools(request: Request, product: Optional[str] = None):
    _perm(request, "otk.view")
    db = _db(request)
    q = select(OtkRegulationTool).order_by(OtkRegulationTool.sort_order, OtkRegulationTool.id)
    if product:
        q = q.where(func.lower(func.trim(OtkRegulationTool.product_name)) == product.strip().lower())
    try:
        result = await db.execute(q)
        return [_m(r) for r in result.scalars().all()]
    except Exception:
        logger.exception("Запрос справочника ОТК не выполнен")
        return []


@router.post("/otk/regulations/tools", status_code=201)
async def create_tool(body: RegulationTool, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    item = OtkRegulationTool(
        product_name=body.product_name.strip(),
        tool_name=body.tool_name.strip(), comment=body.comment,
    )
    db.add(item)
    await db.flush()
    await db.refresh(item)
    await db.commit()
    return _m(item)


@router.delete("/otk/regulations/tools/{item_id}")
async def delete_tool(item_id: int, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    await db.execute(delete(OtkRegulationTool).where(OtkRegulationTool.id == item_id))
    await db.commit()
    return {"success": True}
