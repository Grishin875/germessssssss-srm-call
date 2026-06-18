"""
Сервис-центр (СЦ).

Партии на ремонт — это otk_batches со статусом «Передан в СЦ» (создаются в otk_check
при частичном браке). Завершение ремонта возвращает партию на повторную проверку ОТК
(статус «Принята»), журнал ремонтов хранится в sc_repairs.
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update, text, func

from app.models.otk import OtkBatch, ScRepair
from app.services.order_status import auto_update_order_status

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


class RepairItem(BaseModel):
    defect_type: Optional[str] = None
    defect_description: Optional[str] = None
    original_qty: Optional[int] = 0
    fixed_qty: int = 0
    comment: Optional[str] = None


class CompleteRepairRequest(BaseModel):
    batchId: str
    operatorId: Optional[str] = None
    repairedItems: List[RepairItem] = []
    comment: Optional[str] = None


async def _completed_repairs(db, order_id: Optional[int] = None) -> list:
    where = "WHERE otk.order_id = :oid" if order_id is not None else ""
    params = {"oid": order_id} if order_id is not None else {}
    rows = (await db.execute(text(f"""
        SELECT r.id, otk.batch_id, otk.product_name, otk.production_type,
               r.repaired_qty, r.repaired_qty AS qty, otk.order_id,
               r.operator_id, op.name AS operator_name,
               r.created_at, r.comment, r.items_json,
               'Отремонтировано' AS status
        FROM sc_repairs r
        JOIN otk_batches otk ON otk.id = r.otk_batch_id
        LEFT JOIN operators op ON op.employee_id = r.operator_id
        {where}
        ORDER BY r.created_at DESC
    """), params)).mappings().all()
    result = []
    for r in rows:
        d = dict(r)
        try:
            d["repaired_items"] = json.loads(d.pop("items_json") or "[]")
        except Exception:
            d["repaired_items"] = []
        result.append(d)
    return result


@router.get("/sc/batches")
async def sc_batches(request: Request, status: Optional[str] = "pending"):
    """Партии СЦ. status=pending — ждут ремонта, status=completed — журнал ремонтов."""
    _perm(request, "sc.view")
    db = _db(request)
    if status == "completed":
        return await _completed_repairs(db)
    rows = (await db.execute(text("""
        SELECT otk.batch_id, otk.product_name, otk.production_type,
               otk.defect_qty AS qty, otk.defect_qty, otk.status, otk.order_id,
               otk.maker_id AS operator_id, op.name AS operator_name,
               otk.created_at, otk.defect_comment AS comment
        FROM otk_batches otk
        LEFT JOIN operators op ON op.employee_id = otk.maker_id
        WHERE otk.status = 'Передан в СЦ'
        ORDER BY otk.created_at DESC
    """))).mappings().all()
    return [dict(r) for r in rows]


@router.get("/sc/history")
async def sc_history(request: Request):
    _perm(request, "sc.view")
    return await _completed_repairs(_db(request))


@router.get("/sc/repairs-by-order/{order_id}")
async def sc_repairs_by_order(order_id: int, request: Request):
    _perm(request, "sc.view")
    return await _completed_repairs(_db(request), order_id=order_id)


@router.post("/sc/complete-repair")
async def complete_repair(body: CompleteRepairRequest, request: Request):
    u = _perm(request, "sc.view")
    db = _db(request)

    batch = (await db.execute(
        select(OtkBatch).where(OtkBatch.batch_id == body.batchId)
    )).scalar_one_or_none()
    if not batch:
        raise HTTPException(404, f"Партия {body.batchId} не найдена")
    if batch.status != "Передан в СЦ":
        raise HTTPException(400, f"Партия не в ремонте (статус: {batch.status})")

    repaired = sum(max(0, int(i.fixed_qty or 0)) for i in body.repairedItems)
    defect_total = int(batch.defect_qty or 0)
    if repaired <= 0:
        raise HTTPException(400, "Укажите исправленное количество")
    if repaired > defect_total:
        raise HTTPException(400, f"Исправлено {repaired}, но в партии брака только {defect_total}")

    db.add(ScRepair(
        otk_batch_id=batch.id,
        operator_id=body.operatorId or str(u.id),
        repaired_qty=repaired,
        comment=body.comment,
        items_json=json.dumps([i.model_dump() for i in body.repairedItems], ensure_ascii=False),
    ))

    scrap = defect_total - repaired
    note = f"После ремонта СЦ: исправлено {repaired} шт."
    if scrap > 0:
        note += f", не подлежит ремонту {scrap} шт."
    new_comment = f"{batch.defect_comment} | {note}" if batch.defect_comment else note

    # Возврат на повторную проверку ОТК: released_qty = отремонтированное количество
    await db.execute(
        update(OtkBatch)
        .where(OtkBatch.id == batch.id, OtkBatch.status == "Передан в СЦ")
        .values(status="Принята", released_qty=repaired, good_qty=0, defect_qty=0,
                receive_date=func.now(), check_date=None, defect_comment=new_comment)
    )

    if batch.order_id:
        await auto_update_order_status(db, batch.order_id)
    await db.commit()
    return {"success": True,
            "message": f"Ремонт завершён: {repaired} шт. отправлено на повторную проверку ОТК"}
