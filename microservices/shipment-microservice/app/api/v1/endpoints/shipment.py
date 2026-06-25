from typing import Optional, List
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, func, text
from pydantic import BaseModel, Field

# OtkBatch lives in otk-microservice, use text() for cross-service operations
from shared.core.notify import notify_managers
from shared.core.order_status import update_order_status

router = APIRouter()


def _db(r): return r.state.db
def _user(r):
    u = r.state.current_user
    if not u: raise HTTPException(401, "Не авторизован")
    return u
def _perm(r, p):
    u = _user(r)
    if u.role == "admin": return u
    if not (u.user_permissions or {}).get(p): raise HTTPException(403, f"Недостаточно прав: {p}")
    return u


class ShipmentItem(BaseModel):
    batchId: str
    qty: int = Field(gt=0)   # запрет 0/отрицательного: минус откатывал отгрузку в минус
    shipperId: str
    invoiceNumber: Optional[str] = None
    recipient: Optional[str] = None


class ShipPartialRequest(BaseModel):
    shipments: List[ShipmentItem]


# ── Ready to ship ─────────────────────────────────────────────────────────────

@router.get("/shipment/ready-to-ship")
async def ready_to_ship(request: Request):
    _perm(request, "otk.view")
    db = _db(request)
    # Группируем по (order_id, order_item_id) — каждая позиция заказа отдельной строкой.
    # Legacy-партии (order_item_id IS NULL) дают строку с item_id=NULL и берут
    # имя/кол-во из шапки заказа.
    rows = (await db.execute(text("""
        SELECT o.id,
               otk.order_item_id AS order_item_id,
               COALESCE(oi.product_name, o.product_name) AS product_name,
               COALESCE(oi.planned_qty, o.planned_qty) AS planned_qty,
               COALESCE(oi.actual_qty, o.actual_qty) AS actual_qty,
               o.status,
               json_agg(json_build_object(
                   'batch_id', otk.batch_id,
                   'product_name', otk.product_name,
                   'good_qty', otk.good_qty,
                   'shipped_qty', COALESCE(otk.shipped_qty, 0),
                   'remaining_qty', otk.good_qty - COALESCE(otk.shipped_qty, 0),
                   'check_date', otk.check_date,
                   'status', otk.status
               ) ORDER BY otk.check_date DESC) as batches
        FROM orders o
        JOIN otk_batches otk ON otk.order_id = o.id
        LEFT JOIN order_items oi ON oi.id = otk.order_item_id
        WHERE otk.status = 'готово к отгрузке'
           OR (otk.status = 'отгружено' AND COALESCE(otk.shipped_qty, 0) < otk.good_qty)
        GROUP BY o.id, otk.order_item_id, oi.product_name, oi.planned_qty, oi.actual_qty,
                 o.product_name, o.planned_qty, o.actual_qty, o.status, o.created_at
        ORDER BY o.created_at DESC, otk.order_item_id
    """))).mappings().all()

    result = []
    for row in rows:
        batches = row["batches"] if isinstance(row["batches"], list) else []
        batches = [b for b in batches if (b.get("good_qty", 0) - b.get("shipped_qty", 0)) > 0]
        if batches:
            result.append({**dict(row), "batches": batches})
    return result


@router.post("/shipment/ship-partial")
async def ship_partial(body: ShipPartialRequest, request: Request):
    u = _user(request)
    if u.role not in ("admin", "manager", "operator_shipment") and not (u.user_permissions or {}).get("production.edit"):
        raise HTTPException(403, "Недостаточно прав для отгрузки")
    db = _db(request)
    shipped_batches = []
    order_ids = set()

    for s in body.shipments:
        batch = (await db.execute(
            text("SELECT * FROM otk_batches WHERE batch_id=:b FOR UPDATE"), {"b": s.batchId}
        )).mappings().one_or_none()
        if not batch:
            raise HTTPException(404, f"Партия {s.batchId} не найдена")
        if batch["status"] != "готово к отгрузке":
            raise HTTPException(400, f"Партия {s.batchId} не готова к отгрузке (статус: {batch['status']})")

        # Зеркалим поведение otk-сервиса: нельзя отгружать заказ, у которого есть брак —
        # заказ на доработке, пока брак не переделают.
        if batch["order_id"]:
            has_brak = (await db.execute(
                text("SELECT 1 FROM otk_batches WHERE order_id=:oid AND status='брак'"),
                {"oid": batch["order_id"]},
            )).scalar()
            if has_brak:
                raise HTTPException(400, "нельзя отгружать: есть брак, заказ на доработке")

        good = int(batch["good_qty"])
        already = int(batch["shipped_qty"] or 0)
        remaining = good - already
        if s.qty > remaining:
            raise HTTPException(400, f"Нельзя отгрузить {s.qty} из {s.batchId}. Доступно: {remaining}")

        new_shipped = already + s.qty
        is_full = new_shipped >= good

        op_exists = (await db.execute(
            text("SELECT 1 FROM operators WHERE employee_id=:e"), {"e": s.shipperId}
        )).scalar_one_or_none()
        shipper_id = s.shipperId if op_exists else None

        if is_full:
            await db.execute(text("""
                UPDATE otk_batches
                SET shipped_qty=:sq, status='отгружено', ship_date=NOW(), shipper_id=:sid,
                    invoice_number=:inv, recipient=:recip
                WHERE batch_id=:b
            """), {"sq": new_shipped, "sid": shipper_id, "b": s.batchId, "inv": s.invoiceNumber, "recip": s.recipient})
        else:
            await db.execute(text("""
                UPDATE otk_batches SET shipped_qty=:sq, shipper_id=:sid, invoice_number=:inv, recipient=:recip WHERE batch_id=:b
            """), {"sq": new_shipped, "sid": shipper_id, "b": s.batchId, "inv": s.invoiceNumber, "recip": s.recipient})

        shipped_batches.append({
            "batchId": s.batchId, "qty": s.qty,
            "remainingQty": good - new_shipped, "isFullyShipped": is_full,
        })
        if batch["order_id"]:
            order_ids.add(batch["order_id"])

    # Статус заказа решает единая статус-машина: она учитывает партии «Принята»,
    # «Передан в СЦ» и не закрывает заказ преждевременно.
    for oid in order_ids:
        changed = await update_order_status(db, oid)
        if changed:
            row = (await db.execute(text(
                "SELECT status, product_name FROM orders WHERE id=:id"
            ), {"id": oid})).mappings().one_or_none()
            if row and row["status"] == "Завершен":
                await notify_managers(
                    db, f"Заказ №{oid} полностью отгружен и завершён",
                    row["product_name"] or "", link=f"/orders/{oid}", type_="success",
                )

    await db.commit()
    return {"success": True, "shippedBatches": shipped_batches,
            "message": f"Отгружено {len(shipped_batches)} партий"}


# ── Shipment history ──────────────────────────────────────────────────────────

@router.get("/shipment/history")
async def shipment_history(request: Request, date_from: Optional[str] = None,
                            date_to: Optional[str] = None, product_name: Optional[str] = None):
    _perm(request, "otk.view")
    db = _db(request)
    where, params = ["otk.status='отгружено'"], {}
    if date_from: where.append("DATE(otk.ship_date) >= :df"); params["df"] = date_from
    if date_to: where.append("DATE(otk.ship_date) <= :dt"); params["dt"] = date_to
    if product_name:
        where.append("LOWER(otk.product_name) LIKE :pn")
        params["pn"] = f"%{product_name.lower()}%"

    rows = (await db.execute(text(f"""
        SELECT otk.batch_id, otk.product_name, otk.good_qty,
               COALESCE(otk.shipped_qty, otk.good_qty) as shipped_qty,
               otk.ship_date, otk.check_date,
               op_ship.name as shipper_name,
               op_make.name as maker_name,
               ord.id as order_id,
               otk.invoice_number, otk.recipient
        FROM otk_batches otk
        LEFT JOIN operators op_ship ON otk.shipper_id=op_ship.employee_id
        LEFT JOIN operators op_make ON otk.maker_id=op_make.employee_id
        LEFT JOIN orders ord ON otk.order_id=ord.id
        WHERE {' AND '.join(where)}
        ORDER BY otk.ship_date DESC
    """), params)).mappings().all()
    return list(rows)


# ── Finished goods ────────────────────────────────────────────────────────────

@router.get("/shipment/finished-goods")
async def finished_goods(request: Request):
    _perm(request, "otk.view")
    db = _db(request)
    # available_qty = произведено − отгружено (good_qty в БД не уменьшается при отгрузке).
    rows = (await db.execute(text("""
        SELECT fg.*, COALESCE(s.shipped, 0) AS shipped_qty,
               GREATEST(COALESCE(fg.good_qty,0) - COALESCE(s.shipped,0), 0) AS available_qty
        FROM finished_goods fg
        LEFT JOIN (
            SELECT LOWER(TRIM(product_name)) AS pn, SUM(COALESCE(shipped_qty,0)) AS shipped
            FROM otk_batches GROUP BY LOWER(TRIM(product_name))
        ) s ON s.pn = LOWER(TRIM(fg.product_name))
        ORDER BY LOWER(fg.product_name)
    """))).mappings().all()
    return list(rows)
