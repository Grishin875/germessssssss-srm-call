import logging
from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, delete, func, text

from app.models.admin import Operator, Suggestion, ShiftChecklist

router = APIRouter()
logger = logging.getLogger(__name__)


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

def _m(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}


# ── Users public endpoints ────────────────────────────────────────────────────

@router.get("/users/rating/top")
async def rating_top(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(text("""
        SELECT u.id, u.username, u.full_name, u.photo_url, u.birth_date,
               COUNT(DISTINCT o.id) as completed_orders_count
        FROM users u
        LEFT JOIN operators op ON op.name = COALESCE(u.full_name, u.username)
        LEFT JOIN production_batch_operators pbo ON pbo.operator_id = op.employee_id
        LEFT JOIN production_batches pb ON pb.batch_id = pbo.batch_id
        LEFT JOIN orders o ON o.id = pb.order_id AND o.status IN ('Завершен','Передан на ОТК')
        WHERE u.is_active = true
        GROUP BY u.id, u.username, u.full_name, u.photo_url, u.birth_date
        ORDER BY completed_orders_count DESC LIMIT 3
    """))).mappings().all()
    return list(rows)


@router.get("/users/birthdays/today")
async def birthdays_today(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(text("""
        SELECT id, username, full_name, photo_url, birth_date,
               EXTRACT(YEAR FROM AGE(birth_date)) as age
        FROM users
        WHERE is_active=true AND birth_date IS NOT NULL
          AND EXTRACT(MONTH FROM birth_date)=EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY FROM birth_date)=EXTRACT(DAY FROM CURRENT_DATE)
        ORDER BY full_name
    """))).mappings().all()
    return list(rows)


@router.put("/users/{user_id}/photo")
async def update_photo(user_id: int, request: Request):
    u = _user(request)
    if u.id != user_id and u.role != "admin":
        raise HTTPException(403, "Недостаточно прав")
    db = _db(request)
    body = await request.json()
    row = (await db.execute(text("""
        UPDATE users SET photo_url=:url WHERE id=:id
        RETURNING id, username, full_name, photo_url
    """), {"url": body.get("photo_url"), "id": user_id})).mappings().one_or_none()
    if not row: raise HTTPException(404, "Пользователь не найден")
    await db.commit()
    return dict(row)


@router.get("/users/{user_id}/profile")
async def user_profile(user_id: int, request: Request):
    _user(request)
    db = _db(request)
    row = (await db.execute(text("""
        SELECT id, username, full_name, photo_url, birth_date, email, phone, role, created_at
        FROM users WHERE id=:id AND is_active=true
    """), {"id": user_id})).mappings().one_or_none()
    if not row: raise HTTPException(404, "Пользователь не найден")
    user = dict(row)
    cnt = (await db.execute(text("""
        SELECT COUNT(DISTINCT o.id) as cnt FROM users u
        LEFT JOIN operators op ON op.name=COALESCE(u.full_name,u.username)
        LEFT JOIN production_batch_operators pbo ON pbo.operator_id=op.employee_id
        LEFT JOIN production_batches pb ON pb.batch_id=pbo.batch_id
        LEFT JOIN orders o ON o.id=pb.order_id AND o.status IN ('Завершен','Передан на ОТК')
        WHERE u.id=:id GROUP BY u.id
    """), {"id": user_id})).scalar_one_or_none()
    user["completed_orders_count"] = int(cnt or 0)
    return user


# ── Activity ──────────────────────────────────────────────────────────────────

@router.get("/activity")
async def list_activity(request: Request, limit: int = 50, offset: int = 0):
    _perm(request, "production.view")
    db = _db(request)
    rows = (await db.execute(text("""
        SELECT * FROM operations
        ORDER BY operation_date DESC, id DESC
        LIMIT :lim OFFSET :off
    """), {"lim": limit, "off": offset})).mappings().all()
    return list(rows)


# ── Suggestions ───────────────────────────────────────────────────────────────

@router.get("/suggestions")
async def list_suggestions(request: Request):
    _user(request)
    db = _db(request)
    try:
        result = await db.execute(
            select(Suggestion).order_by(Suggestion.created_at.desc())
        )
        suggestions = result.scalars().all()
        rows = []
        for s in suggestions:
            d = _m(s)
            author = (await db.execute(text(
                "SELECT full_name FROM users WHERE id=:id"
            ), {"id": s.user_id})).scalar_one_or_none() if s.user_id else None
            d["author_name"] = author
            rows.append(d)
        return rows
    except Exception:
        logger.exception("Запрос списка не выполнен")
        return []


@router.post("/suggestions", status_code=201)
async def create_suggestion(request: Request):
    u = _user(request)
    db = _db(request)
    body = await request.json()
    try:
        suggestion = Suggestion(
            title=body.get("title", ""),
            description=body.get("description", ""),
            category=body.get("category"),
            user_id=u.id,
        )
        db.add(suggestion)
        await db.flush()
        await db.refresh(suggestion)
        await db.commit()
        return _m(suggestion)
    except Exception as e:
        raise HTTPException(500, str(e))


# ── Shift checklist ───────────────────────────────────────────────────────────

@router.get("/shift-checklist")
async def list_checklist(request: Request):
    _user(request)
    db = _db(request)
    try:
        result = await db.execute(
            select(ShiftChecklist).order_by(ShiftChecklist.sort_order, ShiftChecklist.id)
        )
        return [_m(item) for item in result.scalars().all()]
    except Exception:
        logger.exception("Запрос списка не выполнен")
        return []


@router.post("/shift-checklist", status_code=201)
async def create_checklist_item(request: Request):
    _perm(request, "checklist.manage")
    db = _db(request)
    body = await request.json()
    try:
        item = ShiftChecklist(
            title=body.get("title", ""),
            category=body.get("category"),
            sort_order=body.get("sort_order", 0),
        )
        db.add(item)
        await db.flush()
        await db.refresh(item)
        await db.commit()
        return _m(item)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.delete("/shift-checklist/{item_id}")
async def delete_checklist_item(item_id: int, request: Request):
    _perm(request, "checklist.manage")
    db = _db(request)
    await db.execute(delete(ShiftChecklist).where(ShiftChecklist.id == item_id))
    await db.commit()
    return {"success": True}
