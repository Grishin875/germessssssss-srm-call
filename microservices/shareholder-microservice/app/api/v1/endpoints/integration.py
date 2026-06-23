import hashlib, hmac, json
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException, Header
from sqlalchemy import select, delete, func, text

from app.models.shareholder import IntegrationNomenclatureMapping, IntegrationOrder
from app.schemas.integration import (
    OneCOrderWebhook, OneCStockWebhook, BitrixDealWebhook,
    ExportShipmentsRequest, NomenclatureMapping,
)
from app.services.integration_service import (
    ensure_tables, resolve_product_name, upsert_mapping,
    create_crm_order, register_integration_order,
)
from app.core.config import settings

router = APIRouter()


def _db(r): return r.state.db
def _user(r):
    u = r.state.current_user
    if not u: raise HTTPException(401, "Не авторизован")
    return u
def _admin(r):
    u = _user(r)
    if u.role != "admin": raise HTTPException(403, "Требуются права администратора")
    return u

def _m(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}


def _verify_hmac(secret: str, body: bytes, signature: str) -> bool:
    # Вебхуки публичные (без JWT): без настроенного секрета принимать их нельзя,
    # иначе любой внешний запрос сможет создавать заказы.
    if not secret:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")


# ── 1С webhooks ───────────────────────────────────────────────────────────────

@router.post("/integration/onec/orders")
async def onec_order_webhook(request: Request, x_signature: Optional[str] = Header(None)):
    """Принимает заказ из 1С и создаёт его в CRM."""
    body = await request.body()
    if not _verify_hmac(settings.ONEC_WEBHOOK_SECRET, body, x_signature or ""):
        raise HTTPException(403, "Неверная подпись запроса")

    data = OneCOrderWebhook.model_validate(await request.json())
    db = _db(request)

    result = await db.execute(
        select(IntegrationOrder.crm_order_id)
        .where(IntegrationOrder.source == "onec",
               IntegrationOrder.external_id == data.external_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return {"success": True, "crm_order_id": existing, "message": "Заказ уже существует"}

    # Заказ из 1С с N позициями → ОДИН заказ CRM с N позициями (order_items).
    comment_parts = []
    if data.client_name: comment_parts.append(f"Клиент: {data.client_name}")
    if data.order_number: comment_parts.append(f"Заказ 1С: {data.order_number}")
    if data.comment: comment_parts.append(data.comment)

    positions = []
    for item in data.items:
        product_name = await resolve_product_name(db, item.nomenclature_code, item.nomenclature_name)
        positions.append({"product_name": product_name, "qty": item.quantity})

    if not positions:
        raise HTTPException(400, "Заказ из 1С не содержит позиций")

    crm_id = await create_crm_order(
        db, positions, data.deadline, " | ".join(comment_parts) or None
    )
    # ext_id мапим на сам заказ 1С (external_id); ранее на каждую позицию заводился
    # отдельный заказ, теперь это один заказ.
    await register_integration_order(db, "onec", data.external_id, crm_id, data.model_dump())

    await db.commit()
    return {
        "success": True,
        "crm_order_id": crm_id,
        "positions": positions,
    }


@router.post("/integration/onec/stock")
async def onec_stock_webhook(request: Request, x_signature: Optional[str] = Header(None)):
    """Синхронизирует остатки склада из 1С."""
    body = await request.body()
    if not _verify_hmac(settings.ONEC_WEBHOOK_SECRET, body, x_signature or ""):
        raise HTTPException(403, "Неверная подпись запроса")

    data = OneCStockWebhook.model_validate(await request.json())
    db = _db(request)

    updated, created = 0, 0
    for item in data.items:
        product_name = await resolve_product_name(db, item.code, item.name)
        existing = (await db.execute(text(
            "SELECT id FROM warehouse_components WHERE LOWER(TRIM(name))=LOWER(TRIM(:n))"
        ), {"n": product_name})).scalar_one_or_none()
        if existing:
            await db.execute(text("""
                UPDATE warehouse_components SET stock=:qty, updated_at=NOW()
                WHERE LOWER(TRIM(name))=LOWER(TRIM(:n))
            """), {"qty": item.quantity or 0, "n": product_name})
            updated += 1
        else:
            await db.execute(text("""
                INSERT INTO warehouse_components (name, stock, category, unit)
                VALUES (:n, :qty, 'Из 1С', :u)
                ON CONFLICT (name) DO UPDATE SET stock=:qty, updated_at=NOW()
            """), {"n": product_name, "qty": item.quantity or 0, "u": item.unit or "шт"})
            created += 1

    await db.commit()
    return {"success": True, "updated": updated, "created": created}


# ── Bitrix24 webhooks ─────────────────────────────────────────────────────────

@router.post("/integration/bitrix/deals")
async def bitrix_deal_webhook(request: Request, x_signature: Optional[str] = Header(None)):
    """Принимает сделку из Битрикс24 и создаёт заказ в CRM."""
    body = await request.body()
    if not _verify_hmac(settings.BITRIX_WEBHOOK_SECRET, body, x_signature or ""):
        raise HTTPException(403, "Неверная подпись запроса")

    data = BitrixDealWebhook.model_validate(await request.json())
    db = _db(request)

    result = await db.execute(
        select(IntegrationOrder.crm_order_id)
        .where(IntegrationOrder.source == "bitrix",
               IntegrationOrder.external_id == data.deal_id)
    )
    existing = result.scalar_one_or_none()
    if existing:
        return {"success": True, "crm_order_id": existing, "message": "Сделка уже обработана"}

    product_name = data.product_name or data.title
    comment_parts = [f"Битрикс сделка #{data.deal_id}"]
    if data.responsible_name: comment_parts.append(f"Ответственный: {data.responsible_name}")
    if data.comment: comment_parts.append(data.comment)

    # Битрикс остаётся одной позицией (один order_items).
    crm_id = await create_crm_order(
        db, [{"product_name": product_name, "qty": data.quantity or 1}],
        data.deadline, " | ".join(comment_parts)
    )
    await register_integration_order(db, "bitrix", data.deal_id, crm_id, data.model_dump())
    await db.commit()
    return {"success": True, "crm_order_id": crm_id, "product_name": product_name}


# ── Export to 1С ──────────────────────────────────────────────────────────────

@router.post("/integration/onec/export/shipments")
async def export_shipments(body: ExportShipmentsRequest, request: Request):
    """Экспортирует данные об отгрузках для 1С."""
    _admin(request)
    db = _db(request)
    where, params = ["otk.status='отгружено'"], {}
    if body.date_from: where.append("DATE(otk.ship_date) >= :df"); params["df"] = body.date_from
    if body.date_to: where.append("DATE(otk.ship_date) <= :dt"); params["dt"] = body.date_to

    rows = (await db.execute(text(f"""
        SELECT otk.batch_id, otk.product_name, otk.good_qty as shipped_qty,
               otk.ship_date, o.name as shipper_name,
               ord.id as order_id
        FROM otk_batches otk
        LEFT JOIN operators o ON otk.shipper_id=o.employee_id
        LEFT JOIN orders ord ON otk.order_id=ord.id
        WHERE {' AND '.join(where)}
        ORDER BY otk.ship_date DESC
    """), params)).mappings().all()

    return {
        "export_date": datetime.utcnow().isoformat(),
        "shipments": [dict(r) for r in rows],
        "total": len(rows),
    }


@router.get("/integration/onec/export/stock")
async def export_stock(request: Request):
    """Экспортирует текущие остатки склада для 1С."""
    _admin(request)
    db = _db(request)
    rows = (await db.execute(text("""
        SELECT name, stock, category, unit, updated_at
        FROM warehouse_components
        ORDER BY LOWER(name)
    """))).mappings().all()
    return {
        "export_date": datetime.utcnow().isoformat(),
        "stock": [dict(r) for r in rows],
        "total": len(rows),
    }


# ── Nomenclature mapping CRUD ─────────────────────────────────────────────────

@router.get("/integration/mappings")
async def list_mappings(request: Request):
    _admin(request)
    db = _db(request)
    result = await db.execute(
        select(IntegrationNomenclatureMapping)
        .order_by(IntegrationNomenclatureMapping.onec_name)
    )
    return [_m(r) for r in result.scalars().all()]


@router.post("/integration/mappings", status_code=201)
async def create_mapping(body: NomenclatureMapping, request: Request):
    _admin(request)
    db = _db(request)
    await upsert_mapping(db, body.onec_code, body.onec_name, body.crm_product_name)
    await db.commit()
    return {"success": True}


@router.delete("/integration/mappings/{onec_code}")
async def delete_mapping(onec_code: str, request: Request):
    _admin(request)
    db = _db(request)
    await db.execute(
        delete(IntegrationNomenclatureMapping)
        .where(IntegrationNomenclatureMapping.onec_code == onec_code)
    )
    await db.commit()
    return {"success": True}


# ── Integration orders log ────────────────────────────────────────────────────

@router.get("/integration/orders")
async def list_integration_orders(request: Request, source: Optional[str] = None, limit: int = 100):
    _admin(request)
    db = _db(request)
    q = select(IntegrationOrder).order_by(IntegrationOrder.created_at.desc()).limit(limit)
    if source:
        q = q.where(IntegrationOrder.source == source)
    result = await db.execute(q)
    orders = result.scalars().all()
    rows = []
    for o in orders:
        d = _m(o)
        if o.crm_order_id:
            crm = (await db.execute(text(
                "SELECT product_name, status FROM orders WHERE id=:id"
            ), {"id": o.crm_order_id})).mappings().one_or_none()
            d["product_name"] = crm["product_name"] if crm else None
            d["crm_status"] = crm["status"] if crm else None
        else:
            d["product_name"] = None
            d["crm_status"] = None
        rows.append(d)
    return rows
