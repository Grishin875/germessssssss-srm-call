from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, delete, func, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.admin import Operator
from app.schemas.admin import OperatorCreate, OperatorUpdate

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

def _m(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}


@router.get("/operators")
async def list_operators(request: Request, active_only: str = "0"):
    _perm(request, "production.view")
    db = _db(request)
    if active_only in ("1", "true"):
        rows = (await db.execute(text("""
            SELECT op.* FROM operators op
            WHERE EXISTS (
                SELECT 1 FROM users u WHERE u.is_active=true
                AND (u.full_name=op.name OR u.username=op.name)
            ) ORDER BY op.name
        """))).mappings().all()
        return list(rows)
    result = await db.execute(select(Operator).order_by(Operator.name))
    return [_m(op) for op in result.scalars().all()]


@router.get("/operators/stats")
async def operators_stats(request: Request, period: str = "all"):
    _perm(request, "production.view")
    db = _db(request)
    date_filter = {
        "day": "AND pb.start_date >= CURRENT_DATE",
        "week": "AND pb.start_date >= CURRENT_DATE - INTERVAL '7 days'",
        "month": "AND pb.start_date >= DATE_TRUNC('month', CURRENT_DATE)",
        "year": "AND pb.start_date >= DATE_TRUNC('year', CURRENT_DATE)",
    }.get(period, "")
    rows = (await db.execute(text(f"""
        SELECT op.employee_id, op.name, op.role,
            COUNT(DISTINCT pb.batch_id) as batches_count,
            COALESCE(SUM(COALESCE(pb.actual_qty, pb.planned_qty)), 0) as total_produced,
            COUNT(DISTINCT CASE WHEN pb.status IN ('Завершена','Готов к проверке ОТК') THEN pb.batch_id END) as completed_batches,
            COUNT(DISTINCT CASE WHEN o.status IN ('Завершен','Передан на ОТК') THEN o.id END) as completed_orders_count
        FROM operators op
        LEFT JOIN production_batch_operators pbo ON op.employee_id = pbo.operator_id
        LEFT JOIN production_batches pb ON pbo.batch_id = pb.batch_id {date_filter}
        LEFT JOIN orders o ON pb.order_id = o.id AND o.status IN ('Завершен','Передан на ОТК')
        GROUP BY op.employee_id, op.name, op.role
        ORDER BY completed_orders_count DESC, batches_count DESC
    """))).mappings().all()
    return list(rows)


@router.get("/operators/role/{role}")
async def operators_by_role(role: str, request: Request):
    _perm(request, "production.view")
    result = await _db(request).execute(
        select(Operator).where(Operator.role == role).order_by(Operator.name)
    )
    return [_m(op) for op in result.scalars().all()]


@router.get("/operators/{employee_id}/stats")
async def operator_stats(employee_id: str, request: Request, period: str = "all"):
    _perm(request, "production.view")
    db = _db(request)
    result = await db.execute(select(Operator).where(Operator.employee_id == employee_id))
    op = result.scalar_one_or_none()
    if not op: raise HTTPException(404, "Оператор не найден")
    date_filter = {
        "day": "AND pb.start_date >= CURRENT_DATE",
        "week": "AND pb.start_date >= CURRENT_DATE - INTERVAL '7 days'",
        "month": "AND pb.start_date >= DATE_TRUNC('month', CURRENT_DATE)",
        "year": "AND pb.start_date >= DATE_TRUNC('year', CURRENT_DATE)",
    }.get(period, "")
    general = (await db.execute(text(f"""
        SELECT COUNT(DISTINCT pb.batch_id) as batches_count,
            COALESCE(SUM(COALESCE(pb.actual_qty,pb.planned_qty)),0) as total_produced,
            COUNT(DISTINCT CASE WHEN pb.status IN ('Завершена','Готов к проверке ОТК') THEN pb.batch_id END) as completed_batches,
            COUNT(DISTINCT CASE WHEN o.status IN ('Завершен','Передан на ОТК') THEN o.id END) as completed_orders_count
        FROM production_batch_operators pbo
        JOIN production_batches pb ON pbo.batch_id=pb.batch_id {date_filter}
        LEFT JOIN orders o ON pb.order_id=o.id
        WHERE pbo.operator_id=:e
    """), {"e": employee_id})).mappings().one()
    by_type = (await db.execute(text(f"""
        SELECT pb.production_type,
            COUNT(DISTINCT pb.batch_id) as batches_count,
            COALESCE(SUM(COALESCE(pb.actual_qty,pb.planned_qty)),0) as total_produced
        FROM production_batch_operators pbo
        JOIN production_batches pb ON pbo.batch_id=pb.batch_id {date_filter}
        WHERE pbo.operator_id=:e
        GROUP BY pb.production_type ORDER BY batches_count DESC
    """), {"e": employee_id})).mappings().all()
    otk = (await db.execute(text("""
        SELECT COALESCE(SUM(otk.good_qty),0) as total_good,
            COALESCE(SUM(otk.defect_qty),0) as total_defect,
            COUNT(*) as otk_batches_count
        FROM otk_batches otk
        JOIN production_batches pb ON otk.source_batch_id=pb.batch_id
        JOIN production_batch_operators pbo ON pb.batch_id=pbo.batch_id
        WHERE pbo.operator_id=:e
    """), {"e": employee_id})).mappings().one()
    return {"operator": _m(op), "general": dict(general), "production_types": list(by_type), "otk": dict(otk)}


@router.post("/operators", status_code=201)
async def create_operator(body: OperatorCreate, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    stmt = (
        pg_insert(Operator)
        .values(name=body.name.strip(), role=body.role.strip(), employee_id=body.employee_id.strip())
        .on_conflict_do_update(
            index_elements=["employee_id"],
            set_={"name": body.name.strip(), "role": body.role.strip()}
        )
        .returning(Operator)
    )
    row = (await db.execute(stmt)).mappings().one()
    await db.commit()
    return dict(row)


@router.put("/operators/{op_id}")
async def update_operator(op_id: int, body: OperatorUpdate, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    stmt = (
        update(Operator)
        .where(Operator.id == op_id)
        .values(name=body.name.strip(), role=body.role.strip(),
                employee_id=body.employee_id.strip(), updated_at=func.now())
        .returning(Operator)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row: raise HTTPException(404, "Оператор не найден")
    await db.commit()
    return dict(row)


@router.delete("/operators/{op_id}")
async def delete_operator(op_id: int, request: Request):
    _perm(request, "production.edit")
    db = _db(request)
    stmt = delete(Operator).where(Operator.id == op_id).returning(Operator.id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row: raise HTTPException(404, "Оператор не найден")
    await db.commit()
    return {"success": True}
