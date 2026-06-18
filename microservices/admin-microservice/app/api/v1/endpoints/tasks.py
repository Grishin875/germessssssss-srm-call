from typing import Optional
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, update, delete, func, text

from app.models.admin import Operator, ProductionTask
from app.schemas.admin import TaskCreate

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


@router.get("/tasks")
async def list_tasks(request: Request):
    _perm(request, "tasks.view")
    db = _db(request)
    # Complex JOIN with users/operators kept as text()
    rows = (await db.execute(text("""
        SELECT t.*,
               u1.full_name as created_by_name,
               u2.full_name as completed_by_name,
               op.name as assigned_operator_name
        FROM production_tasks t
        LEFT JOIN users u1 ON t.created_by=u1.id
        LEFT JOIN users u2 ON t.completed_by=u2.id
        LEFT JOIN operators op ON t.assigned_operator_id=op.employee_id
        WHERE t.status='pending'
           OR (t.status='completed' AND t.completed_at > NOW() - INTERVAL '7 days')
        ORDER BY
            CASE t.status WHEN 'pending' THEN 0 ELSE 1 END,
            CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            t.created_at DESC
    """))).mappings().all()
    return list(rows)


@router.post("/tasks", status_code=201)
async def create_task(body: TaskCreate, request: Request):
    _perm(request, "tasks.manage")
    u = _user(request)
    db = _db(request)
    if not body.title.strip():
        raise HTTPException(400, "Укажите название задачи")
    task = ProductionTask(
        title=body.title.strip(),
        description=body.description.strip(),
        priority=body.priority,
        assigned_operator_id=body.assigned_operator_id,
        created_by=u.id,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    await db.commit()
    return _m(task)


@router.put("/tasks/{task_id}/complete")
async def complete_task(task_id: int, request: Request):
    _perm(request, "tasks.manage")
    u = _user(request)
    db = _db(request)
    stmt = (
        update(ProductionTask)
        .where(ProductionTask.id == task_id)
        .values(status="completed", completed_by=u.id, completed_at=func.now(), updated_at=func.now())
        .returning(ProductionTask)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row: raise HTTPException(404, "Задача не найдена")
    await db.commit()
    return dict(row)


@router.put("/tasks/{task_id}/reopen")
async def reopen_task(task_id: int, request: Request):
    _perm(request, "tasks.manage")
    db = _db(request)
    stmt = (
        update(ProductionTask)
        .where(ProductionTask.id == task_id)
        .values(status="pending", completed_by=None, completed_at=None, updated_at=func.now())
        .returning(ProductionTask)
    )
    row = (await db.execute(stmt)).mappings().one_or_none()
    if not row: raise HTTPException(404, "Задача не найдена")
    await db.commit()
    return dict(row)


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, request: Request):
    _perm(request, "tasks.manage")
    db = _db(request)
    await db.execute(delete(ProductionTask).where(ProductionTask.id == task_id))
    await db.commit()
    return {"success": True}
