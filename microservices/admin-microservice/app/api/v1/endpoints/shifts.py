import logging
from typing import Optional, List
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, delete, func, text

from app.models.admin import Operator, ShiftSchedule
from app.schemas.admin import ShiftCreate, ShiftUpdate, ShiftCompleteRequest, BulkShiftsRequest

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


async def _get_operator_for_user(db, user) -> Optional[str]:
    name = getattr(user, "full_name", None) or user.username
    result = await db.execute(
        select(Operator.employee_id).where(Operator.name == name).limit(1)
    )
    return result.scalar_one_or_none()


async def _shift_transition_error(db, shift_id, emp_id):
    """Различаем 404 (нет смены/не ваша) и 409 (недопустимый переход статуса)."""
    cur = (await db.execute(
        select(ShiftSchedule.status).where(
            ShiftSchedule.id == shift_id, ShiftSchedule.operator_id == emp_id)
    )).scalar_one_or_none()
    if cur is None:
        raise HTTPException(404, "Смена не найдена или не принадлежит вам")
    raise HTTPException(409, f"Недопустимый переход из статуса «{cur}»")


def _time_to_min(t: Optional[str]) -> Optional[int]:
    """'HH:MM' → минуты от полуночи; None при пустом/невалидном."""
    if not t:
        return None
    try:
        hh, mm = str(t).split(":")[:2]
        return int(hh) * 60 + int(mm)
    except (ValueError, TypeError):
        return None


def _windows_overlap(s1, e1, s2, e2) -> bool:
    """Пересекаются ли два временных окна [s,e) в минутах. Ночная смена (e<=s)
    нормализуется как +24ч."""
    if e1 <= s1:
        e1 += 24 * 60
    if e2 <= s2:
        e2 += 24 * 60
    return s1 < e2 and s2 < e1


async def _assert_no_shift_overlap(db, operator_id, shift_date, start_time, end_time,
                                   exclude_id=None):
    """Проверка занятости оператора. Если у новой и существующей смены заданы времена —
    проверяем ПЕРЕСЕЧЕНИЕ окон (несколько непересекающихся смен в день разрешены);
    иначе (времена не заданы) — старое правило «одна смена на дату»."""
    rows = (await db.execute(
        select(ShiftSchedule.id, ShiftSchedule.start_time, ShiftSchedule.end_time)
        .where(ShiftSchedule.operator_id == operator_id,
               ShiftSchedule.shift_date == shift_date,
               ShiftSchedule.status != "Отменена")
    )).all()
    ns, ne = _time_to_min(start_time), _time_to_min(end_time)
    for rid, est, eet in rows:
        if exclude_id is not None and rid == exclude_id:
            continue
        es, ee = _time_to_min(est), _time_to_min(eet)
        if None in (ns, ne, es, ee):
            # Времена не полностью заданы — консервативно: одна смена на дату.
            raise ValueError("У оператора уже есть смена на эту дату")
        if _windows_overlap(ns, ne, es, ee):
            raise ValueError("Пересечение по времени с существующей сменой оператора")


@router.get("/shifts")
async def list_shifts(request: Request, start_date: Optional[str] = None, end_date: Optional[str] = None,
                      operator_id: Optional[str] = None, department: Optional[str] = None,
                      shift_type: Optional[str] = None, status: Optional[str] = None):
    _perm(request, "shift_schedule.view")
    db = _db(request)
    q = select(ShiftSchedule)
    if start_date:
        q = q.where(ShiftSchedule.shift_date >= start_date)
    if end_date:
        q = q.where(ShiftSchedule.shift_date <= end_date)
    if operator_id:
        q = q.where(ShiftSchedule.operator_id == operator_id)
    if department:
        q = q.where(ShiftSchedule.department == department)
    if shift_type:
        q = q.where(ShiftSchedule.shift_type == shift_type)
    if status:
        q = q.where(ShiftSchedule.status == status)
    q = q.order_by(ShiftSchedule.shift_date.desc())
    try:
        result = await db.execute(q)
        shifts = result.scalars().all()
        # JOIN operator name via text for display
        rows = []
        for s in shifts:
            d = _m(s)
            op = (await db.execute(
                select(Operator.name).where(Operator.employee_id == s.operator_id)
            )).scalar_one_or_none()
            d["operator_name"] = op
            rows.append(d)
        return rows
    except Exception:
        logger.exception("Запрос списка смен не выполнен")
        return []


@router.get("/shifts/my-shifts")
async def my_shifts(request: Request, start_date: Optional[str] = None, end_date: Optional[str] = None):
    _perm(request, "shift_schedule.view")
    db = _db(request)
    u = _user(request)
    emp_id = await _get_operator_for_user(db, u)
    if not emp_id: return []
    q = select(ShiftSchedule).where(ShiftSchedule.operator_id == emp_id)
    if start_date:
        q = q.where(ShiftSchedule.shift_date >= start_date)
    if end_date:
        q = q.where(ShiftSchedule.shift_date <= end_date)
    q = q.order_by(ShiftSchedule.shift_date.desc())
    result = await db.execute(q)
    shifts = result.scalars().all()
    rows = []
    for s in shifts:
        d = _m(s)
        op = (await db.execute(
            select(Operator.name).where(Operator.employee_id == s.operator_id)
        )).scalar_one_or_none()
        d["operator_name"] = op
        rows.append(d)
    return rows


@router.get("/shifts/report")
async def shifts_report(request: Request, start_date: str, end_date: str):
    _perm(request, "shift_schedule.view")
    db = _db(request)
    rows = (await db.execute(text("""
        SELECT s.*, o.name as operator_name, o.role as operator_role
        FROM shift_schedule s
        LEFT JOIN operators o ON s.operator_id=o.employee_id
        WHERE s.shift_date >= :sd AND s.shift_date <= :ed
        ORDER BY s.shift_date ASC, o.name ASC
    """), {"sd": start_date, "ed": end_date})).mappings().all()
    by_emp: dict = {}
    for s in rows:
        eid = s["operator_id"]
        if eid not in by_emp:
            by_emp[eid] = {"employee_id": eid, "employee_name": s["operator_name"] or eid,
                           "employee_role": s["operator_role"] or "", "shifts": [], "total_hours": 0, "total_shifts": 0}
        ah = float(s["actual_hours"] or 0)
        by_emp[eid]["shifts"].append(dict(s))
        by_emp[eid]["total_hours"] += ah
        if s["status"] == "Выполнена":
            by_emp[eid]["total_shifts"] += 1
    return {"period": {"start_date": start_date, "end_date": end_date}, "employees": list(by_emp.values())}


@router.post("/shifts", status_code=201)
async def create_shift(body: ShiftCreate, request: Request):
    _perm(request, "shift_schedule.edit")
    db = _db(request)
    u = _user(request)
    op = (await db.execute(
        select(Operator.employee_id).where(Operator.employee_id == body.operator_id)
    )).scalar_one_or_none()
    if not op: raise HTTPException(400, "Оператор не найден")
    try:
        await _assert_no_shift_overlap(db, body.operator_id, body.shift_date,
                                       body.start_time, body.end_time)
    except ValueError as e:
        raise HTTPException(400, str(e))
    shift = ShiftSchedule(
        shift_date=body.shift_date, shift_type=body.shift_type, start_time=body.start_time,
        end_time=body.end_time, operator_id=body.operator_id, department=body.department,
        comment=body.comment, created_by=u.id, status="Запланирована",
    )
    db.add(shift)
    await db.flush()
    await db.refresh(shift)
    await db.commit()
    return {"success": True, "shift": _m(shift)}


@router.post("/shifts/bulk", status_code=201)
async def bulk_shifts(body: BulkShiftsRequest, request: Request):
    _perm(request, "shift_schedule.edit")
    db = _db(request)
    u = _user(request)
    created, errors = [], []
    for s in body.shifts:
        try:
            # SAVEPOINT на строку: ошибка БД одной строки не валит остальные
            # (иначе сессия уходит в pending-rollback и «травит» валидные строки).
            async with db.begin_nested():
                op = (await db.execute(
                    select(Operator.employee_id).where(Operator.employee_id == s.operator_id)
                )).scalar_one_or_none()
                if not op: raise ValueError(f"Оператор {s.operator_id} не найден")
                await _assert_no_shift_overlap(db, s.operator_id, s.shift_date,
                                               s.start_time, s.end_time)
                shift = ShiftSchedule(
                    shift_date=s.shift_date, shift_type=s.shift_type, start_time=s.start_time,
                    end_time=s.end_time, operator_id=s.operator_id, department=s.department,
                    comment=s.comment, created_by=u.id, status="Запланирована",
                )
                db.add(shift)
                await db.flush()
                await db.refresh(shift)
                row = _m(shift)
            created.append(row)
        except Exception as ex:
            errors.append({"shift": s.model_dump(), "error": str(ex)})
    await db.commit()
    return {"success": True, "created": len(created), "shifts": created, "errors": errors or None}


@router.put("/shifts/{shift_id}")
async def update_shift(shift_id: int, body: ShiftUpdate, request: Request):
    _perm(request, "shift_schedule.edit")
    db = _db(request)
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(400, "Нет данных для обновления")
    stmt = (
        update(ShiftSchedule)
        .where(ShiftSchedule.id == shift_id)
        .values(**update_data, updated_at=func.now())
        .returning(ShiftSchedule)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row: raise HTTPException(404, "Смена не найдена")
    await db.commit()
    return {"success": True, "shift": dict(row)}


@router.post("/shifts/{shift_id}/confirm")
async def confirm_shift(shift_id: int, request: Request):
    _perm(request, "shift_schedule.view")
    db = _db(request)
    u = _user(request)
    emp_id = await _get_operator_for_user(db, u)
    if not emp_id: raise HTTPException(403, "Вы не являетесь оператором")
    # Подтвердить можно только запланированную смену (не отменённую/выполненную).
    stmt = (
        update(ShiftSchedule)
        .where(ShiftSchedule.id == shift_id, ShiftSchedule.operator_id == emp_id,
               ShiftSchedule.status == "Запланирована")
        .values(status="Подтверждена", updated_at=func.now())
        .returning(ShiftSchedule)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row:
        await _shift_transition_error(db, shift_id, emp_id)
    await db.commit()
    return {"success": True, "shift": dict(row)}


@router.post("/shifts/{shift_id}/complete")
async def complete_shift(shift_id: int, body: ShiftCompleteRequest, request: Request):
    _perm(request, "shift_schedule.view")
    db = _db(request)
    u = _user(request)
    emp_id = await _get_operator_for_user(db, u)
    if not emp_id: raise HTTPException(403, "Вы не являетесь оператором")
    if body.actual_hours <= 0: raise HTTPException(400, "Укажите фактически отработанные часы")
    # Завершить можно только запланированную/подтверждённую смену (не отменённую/уже выполненную).
    stmt = (
        update(ShiftSchedule)
        .where(ShiftSchedule.id == shift_id, ShiftSchedule.operator_id == emp_id,
               ShiftSchedule.status.in_(["Запланирована", "Подтверждена"]))
        .values(status="Выполнена", actual_hours=body.actual_hours, updated_at=func.now())
        .returning(ShiftSchedule)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row:
        await _shift_transition_error(db, shift_id, emp_id)
    await db.commit()
    return {"success": True, "shift": dict(row)}


@router.delete("/shifts/{shift_id}")
async def delete_shift(shift_id: int, request: Request):
    _perm(request, "shift_schedule.edit")
    db = _db(request)
    stmt = delete(ShiftSchedule).where(ShiftSchedule.id == shift_id).returning(ShiftSchedule.id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if not row: raise HTTPException(404, "Смена не найдена")
    await db.commit()
    return {"success": True}


@router.delete("/shifts/operator/{operator_id}")
async def delete_operator_shifts(operator_id: str, request: Request,
                                  start_date: Optional[str] = None, end_date: Optional[str] = None):
    _perm(request, "shift_schedule.edit")
    db = _db(request)
    q = delete(ShiftSchedule).where(ShiftSchedule.operator_id == operator_id)
    if start_date:
        q = q.where(ShiftSchedule.shift_date >= start_date)
    if end_date:
        q = q.where(ShiftSchedule.shift_date <= end_date)
    result = await db.execute(q.returning(ShiftSchedule.id))
    deleted = result.all()
    await db.commit()
    return {"success": True, "deleted": len(deleted)}
