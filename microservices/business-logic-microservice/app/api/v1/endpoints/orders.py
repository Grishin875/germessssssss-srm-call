"""
Orders + Production batches endpoints.
Mirrors routes/orders.js and routes/production.js
"""
import csv, io, logging, time, random, string, re
from typing import Optional, List
from datetime import datetime
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update, delete, func, text, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from pydantic import BaseModel

import json
from app.models.business import Order, ProductionBatch, ProductionBatchOperator, ProductionDailyProgress, OrderStage, OrderComment, CustomFieldDefinition, CustomFieldValue, StageAssignee, StageRouteTemplate
from app.services.canonical_route import (
    build_canonical_stages, QC_GATES, FINISHED_GOODS_STAGES, CANONICAL_STAGE_LABELS,
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


# Статусы, означающие завершение заказа — ставить может только руководитель/админ
CLOSING_STATUSES = {"Завершен", "Завершён"}


def _order_managers(order) -> list:
    """Список id руководителей проекта (JSON в колонке managers)."""
    try:
        raw = getattr(order, "managers", None)
        return [str(m) for m in (json.loads(raw) if raw else [])]
    except Exception:
        return []


def _is_order_manager(user, order) -> bool:
    """Руководитель заказа = admin/manager по роли ИЛИ назначен руководителем проекта."""
    if getattr(user, "role", None) in ("admin", "manager"):
        return True
    return str(user.id) in _order_managers(order)


async def _audit(db, user, entity_type: str, entity_id, action: str,
                 old_value: str = None, new_value: str = None, details: str = None):
    """Write an audit log entry to audit_log (admin-service table, accessed via text())."""
    try:
        uname = getattr(user, "full_name", None) or getattr(user, "username", str(user.id))
        await db.execute(text("""
            INSERT INTO audit_log (entity_type, entity_id, user_id, user_name, action,
                                   old_value, new_value, details)
            VALUES (:et, :eid, :uid, :uname, :act, :old, :new, :det)
        """), {
            "et": entity_type, "eid": entity_id, "uid": user.id, "uname": uname,
            "act": action, "old": old_value, "new": new_value, "det": details,
        })
    except Exception:
        # audit must never break the main flow
        logger.exception("audit log failed (%s %s #%s)", action, entity_type, entity_id)


async def _fire_webhooks(db, event: str, payload: dict):
    """Отправить исходящие webhooks, подписанные на событие. Best-effort:
    ошибки не ломают основной поток. Таблица webhooks — общая БД (admin-сервис)."""
    try:
        rows = (await db.execute(text(
            "SELECT id, url, events, secret FROM webhooks WHERE is_active = true"
        ))).mappings().all()
    except Exception:
        return
    if not rows:
        return
    import httpx, hashlib, hmac as _hmac
    body = json.dumps({"event": event, "data": payload}, ensure_ascii=False)
    for wh in rows:
        try:
            events = json.loads(wh["events"] or "[]")
        except Exception:
            events = []
        if events and event not in events:
            continue
        headers = {"Content-Type": "application/json", "X-Germess-Event": event}
        if wh["secret"]:
            sig = _hmac.new(wh["secret"].encode(), body.encode(), hashlib.sha256).hexdigest()
            headers["X-Germess-Signature"] = sig
        status = "ok"
        try:
            async with httpx.AsyncClient(timeout=6) as client:
                resp = await client.post(wh["url"], content=body.encode(), headers=headers)
                status = str(resp.status_code)
        except Exception as e:
            status = f"error: {str(e)[:60]}"
        try:
            await db.execute(text(
                "UPDATE webhooks SET last_status=:s, last_called_at=NOW() WHERE id=:id"
            ), {"s": status, "id": wh["id"]})
        except Exception:
            pass


def _op_id(prefix: str) -> str:
    return f"{prefix}-{int(time.time()*1000)}-{''.join(random.choices(string.ascii_lowercase,k=6))}"


_STAGE_TO_PRODUCTION_TYPE: dict[str, str] = {
    "smd": "SMD",
    "assembly": "Сборка",
    "3d_print": "3D Печать",
    "engraving": "Гравировка",
}

def _component_matches_stage(source: str, stage_type: str, production_type: str = "") -> bool:
    """Match component to stage type.
    If production_type is set (new-style components), match exactly.
    Otherwise fall back to source-based heuristic.
    """
    if production_type:
        return _STAGE_TO_PRODUCTION_TYPE.get(stage_type) == production_type
    mapping = {
        "smd": ["warehouse", "smd"],
        "assembly": ["warehouse", "smd", "3d_print", "purchase", "case"],
        "3d_print": ["3d_print", "purchase"],
        "engraving": ["warehouse", "engraving"],
        "warehouse": ["warehouse"],
    }
    return source in mapping.get(stage_type, ["warehouse"])


def _norm(s: str) -> str:
    return s.strip().lower()


def _initial_stage_status(sort_order: int, min_sort: int, depends_on_previous) -> str:
    """Начальный статус этапа при генерации.
    Первый уровень (min sort_order) — всегда активен (pending).
    Последующие — blocked, если зависят от предыдущего; иначе сразу pending.
    """
    if sort_order <= min_sort:
        return "pending"
    dep = depends_on_previous if depends_on_previous is not None else 1
    return "blocked" if dep else "pending"

def _m(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}


# Какие комплектующие (по типу этапа рецептуры) показывать на каноническом этапе
_CANONICAL_STAGE_COMPS = {
    "warehouse_smd": "smd",
    "smd":           "smd",
    "engraving":     "engraving",
    "warehouse_rea": "assembly",
    "issue_rea":     "assembly",
    "assembly":      "assembly",
}


async def _resolve_product_flags(db, product_name: str, body) -> dict:
    """Признаки маршрута изделия: из product_catalog, с переопределением из тела запроса."""
    row = (await db.execute(text("""
        SELECT COALESCE(needs_smd, true)       AS needs_smd,
               COALESCE(is_receiver, false)    AS is_receiver,
               COALESCE(needs_assembly, true)  AS needs_assembly
        FROM product_catalog WHERE LOWER(TRIM(name)) = :pn
    """), {"pn": _norm(product_name)})).mappings().one_or_none()
    flags = {
        "needs_smd": True if row is None else bool(row["needs_smd"]),
        "is_receiver": False if row is None else bool(row["is_receiver"]),
        "needs_assembly": True if row is None else bool(row["needs_assembly"]),
    }
    for k in ("needs_smd", "is_receiver", "needs_assembly"):
        ov = getattr(body, k, None)
        if ov is not None:
            flags[k] = bool(ov)
    return flags


async def _add_canonical_stages(db, order_id: int, flags: dict, stage_comps: list) -> int:
    """Создать этапы канонического маршрута (ТЗ) для заказа. Возвращает их число."""
    stages = build_canonical_stages(
        needs_smd=flags["needs_smd"], is_receiver=flags["is_receiver"],
        needs_assembly=flags["needs_assembly"],
    )
    min_sort = min((s["sort_order"] for s in stages), default=0)
    for s in stages:
        comp_match = _CANONICAL_STAGE_COMPS.get(s["stage_type"])
        comps = [
            c for c in stage_comps
            if _component_matches_stage(c.get("source", "warehouse"), comp_match, c.get("production_type", ""))
        ] if comp_match else []
        db.add(OrderStage(
            order_id=order_id,
            stage_type=s["stage_type"],
            stage_name=s["stage_name"],
            status=_initial_stage_status(s["sort_order"], min_sort, s["depends_on_previous"]),
            sort_order=s["sort_order"],
            required_role=s["required_role"],
            depends_on_previous=s["depends_on_previous"],
            rework_target_type=s["rework_target_type"],
            instructions=s["instructions"],
            components_json=json.dumps(comps, ensure_ascii=False),
        ))
    return len(stages)


# ── Schemas ──────────────────────────────────────────────────────────────────

class ExtraStage(BaseModel):
    stage_type: str
    stage_name: str
    assigned_user_id: Optional[str] = None
    sort_order: Optional[int] = None
    depends_on_previous: Optional[int] = 1
    required_role: Optional[str] = None
    components: Optional[List[str]] = []  # имена комплектующих для этапа


class Position(BaseModel):
    """Позиция комплектации заказа (для Excel-документа)."""
    name: str
    qty: Optional[int] = None


class OrderCreate(BaseModel):
    product_name: str
    planned_qty: int
    positions: Optional[List[Position]] = None   # комплектация — список позиций для Excel
    received_date: Optional[str] = None          # дата получения
    shipment_date: Optional[str] = None          # дата отправки
    assigned_operator_id: Optional[str] = None
    priority: str = "Обычный"
    deadline: Optional[str] = None
    comment: Optional[str] = None
    assigned_department: Optional[str] = None
    stage_assignments: Optional[dict] = None  # {stage_id: user_id}
    extra_stages: Optional[List[ExtraStage]] = None  # pipeline после основных этапов
    skipped_stage_ids: Optional[List[int]] = None  # id этапов рецептуры, пропущенных в этом заказе
    # Канонический маршрут по ТЗ (12 этапов). Если включён — этапы строятся
    # генератором по признакам изделия вместо этапов рецептуры.
    use_canonical_route: Optional[bool] = False
    needs_smd: Optional[bool] = None        # переопределение признаков изделия для этого заказа
    is_receiver: Optional[bool] = None
    needs_assembly: Optional[bool] = None
    managers: Optional[List[str]] = None    # id руководителей проекта


class OrderUpdate(BaseModel):
    product_name: Optional[str] = None
    planned_qty: Optional[int] = None
    assigned_operator_id: Optional[str] = None
    priority: Optional[str] = None
    deadline: Optional[str] = None
    comment: Optional[str] = None
    status: Optional[str] = None
    assigned_department: Optional[str] = None
    otk_comment: Optional[str] = None
    tags: Optional[str] = None
    managers: Optional[List[str]] = None    # id руководителей проекта
    positions: Optional[List[Position]] = None   # комплектация — список позиций для Excel
    received_date: Optional[str] = None          # дата получения
    shipment_date: Optional[str] = None          # дата отправки


class SubmitOtkRequest(BaseModel):
    photo_url: Optional[str] = None


class StartBatchRequest(BaseModel):
    operatorIds: Optional[List[str]] = None
    line_number: Optional[str] = None
    mounting_operator_number: Optional[str] = None


class CompleteRequest(BaseModel):
    batchId: str
    actualQty: int = 0


class PauseRequest(BaseModel):
    batchId: str
    qtyProduced: int
    comment: Optional[str] = None


class DailyProgressRequest(BaseModel):
    batch_id: str
    production_date: str
    qty_produced: int
    comment: Optional[str] = None


# ── Orders ───────────────────────────────────────────────────────────────────

@router.get("/orders")
async def list_orders(request: Request, status: Optional[str] = None,
                      include_statuses: Optional[str] = None, search: Optional[str] = None,
                      cf_field: Optional[int] = None, cf_value: Optional[str] = None):
    _perm(request, "orders.view")
    db = _db(request)
    q = select(Order)
    if include_statuses:
        statuses = include_statuses.split(",")
        q = q.where(Order.status.in_(statuses))
    elif status:
        q = q.where(Order.status == status)
    else:
        q = q.where(Order.status == "Создан")
    if search:
        q = q.where(or_(
            func.cast(Order.id, text("TEXT")).like(f"%{search}%"),
            func.lower(Order.product_name).like(f"%{search.lower()}%")
        ))
    # Фильтр по значению кастомного поля
    if cf_field and cf_value:
        sub = (
            select(CustomFieldValue.order_id)
            .where(CustomFieldValue.field_id == cf_field,
                   func.lower(func.cast(CustomFieldValue.value, text("TEXT")))
                   .like(f"%{cf_value.lower()}%"))
        )
        q = q.where(Order.id.in_(sub))
    q = q.order_by(Order.created_at.desc())
    result = await db.execute(q)
    orders = result.scalars().all()
    if not orders:
        return []
    order_ids = [o.id for o in orders]
    # Прогресс этапов (#14): done / total по каждому заказу — одним запросом
    progress_rows = (await db.execute(text("""
        SELECT order_id,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status='done') AS done
        FROM order_stages WHERE order_id = ANY(:ids)
        GROUP BY order_id
    """), {"ids": order_ids})).mappings().all()
    progress = {r["order_id"]: {"total": int(r["total"]), "done": int(r["done"])} for r in progress_rows}
    # Имена операторов одним запросом
    op_ids = [o.assigned_operator_id for o in orders if o.assigned_operator_id]
    op_names = {}
    if op_ids:
        op_names = {r["employee_id"]: r["name"] for r in (await db.execute(text(
            "SELECT employee_id, name FROM operators WHERE employee_id = ANY(:ids)"
        ), {"ids": op_ids})).mappings().all()}
    rows = []
    for o in orders:
        d = _m(o)
        try:
            d["positions"] = json.loads(o.positions) if o.positions else []
        except Exception:
            d["positions"] = []
        d["assigned_operator_name"] = op_names.get(o.assigned_operator_id) if o.assigned_operator_id else None
        d["managers"] = _order_managers(o)
        pr = progress.get(o.id, {"total": 0, "done": 0})
        d["stages_total"] = pr["total"]
        d["stages_done"] = pr["done"]
        rows.append(d)
    return rows


@router.get("/my-stages")
async def my_stages(request: Request):
    u = _user(request)
    db = _db(request)
    # Этап «мой», если я в assigned_to ИЛИ добавлен исполнителем в stage_assignees
    my_assignee_stage_ids = (
        select(StageAssignee.stage_id)
        .where(StageAssignee.user_id == u.id, StageAssignee.status != "cancelled")
    )
    result = await db.execute(
        select(OrderStage, Order.product_name, Order.planned_qty, Order.deadline, Order.id)
        .join(Order, Order.id == OrderStage.order_id)
        .where(
            or_(OrderStage.assigned_to == str(u.id),
                OrderStage.id.in_(my_assignee_stage_ids)),
            OrderStage.status.in_(["pending", "in_progress"]),
            Order.status.not_in(["Завершен", "Завершён", "Отменен", "Отменён", "Ожидает компонентов"])
        )
        .order_by(Order.deadline.asc().nullslast(), OrderStage.sort_order)
    )
    out = []
    for row in result.all():
        stage = row[0]
        d = _m(stage)
        d["components"] = stage.components
        d["order_product_name"] = row[1]
        d["order_planned_qty"] = row[2]
        d["order_deadline"] = str(row[3]) if row[3] else None
        sa = (await db.execute(
            select(StageAssignee).where(
                StageAssignee.stage_id == stage.id, StageAssignee.user_id == u.id)
        )).scalar_one_or_none()
        d["my_assignee"] = _m(sa) if sa else None
        out.append(d)
    return out


@router.get("/my-orders")
async def my_orders(request: Request):
    u = _user(request)
    db = _db(request)
    my_assignee_stage_ids = (
        select(StageAssignee.stage_id)
        .where(StageAssignee.user_id == u.id, StageAssignee.status != "cancelled")
    )
    order_ids_result = await db.execute(
        select(OrderStage.order_id)
        .where(
            or_(OrderStage.assigned_to == str(u.id),
                OrderStage.id.in_(my_assignee_stage_ids)),
            OrderStage.status != "done",
        )
        .distinct()
    )
    order_ids = [r[0] for r in order_ids_result.all()]
    if not order_ids:
        return []
    orders_result = await db.execute(
        select(Order)
        .where(
            Order.id.in_(order_ids),
            Order.status.not_in(["Завершен", "Завершён", "Отменен", "Отменён", "Ожидает компонентов"])
        )
        .order_by(Order.deadline.asc().nullslast(), Order.created_at.desc())
    )
    orders = orders_result.scalars().all()
    out = []
    for o in orders:
        d = _m(o)
        stages_result = await db.execute(
            select(OrderStage)
            .where(OrderStage.order_id == o.id,
                   or_(OrderStage.assigned_to == str(u.id),
                       OrderStage.id.in_(my_assignee_stage_ids)))
            .order_by(OrderStage.sort_order)
        )
        my_stages_for_order = stages_result.scalars().all()
        d["my_stages"] = [{**_m(s), "components": s.components} for s in my_stages_for_order]
        out.append(d)
    return out


@router.get("/orders/analytics/summary")
async def orders_analytics_summary(request: Request):
    """KPI и срезы для дашборда: выполнено за день/неделю/месяц, по статусам,
    по приоритету, по отделам, среднее время цикла (часы)."""
    _perm(request, "orders.view")
    db = _db(request)

    async def _scalar(sql: str, params: dict | None = None) -> int:
        return int((await db.execute(text(sql), params or {})).scalar() or 0)

    completed_today = await _scalar(
        "SELECT COUNT(*) FROM orders WHERE status IN ('Завершен','Завершён','Выполнен') "
        "AND updated_at >= date_trunc('day', NOW())")
    completed_week = await _scalar(
        "SELECT COUNT(*) FROM orders WHERE status IN ('Завершен','Завершён','Выполнен') "
        "AND updated_at >= date_trunc('week', NOW())")
    completed_month = await _scalar(
        "SELECT COUNT(*) FROM orders WHERE status IN ('Завершен','Завершён','Выполнен') "
        "AND updated_at >= date_trunc('month', NOW())")
    created_today = await _scalar(
        "SELECT COUNT(*) FROM orders WHERE created_at >= date_trunc('day', NOW())")
    active_total = await _scalar(
        "SELECT COUNT(*) FROM orders WHERE status NOT IN "
        "('Завершен','Завершён','Выполнен','Отменен','Отменён')")
    overdue = await _scalar(
        "SELECT COUNT(*) FROM orders WHERE deadline ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' "
        "AND deadline::date < CURRENT_DATE "
        "AND status NOT IN ('Завершен','Завершён','Выполнен','Отменен','Отменён')")

    by_status = (await db.execute(text(
        "SELECT status, COUNT(*) AS c FROM orders WHERE status NOT IN "
        "('Завершен','Завершён','Выполнен','Отменен','Отменён') "
        "GROUP BY status ORDER BY c DESC"))).mappings().all()
    by_dept = (await db.execute(text(
        "SELECT assigned_department AS d, COUNT(*) AS c FROM orders "
        "WHERE assigned_department IS NOT NULL AND assigned_department <> '' "
        "GROUP BY assigned_department ORDER BY c DESC LIMIT 10"))).mappings().all()

    # Среднее время цикла (часы) по завершённым за месяц
    avg_cycle = (await db.execute(text(
        "SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600.0) "
        "FROM orders WHERE status IN ('Завершен','Завершён','Выполнен') "
        "AND updated_at >= NOW() - INTERVAL '30 days'"))).scalar()

    # Тренд завершений за 14 дней
    trend = (await db.execute(text(
        "SELECT to_char(date_trunc('day', updated_at), 'YYYY-MM-DD') AS day, COUNT(*) AS c "
        "FROM orders WHERE status IN ('Завершен','Завершён','Выполнен') "
        "AND updated_at >= NOW() - INTERVAL '14 days' "
        "GROUP BY day ORDER BY day"))).mappings().all()

    return {
        "kpi": {
            "completed_today": completed_today,
            "completed_week": completed_week,
            "completed_month": completed_month,
            "created_today": created_today,
            "active_total": active_total,
            "overdue": overdue,
            "avg_cycle_hours": round(float(avg_cycle), 1) if avg_cycle else None,
        },
        "by_status": [{"label": r["status"], "value": int(r["c"])} for r in by_status],
        "by_department": [{"label": r["d"], "value": int(r["c"])} for r in by_dept],
        "completion_trend": [{"day": r["day"], "value": int(r["c"])} for r in trend],
    }


@router.get("/orders/export")
async def export_orders(request: Request, status: Optional[str] = None,
                        search: Optional[str] = None, fmt: str = "csv"):
    """Экспорт заказов в CSV."""
    _perm(request, "orders.view")
    db = _db(request)
    q = select(Order).order_by(Order.created_at.desc())
    if status:
        q = q.where(Order.status == status)
    if search:
        q = q.where(or_(
            func.cast(Order.id, text("TEXT")).like(f"%{search}%"),
            func.lower(Order.product_name).like(f"%{search.lower()}%")
        ))
    orders = (await db.execute(q)).scalars().all()

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["ID", "Изделие", "Количество", "Фактически", "Статус", "Приоритет", "Срок", "Отдел", "Создан", "Обновлён", "Комментарий"])
    for o in orders:
        writer.writerow([
            o.id, o.product_name, o.planned_qty, o.actual_qty or 0,
            o.status, o.priority or "", o.deadline or "",
            o.assigned_department or "",
            o.created_at.strftime("%Y-%m-%d %H:%M") if o.created_at else "",
            o.updated_at.strftime("%Y-%m-%d %H:%M") if o.updated_at else "",
            (o.comment or "").replace("\n", " "),
        ])
    output.seek(0)
    filename = f"orders_{datetime.utcnow().strftime('%Y%m%d_%H%M')}.csv"
    return StreamingResponse(
        iter([output.getvalue().encode("utf-8-sig")]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/orders/archive")
async def archive_orders(request: Request, search: Optional[str] = None,
                         start_date: Optional[str] = None, end_date: Optional[str] = None):
    _perm(request, "archive.view")
    db = _db(request)
    q = select(Order).where(Order.status.in_(["На проверке ОТК", "Готов к передаче на ОТК", "Завершен"]))
    if search:
        q = q.where(or_(
            func.cast(Order.id, text("TEXT")).like(f"%{search}%"),
            func.lower(Order.product_name).like(f"%{search.lower()}%")
        ))
    if start_date:
        q = q.where(func.date(Order.updated_at) >= start_date)
    if end_date:
        q = q.where(func.date(Order.updated_at) <= end_date)
    q = q.order_by(Order.updated_at.desc())
    result = await db.execute(q)
    orders = result.scalars().all()
    rows = []
    for o in orders:
        d = _m(o)
        if o.assigned_operator_id:
            op_name = (await db.execute(text(
                "SELECT name FROM operators WHERE employee_id=:e"
            ), {"e": o.assigned_operator_id})).scalar_one_or_none()
            d["assigned_operator_name"] = op_name
        else:
            d["assigned_operator_name"] = None
        rows.append(d)
    return rows


@router.get("/orders/{order_id}")
async def get_order(order_id: int, request: Request):
    u = _perm(request, "orders.view")
    db = _db(request)
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    d = _m(order)
    try:
        d["positions"] = json.loads(order.positions) if order.positions else []
    except Exception:
        d["positions"] = []
    mgr_ids = _order_managers(order)
    d["managers"] = mgr_ids
    d["manager_names"] = []
    if mgr_ids:
        try:
            rows = (await db.execute(text(
                "SELECT id, COALESCE(full_name, username) AS name FROM users WHERE id = ANY(:ids)"
            ), {"ids": [int(m) for m in mgr_ids if str(m).isdigit()]})).mappings().all()
            d["manager_names"] = [r["name"] for r in rows]
        except Exception:
            logger.warning("Не удалось получить имена руководителей заказа #%s", order_id)
    d["can_close"] = _is_order_manager(u, order)
    return d


@router.post("/orders", status_code=201)
async def create_order(body: OrderCreate, request: Request):
    _perm(request, "orders.create")
    db = _db(request)

    # ── Проверяем компоненты на складе ──────────────────────────────────────
    recipes_rows = (await db.execute(text("""
        SELECT component_name, norm, warehouse_component_name
        FROM recipes WHERE LOWER(TRIM(product_name))=LOWER(TRIM(:pn)) AND production_type!='Сборка'
    """), {"pn": body.product_name})).mappings().all()

    demand: dict = {}
    for r in recipes_rows:
        wname = (r["warehouse_component_name"] or "").strip() or r["component_name"]
        key = wname.strip().lower()
        demand.setdefault(key, {"name": wname, "required": 0.0})
        demand[key]["required"] += float(r["norm"]) * body.planned_qty

    can_produce = True
    missing_components = []
    for key, d in demand.items():
        # Доступно = остаток − уже зарезервированное под другие заказы
        avail_val = (await db.execute(text(
            "SELECT COALESCE(stock,0) - COALESCE(reserved,0) FROM warehouse_components WHERE LOWER(TRIM(name))=:n"
        ), {"n": key})).scalar_one_or_none()
        available = float(avail_val) if avail_val is not None else 0.0
        if available < d["required"]:
            can_produce = False
            missing_components.append({
                "name": d["name"], "required": d["required"], "available": available
            })

    initial_status = "Создан" if can_produce else "Ожидает компонентов"

    skipped_ids = set(body.skipped_stage_ids or [])
    order = Order(
        product_name=body.product_name.strip(), planned_qty=body.planned_qty,
        assigned_operator_id=body.assigned_operator_id, priority=body.priority,
        deadline=body.deadline, comment=body.comment, status=initial_status,
        assigned_department=body.assigned_department,
        skipped_stage_ids=json.dumps(list(skipped_ids)) if skipped_ids else None,
        managers=json.dumps([str(m) for m in body.managers]) if body.managers else None,
        positions=json.dumps([p.model_dump() for p in body.positions], ensure_ascii=False) if body.positions else None,
        received_date=body.received_date, shipment_date=body.shipment_date,
    )
    db.add(order)
    await db.flush()
    await db.refresh(order)

    # ── Автозапуск если назначен оператор и компоненты есть ─────────────────
    # Автозапуск если есть назначения и компоненты есть
    first_assignment_id = None
    if body.stage_assignments:
        first_assignment_id = next((v for v in body.stage_assignments.values() if v), None)
    if not first_assignment_id and body.assigned_operator_id:
        first_assignment_id = body.assigned_operator_id

    # Компоненты продукта — нужны и для этапов рецептуры, и для extra_stages
    _all_stage_recipes = (await db.execute(text(
        "SELECT component_name, source, norm, warehouse_component_name, production_type "
        "FROM recipes WHERE LOWER(TRIM(product_name))=:pn"
    ), {"pn": _norm(body.product_name)})).mappings().all()
    stage_comps = [
        {"name": (r["warehouse_component_name"] or r["component_name"]).strip(),
         "qty": float(r["norm"]) * body.planned_qty,
         "source": r["source"] or "warehouse",
         "production_type": r["production_type"] or ""}
        for r in _all_stage_recipes
    ]

    if body.use_canonical_route:
        # Канонический маршрут по ТЗ (12 этапов) — строится по признакам изделия,
        # независимо от этапов рецептуры.
        flags = await _resolve_product_flags(db, body.product_name, body)
        await _add_canonical_stages(db, order.id, flags, stage_comps)
        if initial_status == "Создан":
            await db.execute(
                update(Order).where(Order.id == order.id).values(status="В работе", updated_at=func.now())
            )
            initial_status = "В работе"
    elif (body.stage_assignments or first_assignment_id) and initial_status == "Создан":
        stage_recipes = _all_stage_recipes
        r_stages = (await db.execute(text(
            "SELECT id, stage_name, stage_type, sort_order, description, instructions, "
            "required_role, depends_on_previous, transfer_qty "
            "FROM recipe_stages WHERE LOWER(TRIM(product_name))=:pn ORDER BY sort_order, id"
        ), {"pn": _norm(body.product_name)})).mappings().all()

        # Пропускаем этапы, исключённые пользователем для этого заказа
        if skipped_ids:
            r_stages = [rs for rs in r_stages if rs["id"] not in skipped_ids]
        if r_stages:
            min_sort = min((rs["sort_order"] or 0) for rs in r_stages)
            for rs in r_stages:
                stage_type = rs["stage_type"] or "assembly"
                assigned_uid = (body.stage_assignments or {}).get(str(rs["id"])) or first_assignment_id
                assigned_name = None
                if assigned_uid:
                    try:
                        assigned_name = (await db.execute(text(
                            "SELECT COALESCE(full_name, username) FROM users WHERE id=:id"
                        ), {"id": int(assigned_uid)})).scalar_one_or_none()
                    except Exception:
                        logger.warning("Не удалось получить имя пользователя id=%s", assigned_uid)
                    assigned_name = assigned_name or str(assigned_uid)
                stage_components = [
                    c for c in stage_comps
                    if _component_matches_stage(c.get("source", "warehouse"), stage_type, c.get("production_type", ""))
                ] or stage_comps
                db.add(OrderStage(
                    order_id=order.id, stage_type=stage_type,
                    stage_name=rs["stage_name"],
                    status=_initial_stage_status(rs["sort_order"] or 0, min_sort, rs["depends_on_previous"]),
                    sort_order=rs["sort_order"] or 0,
                    required_role=rs["required_role"],
                    depends_on_previous=rs["depends_on_previous"] if rs["depends_on_previous"] is not None else 1,
                    transfer_qty=rs["transfer_qty"] or 0,
                    instructions=rs["instructions"],
                    assigned_to=str(assigned_uid) if assigned_uid else None,
                    assigned_name=assigned_name,
                    components_json=json.dumps(stage_components, ensure_ascii=False),
                    comment=rs["description"],
                ))
        else:
            db.add(OrderStage(
                order_id=order.id, stage_type="assembly", stage_name="Сборка",
                status="pending", sort_order=0,
                assigned_to=str(first_assignment_id) if first_assignment_id else None,
                components_json=json.dumps(stage_comps, ensure_ascii=False),
            ))
        await db.execute(
            update(Order).where(Order.id == order.id).values(status="В работе", updated_at=func.now())
        )
        initial_status = "В работе"

    # ── Дополнительные этапы маршрута (pipeline) ─────────────────────────────
    if body.extra_stages:
        for i, es in enumerate(body.extra_stages):
            assigned_name = None
            if es.assigned_user_id:
                try:
                    assigned_name = (await db.execute(text(
                        "SELECT COALESCE(full_name, username) FROM users WHERE id=:id"
                    ), {"id": int(es.assigned_user_id)})).scalar_one_or_none()
                except Exception:
                    logger.warning("Не удалось получить имя пользователя id=%s", es.assigned_user_id)
                assigned_name = assigned_name or es.assigned_user_id
            # Если пользователь выбрал конкретные компоненты — фильтруем stage_comps,
            # иначе берём все компоненты подходящие по типу этапа
            if es.components:
                es_comps = [c for c in stage_comps if c.get("name") in es.components]
            else:
                es_comps = [
                    c for c in stage_comps
                    if _component_matches_stage(c.get("source", "warehouse"), es.stage_type, c.get("production_type", ""))
                ]
            db.add(OrderStage(
                order_id=order.id, stage_type=es.stage_type,
                stage_name=es.stage_name, status="pending",
                sort_order=es.sort_order if es.sort_order is not None else (500 + i),
                depends_on_previous=es.depends_on_previous if es.depends_on_previous is not None else 1,
                required_role=es.required_role,
                assigned_to=es.assigned_user_id,
                assigned_name=assigned_name,
                components_json=json.dumps(es_comps, ensure_ascii=False),
            ))
        if initial_status == "Создан":
            await db.execute(
                update(Order).where(Order.id == order.id).values(status="В работе", updated_at=func.now())
            )
            initial_status = "В работе"

    # ── Резервируем компоненты если всё есть (физически на складе; уменьшается «доступно») ──
    if can_produce and demand:
        op_prefix = f"ORDER-RESERVE-{order.id}"
        for idx, (key, d) in enumerate(demand.items()):
            # Guard available (stock-reserved) >= qty: параллельный заказ мог уже занять остаток
            res = await db.execute(text(
                "UPDATE warehouse_components SET reserved=COALESCE(reserved,0)+:qty "
                "WHERE LOWER(TRIM(name))=:n AND COALESCE(stock,0) - COALESCE(reserved,0) >= :qty"
            ), {"qty": d["required"], "n": key})
            if res.rowcount == 0:
                raise HTTPException(
                    409, f"Компонент «{d['name']}» закончился на складе во время оформления заказа")
            await db.execute(text("""
                INSERT INTO operations (operation_type, component_name, quantity, note, operation_id)
                VALUES ('RESERVE', :cn, :qty, :note, :oid)
            """), {
                "cn": d["name"], "qty": d["required"],
                "note": f"Резерв под заказ #{order.id} / {body.product_name}",
                "oid": f"{op_prefix}-{idx}",
            })

    # ── Создаём производственные партии ─────────────────────────────────────
    types_rows = (await db.execute(text("""
        SELECT DISTINCT production_type FROM recipes
        WHERE LOWER(TRIM(product_name)) = LOWER(TRIM(:pn)) AND production_type != 'Сборка'
    """), {"pn": body.product_name})).all()

    created_batches = []
    for (ptype,) in types_rows:
        batch_id = await _gen_batch_id(db, ptype)
        batch = ProductionBatch(
            batch_id=batch_id, product_name=body.product_name.strip(),
            production_type=ptype, planned_qty=body.planned_qty,
            status="Запланировано", order_id=order.id,
            comment=body.comment or "",
        )
        db.add(batch)
        created_batches.append(batch_id)

    await _audit(db, _user(request), "order", order.id, "created",
                 new_value=body.product_name,
                 details=json.dumps({"qty": body.planned_qty, "status": initial_status}, ensure_ascii=False))
    # Уведомляем назначенных руководителей проекта
    if body.managers:
        for mid in body.managers:
            await notify_user(
                db, mid, f"Вам назначен заказ №{order.id}",
                f"{body.product_name} — {body.planned_qty} шт.",
                link=f"/orders/{order.id}", type_="info")
    await db.commit()
    # Читаем заказ заново чтобы избежать expired attributes
    order_fresh = (await db.execute(select(Order).where(Order.id == order.id))).scalar_one()
    msg = f"Заказ создан. Партий: {len(created_batches)}."
    if not can_produce:
        msg = f"Заказ создан, ожидает компонентов ({len(missing_components)} позиций не хватает)."
    return {
        **_m(order_fresh),
        "created_batches": created_batches,
        "message": msg,
        "can_produce": can_produce,
        "missing_components": missing_components,
    }


@router.put("/orders/{order_id}")
async def update_order(order_id: int, body: OrderUpdate, request: Request):
    u = _perm(request, "orders.edit")
    db = _db(request)
    update_data = body.model_dump(exclude_none=True)
    if not update_data:
        raise HTTPException(400, "Нет данных для обновления")
    old = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    old_status = old.status if old else None
    # Закрыть/завершить заказ может только руководитель проекта или админ/менеджер
    if update_data.get("status") in CLOSING_STATUSES and not _is_order_manager(u, old):
        raise HTTPException(403, "Закрыть заказ может только руководитель проекта")
    # managers приходит списком — храним JSON-строкой в колонке Text
    if "managers" in update_data:
        update_data["managers"] = json.dumps([str(m) for m in (update_data["managers"] or [])])
    # positions приходит списком позиций — храним JSON-строкой в колонке Text
    if "positions" in update_data:
        update_data["positions"] = json.dumps(update_data["positions"] or [], ensure_ascii=False)
    await db.execute(
        update(Order)
        .where(Order.id == order_id)
        .values(**update_data, updated_at=func.now())
    )
    if "status" in update_data and update_data["status"] != old_status:
        await _audit(db, u, "order", order_id, "status_changed",
                     old_value=old_status, new_value=update_data["status"])
        await _fire_webhooks(db, "order.status_changed", {
            "order_id": order_id, "product_name": old.product_name if old else None,
            "old_status": old_status, "new_status": update_data["status"],
        })
    elif update_data:
        await _audit(db, u, "order", order_id, "updated",
                     details=json.dumps(list(update_data.keys()), ensure_ascii=False))
    # Резерв компонентов: при завершении заказа — списать со склада, при отмене — снять резерв
    if update_data.get("status") in CLOSING_STATUSES:
        await _consume_reserved_components(db, order_id)
    elif update_data.get("status") in ("Отменен", "Отменён"):
        await _return_reserved_components(db, order_id)
    await db.commit()
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one()
    return _m(order)


@router.post("/orders/{order_id}/close")
async def close_order(order_id: int, request: Request):
    """Закрыть (завершить) заказ. Доступно только руководителю проекта или админу/менеджеру."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if not _is_order_manager(u, order):
        raise HTTPException(403, "Закрыть заказ может только руководитель проекта")
    if order.status in ("Завершен", "Завершён", "Отменен", "Отменён"):
        raise HTTPException(400, f"Заказ уже в терминальном статусе «{order.status}»")
    # Брак держит заказ: нельзя закрыть, пока есть незавершённые бракованные партии
    blocking = (await db.execute(text("""
        SELECT COUNT(*) FROM production_batches
        WHERE order_id = :oid AND LOWER(COALESCE(status,'')) LIKE '%брак%'
    """), {"oid": order_id})).scalar_one() or 0
    if blocking:
        raise HTTPException(400, "Нельзя закрыть заказ: есть бракованные партии, требующие переделки")
    old_status = order.status
    await db.execute(
        update(Order).where(Order.id == order_id)
        .values(status="Завершен", updated_at=func.now())
    )
    # Заказ завершён → превращаем резерв компонентов в фактическое списание со склада
    await _consume_reserved_components(db, order_id)
    await _audit(db, u, "order", order_id, "closed", old_value=old_status, new_value="Завершен")
    await _fire_webhooks(db, "order.status_changed", {
        "order_id": order_id, "product_name": order.product_name,
        "old_status": old_status, "new_status": "Завершен",
    })
    await db.commit()
    return {"success": True, "status": "Завершен"}


async def _return_reserved_components(db, order_id: int) -> int:
    """Снять резерв компонентов под заказ (при отмене), если ещё не снимали и не списывали.
    Идемпотентно: помечает снятие как ORDER-RETURN-{order_id}-*; пропускается, если резерв
    уже превращён в списание (ORDER-CONSUME-*).
    Поддержка legacy: для старых заказов резерв был сразу WRITEOFF (сток уже уменьшен) —
    тогда возвращаем сток (+q); для новых (RESERVE) — просто снимаем бронь (reserved −q).
    Возвращает число обработанных позиций."""
    already = (await db.execute(text(
        "SELECT 1 FROM operations WHERE operation_id LIKE :p OR operation_id LIKE :c LIMIT 1"
    ), {"p": f"ORDER-RETURN-{order_id}-%", "c": f"ORDER-CONSUME-{order_id}-%"})).scalar_one_or_none()
    if already:
        return 0
    reserved = (await db.execute(text("""
        SELECT component_name, quantity, operation_type FROM operations
        WHERE operation_id LIKE :p AND operation_type IN ('RESERVE', 'WRITEOFF')
    """), {"p": f"ORDER-RESERVE-{order_id}-%"})).mappings().all()
    returned = 0
    for idx, r in enumerate(reserved):
        if not r["quantity"]:
            continue
        if r["operation_type"] == "RESERVE":
            # Новая модель: сток не трогали — снимаем только бронь
            await db.execute(text(
                "UPDATE warehouse_components SET reserved = GREATEST(COALESCE(reserved,0) - :q, 0) "
                "WHERE LOWER(TRIM(name)) = LOWER(TRIM(:n))"
            ), {"q": r["quantity"], "n": r["component_name"]})
            note = f"Снятие резерва отменённого заказа #{order_id}"
        else:
            # Legacy: сток был уменьшен при создании — возвращаем на склад
            await db.execute(text(
                "UPDATE warehouse_components SET stock = COALESCE(stock,0) + :q "
                "WHERE LOWER(TRIM(name)) = LOWER(TRIM(:n))"
            ), {"q": r["quantity"], "n": r["component_name"]})
            note = f"Возврат резерва отменённого заказа #{order_id}"
        await db.execute(text("""
            INSERT INTO operations (operation_type, component_name, quantity, note, operation_id)
            VALUES ('RESERVE_RELEASE', :cn, :q, :note, :oid)
        """), {
            "cn": r["component_name"], "q": r["quantity"],
            "note": note, "oid": f"ORDER-RETURN-{order_id}-{idx}",
        })
        returned += 1
    return returned


async def _consume_reserved_components(db, order_id: int) -> int:
    """Превратить резерв компонентов заказа в фактическое списание (stock −q, reserved −q).
    Вызывается при завершении/отгрузке заказа. Идемпотентно: помечает списания как
    ORDER-CONSUME-{order_id}-*; пропускается, если резерв уже снят возвратом (ORDER-RETURN-*).
    Обрабатывает только новые брони (operation_type='RESERVE'); у legacy-заказов сток уже
    был списан при создании, поэтому их строки (WRITEOFF) пропускаются — повторного списания нет."""
    already = (await db.execute(text(
        "SELECT 1 FROM operations WHERE operation_id LIKE :c OR operation_id LIKE :r LIMIT 1"
    ), {"c": f"ORDER-CONSUME-{order_id}-%", "r": f"ORDER-RETURN-{order_id}-%"})).scalar_one_or_none()
    if already:
        return 0
    reserved = (await db.execute(text("""
        SELECT component_name, quantity FROM operations
        WHERE operation_id LIKE :p AND operation_type = 'RESERVE'
    """), {"p": f"ORDER-RESERVE-{order_id}-%"})).mappings().all()
    consumed = 0
    for idx, r in enumerate(reserved):
        if not r["quantity"]:
            continue
        await db.execute(text(
            "UPDATE warehouse_components "
            "SET stock = GREATEST(COALESCE(stock,0) - :q, 0), "
            "    reserved = GREATEST(COALESCE(reserved,0) - :q, 0) "
            "WHERE LOWER(TRIM(name)) = LOWER(TRIM(:n))"
        ), {"q": r["quantity"], "n": r["component_name"]})
        await db.execute(text("""
            INSERT INTO operations (operation_type, component_name, quantity, note, operation_id)
            VALUES ('WRITEOFF', :cn, :q, :note, :oid)
        """), {
            "cn": r["component_name"], "q": r["quantity"],
            "note": f"Списание по завершении заказа #{order_id}",
            "oid": f"ORDER-CONSUME-{order_id}-{idx}",
        })
        consumed += 1
    return consumed


@router.delete("/orders/{order_id}")
async def cancel_order(order_id: int, request: Request):
    u = _perm(request, "orders.delete")
    db = _db(request)
    old = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if old and old.status in ("Завершен", "Завершён", "Отменен", "Отменён"):
        raise HTTPException(400, f"Заказ уже в терминальном статусе «{old.status}»")
    await db.execute(
        update(Order).where(Order.id == order_id)
        .values(status="Отменен", updated_at=func.now())
    )
    await db.execute(
        update(ProductionBatch)
        .where(ProductionBatch.order_id == order_id,
               ProductionBatch.status.in_(["Запланировано", "Запущена", "На паузе"]))
        .values(status="Отменена", updated_at=func.now())
    )
    # Закрываем незавершённые этапы и их исполнителей
    await db.execute(
        update(OrderStage)
        .where(OrderStage.order_id == order_id,
               OrderStage.status.in_(["pending", "blocked", "ready", "in_progress"]))
        .values(status="cancelled", updated_at=func.now())
    )
    await db.execute(text("""
        UPDATE stage_assignees SET status='cancelled', updated_at=NOW()
        WHERE stage_id IN (SELECT id FROM order_stages WHERE order_id=:oid)
          AND status IN ('pending', 'in_progress')
    """), {"oid": order_id})
    # Возвращаем зарезервированные компоненты на склад
    returned = await _return_reserved_components(db, order_id)
    await _audit(db, u, "order", order_id, "cancelled", old_value=old.status if old else None,
                 details=json.dumps({"components_returned": returned}, ensure_ascii=False) if returned else None)
    await db.commit()
    return {"success": True, "components_returned": returned}


@router.post("/orders/{order_id}/release-components")
async def release_order_from_waiting(order_id: int, request: Request):
    """Проверить наличие компонентов и перевести заказ из 'Ожидает компонентов' → 'Создан' (зарезервировав на складе)."""
    _perm(request, "orders.edit")
    db = _db(request)
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.status != "Ожидает компонентов":
        raise HTTPException(400, f"Заказ не в статусе 'Ожидает компонентов' (текущий: {order.status})")

    recipes_rows = (await db.execute(text("""
        SELECT component_name, norm, warehouse_component_name
        FROM recipes WHERE LOWER(TRIM(product_name))=LOWER(TRIM(:pn)) AND production_type!='Сборка'
    """), {"pn": order.product_name})).mappings().all()

    demand: dict = {}
    for r in recipes_rows:
        wname = (r["warehouse_component_name"] or "").strip() or r["component_name"]
        key = wname.strip().lower()
        demand.setdefault(key, {"name": wname, "required": 0.0})
        demand[key]["required"] += float(r["norm"]) * order.planned_qty

    missing = []
    for key, d in demand.items():
        avail_val = (await db.execute(text(
            "SELECT COALESCE(stock,0) - COALESCE(reserved,0) FROM warehouse_components WHERE LOWER(TRIM(name))=:n"
        ), {"n": key})).scalar_one_or_none()
        available = float(avail_val) if avail_val is not None else 0.0
        if available < d["required"]:
            missing.append({"name": d["name"], "required": d["required"], "available": available})

    if missing:
        return {"success": False, "message": "Компонентов всё ещё не хватает", "missing": missing}

    # Атомарно выводим заказ из ожидания — защита от двойного списания при повторном вызове
    claimed = await db.execute(text(
        "UPDATE orders SET status='Создан', updated_at=NOW() "
        "WHERE id=:id AND status='Ожидает компонентов'"
    ), {"id": order_id})
    if claimed.rowcount == 0:
        raise HTTPException(409, "Заказ уже выведен из ожидания")

    op_prefix = f"ORDER-RESERVE-{order_id}"
    for idx, (key, d) in enumerate(demand.items()):
        # Guard available (stock-reserved) >= qty: параллельный заказ мог уже занять остаток
        res = await db.execute(text(
            "UPDATE warehouse_components SET reserved=COALESCE(reserved,0)+:qty "
            "WHERE LOWER(TRIM(name))=:n AND COALESCE(stock,0) - COALESCE(reserved,0) >= :qty"
        ), {"qty": d["required"], "n": key})
        if res.rowcount == 0:
            raise HTTPException(
                409, f"Компонент «{d['name']}» закончился на складе во время оформления")
        await db.execute(text("""
            INSERT INTO operations (operation_type, component_name, quantity, note, operation_id)
            VALUES ('RESERVE', :cn, :qty, :note, :oid)
        """), {
            "cn": d["name"], "qty": d["required"],
            "note": f"Резерв под заказ #{order_id} / {order.product_name}",
            "oid": f"{op_prefix}-{idx}",
        })
    await db.commit()
    return {"success": True, "message": "Компоненты зарезервированы, заказ переведён в 'Создан'"}


@router.post("/orders/{order_id}/start")
async def start_order(order_id: int, request: Request):
    u = _user(request)
    db = _db(request)
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    # Проверяем доступ: менеджер/админ ИЛИ назначенный оператор
    if u.role not in ("admin", "manager"):
        is_assigned = str(u.id) == str(order.assigned_operator_id)
        if not is_assigned:
            stage = (await db.execute(
                select(OrderStage).where(
                    OrderStage.order_id == order_id,
                    OrderStage.assigned_to == str(u.id)
                ).limit(1)
            )).scalar_one_or_none()
            if not stage:
                raise HTTPException(403, "Вы не назначены на этот заказ")

    if order.status == "Ожидает компонентов":
        raise HTTPException(400, "Заказ ожидает компонентов на складе, запуск невозможен")
    if order.status not in ("Создан", "Доработка"):
        raise HTTPException(400, f"Нельзя запустить заказ со статусом '{order.status}'")

    await db.execute(
        update(Order)
        .where(Order.id == order_id)
        .values(status="В работе", updated_at=func.now())
    )
    await _audit(db, u, "order", order_id, "started", old_value=order.status, new_value="В работе")
    await db.commit()

    # Автоматически создаём этапы из recipe_stages
    existing_stages = (await db.execute(
        select(func.count()).select_from(OrderStage).where(OrderStage.order_id == order_id)
    )).scalar_one()
    if existing_stages == 0:
        # Все компоненты рецептуры
        recipes = (await db.execute(text(
            "SELECT component_name, source, norm, warehouse_component_name, production_type "
            "FROM recipes WHERE LOWER(TRIM(product_name))=:pn"
        ), {"pn": _norm(order.product_name)})).mappings().all()
        all_components = [
            {
                "name": (r["warehouse_component_name"] or r["component_name"]).strip(),
                "qty": float(r["norm"]) * order.planned_qty,
                "source": r["source"] or "warehouse",
                "production_type": r["production_type"] or "",
            }
            for r in recipes
        ]

        # Этапы из recipe_stages
        recipe_stages = (await db.execute(text(
            "SELECT id, stage_name, stage_type, sort_order, description, instructions, "
            "required_role, depends_on_previous, transfer_qty "
            "FROM recipe_stages WHERE LOWER(TRIM(product_name))=:pn ORDER BY sort_order, id"
        ), {"pn": _norm(order.product_name)})).mappings().all()

        # Пропускаем этапы, исключённые при создании заказа
        try:
            _skipped = set(json.loads(order.skipped_stage_ids or "[]"))
        except (ValueError, TypeError):
            _skipped = set()
        if _skipped:
            recipe_stages = [rs for rs in recipe_stages if rs["id"] not in _skipped]

        if recipe_stages:
            min_sort = min((rs["sort_order"] or 0) for rs in recipe_stages)
            for rs in recipe_stages:
                # Компоненты фильтруем по типу этапа
                stage_type = rs["stage_type"] or "assembly"
                stage_components = [
                    c for c in all_components
                    if _component_matches_stage(c.get("source", "warehouse"), stage_type, c.get("production_type", ""))
                ] or all_components
                db.add(OrderStage(
                    order_id=order_id,
                    stage_type=stage_type,
                    stage_name=rs["stage_name"],
                    status=_initial_stage_status(rs["sort_order"] or 0, min_sort, rs["depends_on_previous"]),
                    sort_order=rs["sort_order"] or 0,
                    required_role=rs["required_role"],
                    depends_on_previous=rs["depends_on_previous"] if rs["depends_on_previous"] is not None else 1,
                    transfer_qty=rs["transfer_qty"] or 0,
                    instructions=rs["instructions"],
                    components_json=json.dumps(stage_components, ensure_ascii=False),
                    comment=rs["description"],
                ))
        else:
            db.add(OrderStage(
                order_id=order_id,
                stage_type="assembly",
                stage_name="Сборка",
                status="pending",
                sort_order=0,
                components_json=json.dumps(all_components, ensure_ascii=False),
            ))
        await db.commit()

    return {"success": True, "message": "Заказ переведён в работу"}


@router.put("/orders/{order_id}/status")
async def update_order_status(order_id: int, request: Request):
    u = _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    status = body.get("status")
    if not status:
        raise HTTPException(400, "Статус не указан")
    old = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    old_status = old.status if old else None
    # Завершить заказ может только руководитель проекта (как в PUT /orders и close)
    if status in CLOSING_STATUSES and not _is_order_manager(u, old):
        raise HTTPException(403, "Закрыть заказ может только руководитель проекта")
    await db.execute(
        update(Order).where(Order.id == order_id)
        .values(status=status, updated_at=func.now())
    )
    # Резерв компонентов: завершение → списание со склада, отмена → снятие резерва
    if status in CLOSING_STATUSES:
        await _consume_reserved_components(db, order_id)
    elif status in ("Отменен", "Отменён"):
        await _return_reserved_components(db, order_id)
    await _audit(db, u, "order", order_id, "status_changed", old_value=old_status, new_value=status)
    await db.commit()
    return {"success": True}


@router.get("/orders/{order_id}/component-demand")
async def component_demand(order_id: int, request: Request):
    _perm(request, "orders.view")
    db = _db(request)
    result = await db.execute(select(Order).where(Order.id == order_id))
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    recipes = (await db.execute(text("""
        SELECT component_name, norm, warehouse_component_name, production_type
        FROM recipes WHERE LOWER(TRIM(product_name))=LOWER(TRIM(:pn)) AND production_type!='Сборка'
    """), {"pn": order.product_name})).mappings().all()
    demand: dict = {}
    for r in recipes:
        wname = (r["warehouse_component_name"] or "").strip() or r["component_name"]
        key = _norm(wname)
        demand.setdefault(key, {"component_name": wname, "required": 0})
        demand[key]["required"] += float(r["norm"]) * order.planned_qty
    stock_rows = (await db.execute(text(
        "SELECT component_name, quantity FROM production_stock"
    ))).mappings().all()
    stock = {_norm(r["component_name"]): float(r["quantity"]) for r in stock_rows}
    components = []
    for key, d in demand.items():
        avail = stock.get(key, 0)
        components.append({**d, "available": avail,
                           "shortage": max(0, d["required"] - avail),
                           "canProduce": d["required"] <= avail})
    return {"canProduce": all(c["canProduce"] for c in components), "components": components}


# ── Production batches ────────────────────────────────────────────────────────

@router.get("/production/batches")
async def list_batches(request: Request, order_id: Optional[int] = None,
                       production_type: Optional[str] = None, status: Optional[str] = None):
    _perm(request, "production.view")
    db = _db(request)
    q = select(ProductionBatch)
    if order_id:
        q = q.where(ProductionBatch.order_id == order_id)
    else:
        # Batches without order or with active orders
        active_order_ids = (await db.execute(
            select(Order.id).where(Order.status == "В работе")
        )).scalars().all()
        q = q.where(or_(
            ProductionBatch.order_id.is_(None),
            ProductionBatch.order_id.in_(active_order_ids)
        ))
    if production_type:
        q = q.where(ProductionBatch.production_type == production_type)
    if status:
        q = q.where(ProductionBatch.status == status)
    q = q.order_by(ProductionBatch.start_date.desc(), ProductionBatch.batch_id.desc())
    result = await db.execute(q)
    batches = result.scalars().all()
    rows = []
    for b in batches:
        d = _m(b)
        if b.operator_id:
            op_name = (await db.execute(text(
                "SELECT name FROM operators WHERE employee_id=:e"
            ), {"e": b.operator_id})).scalar_one_or_none()
            d["operator_name"] = op_name
        else:
            d["operator_name"] = None
        if b.order_id:
            ord_status = (await db.execute(
                select(Order.status).where(Order.id == b.order_id)
            )).scalar_one_or_none()
            d["order_status"] = ord_status
        else:
            d["order_status"] = None
        rows.append(d)
    return rows


@router.post("/production/start-batch/{batch_id}")
async def start_batch(batch_id: str, body: StartBatchRequest, request: Request):
    _perm(request, "production.start")
    db = _db(request)
    result = await db.execute(select(ProductionBatch).where(ProductionBatch.batch_id == batch_id))
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Партия не найдена")
    if batch.status not in ("Запланировано", "На паузе", "Запущена"):
        raise HTTPException(400, f"Нельзя запустить партию со статусом {batch.status}")

    operator_ids = body.operatorIds or []
    if not operator_ids:
        raise HTTPException(400, "Укажите хотя бы одного оператора")

    main_op = str(operator_ids[0]).strip()
    exists = (await db.execute(text(
        "SELECT 1 FROM operators WHERE employee_id=:e"
    ), {"e": main_op})).scalar_one_or_none()
    if not exists:
        await db.execute(text(
            "INSERT INTO operators (employee_id, name, role) VALUES (:e, :n, 'operator') ON CONFLICT DO NOTHING"
        ), {"e": main_op, "n": f"Оператор {main_op}"})

    update_vals: dict = {
        "status": "Запущена", "operator_id": main_op, "start_date": datetime.utcnow()
    }
    if body.line_number:
        update_vals["line_number"] = body.line_number
    if body.mounting_operator_number:
        update_vals["mounting_operator_number"] = body.mounting_operator_number

    await db.execute(
        update(ProductionBatch)
        .where(ProductionBatch.batch_id == batch_id)
        .values(**update_vals)
    )

    for op in operator_ids:
        stmt = (
            pg_insert(ProductionBatchOperator)
            .values(batch_id=batch_id, operator_id=str(op).strip())
            .on_conflict_do_nothing()
        )
        await db.execute(stmt)

    if batch.order_id:
        await db.execute(
            update(Order)
            .where(Order.id == batch.order_id, Order.status == "Создан")
            .values(status="В работе", updated_at=func.now())
        )

    op_type = "ENGRAVING_START" if batch.production_type in ("Гравировка", "3D Печать") else "PRODUCTION_START"
    await db.execute(text("""
        INSERT INTO operations (operation_type, component_name, quantity, note, operator_id, operation_id)
        VALUES (:t,:cn,:q,:n,:o,:oid)
    """), {"t": op_type, "cn": batch.product_name, "q": batch.planned_qty,
           "n": f"Тип: {batch.production_type}, Операторы: {', '.join(str(x) for x in operator_ids)}",
           "o": main_op, "oid": _op_id(op_type)})
    await db.commit()
    return {"success": True, "batch_id": batch_id, "status": "Запущена"}


@router.post("/production/complete")
async def complete_batch(body: CompleteRequest, request: Request):
    _perm(request, "production.pause_complete")
    db = _db(request)
    result = await db.execute(select(ProductionBatch).where(ProductionBatch.batch_id == body.batchId))
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Партия не найдена")
    if batch.status not in ("Запущена", "На паузе"):
        raise HTTPException(400, "Партия должна быть Запущена или На паузе")

    actual = body.actualQty or int(batch.actual_qty or 0)
    await db.execute(
        update(ProductionBatch)
        .where(ProductionBatch.batch_id == body.batchId)
        .values(actual_qty=actual, status="Готов к проверке ОТК", end_date=func.now())
    )

    otk_id = await _gen_otk_id(db, batch.production_type, batch.operator_id)
    await db.execute(text("""
        INSERT INTO otk_batches (batch_id, product_name, production_type, released_qty, maker_id,
                                  status, receive_date, source_batch_id, order_id)
        VALUES (:bid, :pn, :pt, :qty, :mid, 'Принята', NOW(), :src, :oid)
    """), {"bid": otk_id, "pn": batch.product_name, "pt": batch.production_type,
           "qty": actual, "mid": batch.operator_id, "src": body.batchId, "oid": batch.order_id})

    if batch.order_id:
        from app.services.order_status_manager import auto_update_order_status
        await auto_update_order_status(db, batch.order_id)

    await db.commit()
    return {"success": True, "batchId": body.batchId, "otkBatchId": otk_id}


@router.post("/production/pause-shift")
async def pause_shift(body: PauseRequest, request: Request):
    _perm(request, "production.pause_complete")
    db = _db(request)
    result = await db.execute(select(ProductionBatch).where(ProductionBatch.batch_id == body.batchId))
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Партия не найдена")
    if batch.status != "Запущена":
        raise HTTPException(400, "Партия должна быть Запущена")
    new_actual = int(batch.actual_qty or 0) + body.qtyProduced
    await db.execute(
        update(ProductionBatch)
        .where(ProductionBatch.batch_id == body.batchId)
        .values(actual_qty=new_actual, status="На паузе", updated_at=func.now())
    )
    await db.execute(text("""
        INSERT INTO operations (operation_type, component_name, quantity, note, operator_id, operation_id)
        VALUES ('SHIFT_COMPLETE',:cn,:q,:n,:o,:oid)
    """), {"cn": batch.product_name, "q": body.qtyProduced,
           "n": f"Завершение смены. Произведено: {body.qtyProduced} шт." + (f" {body.comment}" if body.comment else ""),
           "o": batch.operator_id, "oid": _op_id("SHIFT")})
    if batch.order_id:
        from app.services.order_status_manager import auto_update_order_status
        await auto_update_order_status(db, batch.order_id)
    await db.commit()
    return {"success": True, "batchId": body.batchId, "actualQty": new_actual}


@router.delete("/production/batches/{batch_id}")
async def delete_batch(batch_id: str, request: Request):
    _perm(request, "production.delete")
    db = _db(request)
    result = await db.execute(select(ProductionBatch).where(ProductionBatch.batch_id == batch_id))
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Партия не найдена")
    allowed = ("Запланировано", "Отменена", "Готов к проверке ОТК", "Завершена")
    if batch.status not in allowed:
        raise HTTPException(400, f"Нельзя удалить партию со статусом {batch.status}")
    await db.execute(
        delete(ProductionBatchOperator).where(ProductionBatchOperator.batch_id == batch_id)
    )
    await db.execute(
        delete(ProductionBatch).where(ProductionBatch.batch_id == batch_id)
    )
    await db.commit()
    return {"success": True}


@router.post("/production/daily-progress")
async def add_daily_progress(body: DailyProgressRequest, request: Request):
    _user(request)
    db = _db(request)
    if body.qty_produced < 0:
        raise HTTPException(400, "Количество не может быть отрицательным")
    batch = (await db.execute(
        select(ProductionBatch).where(ProductionBatch.batch_id == body.batch_id)
    )).scalar_one_or_none()
    if not batch:
        raise HTTPException(404, "Партия не найдена")
    stmt = (
        pg_insert(ProductionDailyProgress)
        .values(batch_id=body.batch_id, production_date=body.production_date,
                qty_produced=body.qty_produced, comment=body.comment)
        .on_conflict_do_update(
            constraint="uq_batch_date",
            set_={"qty_produced": body.qty_produced, "comment": body.comment,
                  "updated_at": func.now()}
        )
    )
    await db.execute(stmt)
    total = (await db.execute(
        select(func.coalesce(func.sum(ProductionDailyProgress.qty_produced), 0))
        .where(ProductionDailyProgress.batch_id == body.batch_id)
    )).scalar_one()
    if batch.planned_qty and int(total) > int(batch.planned_qty):
        raise HTTPException(
            400, f"Суммарный прогресс {int(total)} шт. превышает план партии "
                 f"{batch.planned_qty} шт. Увеличьте план партии или исправьте отчёт.")
    await db.execute(
        update(ProductionBatch)
        .where(ProductionBatch.batch_id == body.batch_id)
        .values(actual_qty=int(total), updated_at=func.now())
    )
    await db.commit()
    return {"success": True, "total_qty": int(total)}


# ── Order Stages ─────────────────────────────────────────────────────────────

@router.post("/orders/{order_id}/submit-otk")
async def submit_otk(order_id: int, body: SubmitOtkRequest, request: Request):
    """Исполнитель сдаёт заказ в ОТК (с прикреплённым фото). Работает при первичной сдаче и повторной после брака."""
    u = _user(request)
    db = _db(request)

    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    if order.status not in ("В работе", "Создан", "Доработка"):
        raise HTTPException(400, f"Нельзя сдать в ОТК заказ со статусом '{order.status}'")

    # Проверяем что пользователь назначен на этап в этом заказе
    my_stage = (await db.execute(
        select(OrderStage).where(
            OrderStage.order_id == order_id,
            OrderStage.assigned_to == str(u.id)
        ).limit(1)
    )).scalar_one_or_none()

    if not my_stage and u.role not in ("admin", "manager"):
        raise HTTPException(403, "Вы не назначены на этот заказ")

    # Завершаем все активные/запланированные партии (включая уже отправленные ранее — при повторной сдаче)
    batches = (await db.execute(
        select(ProductionBatch).where(
            ProductionBatch.order_id == order_id,
            ProductionBatch.status.in_(["Запущена", "На паузе", "Запланировано", "Готов к проверке ОТК"])
        )
    )).scalars().all()

    otk_ids = []
    for batch in batches:
        actual = int(batch.actual_qty or batch.planned_qty)
        await db.execute(
            update(ProductionBatch)
            .where(ProductionBatch.batch_id == batch.batch_id)
            .values(actual_qty=actual, status="Готов к проверке ОТК", end_date=func.now())
        )
        otk_id = await _gen_otk_id(db, batch.production_type, str(u.id))
        await db.execute(text("""
            INSERT INTO otk_batches (batch_id, product_name, production_type, released_qty, maker_id,
                                      status, receive_date, source_batch_id, order_id)
            VALUES (:bid, :pn, :pt, :qty, :mid, 'Принята', NOW(), :src, :oid)
        """), {
            "bid": otk_id, "pn": batch.product_name, "pt": batch.production_type,
            "qty": actual, "mid": str(u.id), "src": batch.batch_id, "oid": order_id
        })
        otk_ids.append(otk_id)

    # Если производственных партий нет — создаём OTK-запись напрямую из заказа
    if not batches:
        otk_id = await _gen_otk_id(db, "Сборка", str(u.id))
        await db.execute(text("""
            INSERT INTO otk_batches (batch_id, product_name, production_type, released_qty, maker_id,
                                      status, receive_date, order_id)
            VALUES (:bid, :pn, 'Сборка', :qty, :mid, 'Принята', NOW(), :oid)
        """), {
            "bid": otk_id, "pn": order.product_name,
            "qty": order.planned_qty, "mid": str(u.id), "oid": order_id
        })
        otk_ids.append(otk_id)

    # Повторная сдача после брака = исполнитель переделал работу. Прежние
    # забракованные партии этого заказа больше не должны держать его открытым
    # (иначе статус-машина вечно возвращала бы 'Доработка'). Помечаем их
    # 'Переделан' — этот статус нигде не учитывается в пересчёте статуса.
    await db.execute(text("""
        UPDATE otk_batches SET status='Переделан'
        WHERE order_id=:oid AND status='брак'
    """), {"oid": order_id})

    # Сохраняем фото и обновляем статус заказа
    update_vals: dict = {"status": "На проверке ОТК", "updated_at": func.now()}
    if body.photo_url:
        update_vals["submit_photo_url"] = body.photo_url
    await db.execute(update(Order).where(Order.id == order_id).values(**update_vals))

    # Реактивируем ОТК-этап если он есть (done/blocked → pending).
    # 'blocked' возникает после возврата на доработку — при повторной сдаче
    # этап ОТК снова должен стать активным.
    await db.execute(text("""
        UPDATE order_stages
        SET status='pending', started_at=NULL, completed_at=NULL, updated_at=NOW()
        WHERE order_id=:oid AND stage_type='otk' AND status IN ('done', 'blocked')
    """), {"oid": order_id})

    # Авто-уведомление операторам ОТК о новой партии на проверку
    await notify_roles(
        db, ["operator_otk"],
        f"Заказ №{order_id} передан на проверку ОТК",
        f"{order.product_name} — партий: {len(otk_ids)}",
        link="/otk", type_="warning",
    )

    await db.commit()
    return {"success": True, "otk_batch_ids": otk_ids}


async def _reactivate_rework_stage(db, order_id: int, rework_stage_id=None,
                                   rework_stage_type=None):
    """Вернуть заказ на доработку: реактивировать нужный ПРОИЗВОДСТВЕННЫЙ этап
    (и его исполнителей) → 'pending', а ОТК-этап → 'blocked'. Так брак уходит
    обратно исполнителю, а не дальше по маршруту.

    Приоритет выбора этапа:
      1) явный id этапа от ОТК;
      2) отдел (stage_type), указанный ОТК — последний этап этого типа (готовый — в приоритете);
      3) авто — последний завершённый производственный этап перед ОТК;
      4) фолбэк — последний по маршруту не-ОТК этап (любой статус).
    Возвращает id реактивированного этапа или None.
    """
    # Позиция ОТК-этапа в маршруте (любой статус) — потолок для авто-выбора
    otk_sort = (await db.execute(text("""
        SELECT sort_order FROM order_stages
        WHERE order_id=:oid AND stage_type='otk'
        ORDER BY sort_order DESC LIMIT 1
    """), {"oid": order_id})).scalar()

    target = None
    if rework_stage_id:
        target = (await db.execute(text("""
            SELECT id FROM order_stages
            WHERE id=:sid AND order_id=:oid AND stage_type != 'otk'
        """), {"sid": rework_stage_id, "oid": order_id})).scalar_one_or_none()
    if not target and rework_stage_type:
        target = (await db.execute(text("""
            SELECT id FROM order_stages
            WHERE order_id=:oid AND stage_type=:st AND stage_type != 'otk'
            ORDER BY (status='done') DESC, sort_order DESC LIMIT 1
        """), {"oid": order_id, "st": rework_stage_type})).scalar_one_or_none()
    if not target:
        target = (await db.execute(text("""
            SELECT id FROM order_stages
            WHERE order_id=:oid AND stage_type != 'otk' AND status='done'
              AND (CAST(:ms AS INTEGER) IS NULL OR sort_order <= :ms)
            ORDER BY sort_order DESC, completed_at DESC NULLS LAST LIMIT 1
        """), {"oid": order_id, "ms": otk_sort})).scalar_one_or_none()
    if not target:
        target = (await db.execute(text("""
            SELECT id FROM order_stages
            WHERE order_id=:oid AND stage_type != 'otk'
            ORDER BY sort_order DESC LIMIT 1
        """), {"oid": order_id})).scalar_one_or_none()

    if target:
        await db.execute(text("""
            UPDATE order_stages SET status='pending', started_at=NULL,
                completed_at=NULL, updated_at=NOW() WHERE id=:sid
        """), {"sid": target})
        # Исполнители этапа снова получают работу (иначе их части остаются «сдано»)
        await db.execute(text("""
            UPDATE stage_assignees SET status='pending', started_at=NULL,
                completed_at=NULL, updated_at=NOW() WHERE stage_id=:sid
        """), {"sid": target})
    # ОТК-этап(ы) блокируем до повторной сдачи, чтобы маршрут отражал реальность
    await db.execute(text("""
        UPDATE order_stages SET status='blocked', started_at=NULL,
            completed_at=NULL, updated_at=NOW()
        WHERE order_id=:oid AND stage_type='otk' AND status != 'blocked'
    """), {"oid": order_id})
    return target


class ReturnReworkRequest(BaseModel):
    comment: Optional[str] = None
    rejection_photo_url: Optional[str] = None
    rework_stage_type: Optional[str] = None   # отдел возврата (smd/assembly/...)
    rework_stage_id: Optional[int] = None      # конкретный этап возврата


@router.post("/orders/{order_id}/return-rework")
async def return_rework(order_id: int, body: ReturnReworkRequest, request: Request):
    """ОТК возвращает заказ на доработку (уровень заказа): статус → 'Доработка'
    + реактивация нужного производственного этапа, чтобы брак ушёл обратно
    исполнителю. В отличие от смены статуса через PUT /orders, здесь корректно
    «оживает» этап в «Моих задачах» исполнителя."""
    u = _perm(request, "otk.view")
    db = _db(request)
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.status in ("Отменен", "Отменён", "Завершен", "Завершён"):
        raise HTTPException(400, f"Заказ в терминальном статусе «{order.status}» — вернуть нельзя")

    comment = (body.comment or "").strip()
    await db.execute(text("""
        UPDATE orders SET status='Доработка', otk_comment=:c, otk_rejection_photo=:p,
            otk_attempts=COALESCE(otk_attempts,0)+1, updated_at=NOW()
        WHERE id=:oid
    """), {"c": comment, "p": body.rejection_photo_url or "", "oid": order_id})

    # Производственные партии — назад в работу
    await db.execute(text("""
        UPDATE production_batches SET status='Запланировано', updated_at=NOW()
        WHERE order_id=:oid AND status='Готов к проверке ОТК'
    """), {"oid": order_id})

    rework_stage_id = await _reactivate_rework_stage(
        db, order_id, body.rework_stage_id, body.rework_stage_type)

    # Уведомления: исполнитель(и) реактивированного этапа + руководители
    msg = f"{order.product_name}: возврат на доработку. {comment}".strip()
    notify_ids = set()
    if rework_stage_id:
        assigned = (await db.execute(text(
            "SELECT assigned_to FROM order_stages WHERE id=:sid"
        ), {"sid": rework_stage_id})).scalar()
        if assigned:
            notify_ids.add(str(assigned))
        sa = (await db.execute(text(
            "SELECT DISTINCT user_id FROM stage_assignees WHERE stage_id=:sid AND user_id IS NOT NULL"
        ), {"sid": rework_stage_id})).scalars().all()
        notify_ids |= {str(i) for i in sa}
    for uid in notify_ids:
        await notify_user(db, uid, f"Заказ №{order_id} возвращён на доработку",
                          msg, link="/my-tasks", type_="warning")
    await notify_managers(db, f"ОТК: заказ №{order_id} на доработку",
                          msg, link=f"/orders/{order_id}", type_="warning")

    # Эскалация (#44): при 3+ возвратах с ОТК — отдельное уведомление руководству
    attempts = (await db.execute(text(
        "SELECT COALESCE(otk_attempts,0) FROM orders WHERE id=:oid"
    ), {"oid": order_id})).scalar() or 0
    if attempts >= 3:
        await notify_managers(db,
            f"⚠ Эскалация: заказ №{order_id} возвращён ОТК {attempts}-й раз",
            f"{order.product_name}: систематический брак. Требуется вмешательство руководителя.",
            link=f"/orders/{order_id}", type_="warning")

    await _audit(db, u, "order", order_id, "return_rework",
                 old_value=order.status, new_value="Доработка",
                 details=json.dumps({"rework_stage_id": rework_stage_id,
                                     "comment": comment}, ensure_ascii=False))
    await db.commit()
    return {"success": True, "rework_stage_id": rework_stage_id, "otk_attempts": int(attempts)}


@router.patch("/orders/{order_id}/stages/{stage_id}/transfer")
async def transfer_stage(order_id: int, stage_id: int, request: Request):
    """Исполнитель фиксирует кол-во переданных следующему этапу перед завершением."""
    u = _user(request)
    db = _db(request)
    body = await request.json()
    qty = int(body.get("qty", 0))
    if qty <= 0:
        raise HTTPException(400, "Укажите количество")

    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    if u.role not in ("admin", "manager") and stage.assigned_to != str(u.id):
        raise HTTPException(403, "Вы не назначены на этот этап")

    # Нельзя передать больше, чем количество заказа
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order and order.planned_qty and qty > int(order.planned_qty):
        raise HTTPException(400, f"Нельзя передать {qty} шт. — количество заказа {order.planned_qty} шт.")

    await db.execute(
        update(OrderStage).where(OrderStage.id == stage_id)
        .values(transferred_qty=qty, updated_at=func.now())
    )
    await db.commit()
    updated = (await db.execute(select(OrderStage).where(OrderStage.id == stage_id))).scalar_one()
    return {**_m(updated), "components": updated.components}


@router.patch("/orders/{order_id}/stages/{stage_id}/start")
async def start_stage(order_id: int, stage_id: int, request: Request):
    u = _user(request)
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    if u.role not in ("admin", "manager") and stage.assigned_to != str(u.id):
        raise HTTPException(403, "Вы не назначены на этот этап")
    if stage.status != "pending":
        raise HTTPException(400, f"Этап уже в статусе {stage.status}")
    res = await db.execute(
        update(OrderStage).where(OrderStage.id == stage_id, OrderStage.status == "pending")
        .values(status="in_progress", started_at=func.now(), updated_at=func.now())
    )
    if res.rowcount == 0:
        raise HTTPException(409, "Этап уже начат другим пользователем")
    await _audit(db, u, "stage", stage_id, "stage_started",
                 old_value="pending", new_value="in_progress",
                 details=json.dumps({"order_id": order_id, "stage": stage.stage_name}, ensure_ascii=False))
    await db.commit()
    updated = (await db.execute(select(OrderStage).where(OrderStage.id == stage_id))).scalar_one()
    return {**_m(updated), "components": updated.components}


@router.get("/orders/{order_id}/stages/{stage_id}/available-assignees")
async def available_assignees(order_id: int, stage_id: int, request: Request):
    _perm(request, "orders.edit")
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    q = "SELECT id, username, full_name, role FROM users WHERE is_active=true"
    params: dict = {}
    if stage.required_role:
        q += " AND role=:role"
        params["role"] = stage.required_role
    rows = (await db.execute(text(q), params)).mappings().all()
    return list(rows)


@router.post("/orders/{order_id}/stages", status_code=201)
async def add_stage(order_id: int, request: Request):
    """Добавить этап прямо в заказ."""
    _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    stage = OrderStage(
        order_id=order_id,
        stage_type=body.get("stage_type", "assembly"),
        stage_name=body.get("stage_name", ""),
        status="pending",
        sort_order=body.get("sort_order", 0),
        required_role=body.get("required_role"),
        instructions=body.get("instructions"),
        next_stage_id=body.get("next_stage_id"),
        components_json="[]",
    )
    db.add(stage)
    await db.flush()
    await db.refresh(stage)
    await db.commit()
    return {**_m(stage), "components": stage.components}


@router.put("/orders/{order_id}/stages/{stage_id}")
async def update_stage(order_id: int, stage_id: int, request: Request):
    """Редактировать этап заказа."""
    _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    allowed = ["stage_name", "stage_type", "sort_order", "required_role",
               "instructions", "next_stage_id", "assigned_to", "assigned_name",
               "est_minutes", "result_photo", "depends_on_previous"]
    vals = {k: body[k] for k in allowed if k in body}
    # checklist принимаем как список → сериализуем
    if "checklist" in body:
        vals["checklist"] = json.dumps(body["checklist"], ensure_ascii=False)
    vals["updated_at"] = func.now()
    await db.execute(update(OrderStage).where(OrderStage.id == stage_id).values(**vals))
    await db.commit()
    updated = (await db.execute(select(OrderStage).where(OrderStage.id == stage_id))).scalar_one()
    return {**_m(updated), "components": updated.components}


@router.delete("/orders/{order_id}/stages/{stage_id}")
async def delete_stage(order_id: int, stage_id: int, request: Request):
    """Удалить этап заказа."""
    _perm(request, "orders.edit")
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    if stage.status == "in_progress":
        raise HTTPException(400, "Нельзя удалить этап в работе")
    # Сбрасываем ссылки на этот этап
    await db.execute(
        update(OrderStage).where(OrderStage.next_stage_id == stage_id)
        .values(next_stage_id=None)
    )
    await db.execute(delete(OrderStage).where(OrderStage.id == stage_id))
    await db.commit()
    return {"success": True}


@router.patch("/orders/{order_id}/stages/reorder")
async def reorder_stages(order_id: int, request: Request):
    """Изменить порядок этапов. body.order = [stage_id, ...] в нужной последовательности."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    ids = body.get("order") or []
    for idx, sid in enumerate(ids):
        await db.execute(
            update(OrderStage).where(OrderStage.id == sid, OrderStage.order_id == order_id)
            .values(sort_order=idx, updated_at=func.now())
        )
    await _audit(db, u, "order", order_id, "stages_reordered",
                 details=json.dumps({"order": ids}, ensure_ascii=False))
    await db.commit()
    rows = (await db.execute(
        select(OrderStage).where(OrderStage.order_id == order_id).order_by(OrderStage.sort_order, OrderStage.id)
    )).scalars().all()
    return [{**_m(s), "components": s.components} for s in rows]


@router.patch("/orders/{order_id}/stages/{stage_id}/pause")
async def pause_stage(order_id: int, stage_id: int, request: Request):
    """Поставить этап на паузу с указанием причины."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    reason = (body.get("reason") or "").strip()
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    if stage.status != "in_progress":
        raise HTTPException(400, "На паузу можно поставить только этап в работе")
    await db.execute(update(OrderStage).where(OrderStage.id == stage_id).values(
        status="paused", pause_reason=reason, paused_at=func.now(), updated_at=func.now()))
    await _audit(db, u, "stage", stage_id, "stage_paused",
                 new_value=reason, details=json.dumps({"order_id": order_id}, ensure_ascii=False))
    await db.commit()
    updated = (await db.execute(select(OrderStage).where(OrderStage.id == stage_id))).scalar_one()
    return {**_m(updated), "components": updated.components}


@router.patch("/orders/{order_id}/stages/{stage_id}/resume")
async def resume_stage(order_id: int, stage_id: int, request: Request):
    """Возобновить этап после паузы."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    if stage.status != "paused":
        raise HTTPException(400, "Этап не на паузе")
    await db.execute(update(OrderStage).where(OrderStage.id == stage_id).values(
        status="in_progress", pause_reason=None, paused_at=None, updated_at=func.now()))
    await _audit(db, u, "stage", stage_id, "stage_resumed",
                 details=json.dumps({"order_id": order_id}, ensure_ascii=False))
    await db.commit()
    updated = (await db.execute(select(OrderStage).where(OrderStage.id == stage_id))).scalar_one()
    return {**_m(updated), "components": updated.components}


@router.get("/orders/{order_id}/stages")
async def list_stages(order_id: int, request: Request):
    _perm(request, "orders.view")
    db = _db(request)
    result = await db.execute(
        select(OrderStage)
        .where(OrderStage.order_id == order_id)
        .order_by(OrderStage.sort_order, OrderStage.id)
    )
    stages = result.scalars().all()
    return [
        {**_m(s), "components": s.components}
        for s in stages
    ]


@router.post("/orders/{order_id}/stages/generate")
async def generate_stages(order_id: int, request: Request):
    """Создать этапы из recipe_stages изделия. Если не заданы — один этап 'Сборка' со всеми компонентами."""
    _perm(request, "orders.edit")
    db = _db(request)
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")

    # Удаляем старые этапы
    await db.execute(delete(OrderStage).where(OrderStage.order_id == order_id))

    # Читаем компоненты рецептуры
    recipes = (await db.execute(text(
        "SELECT component_name, production_type, source, norm, warehouse_component_name "
        "FROM recipes WHERE LOWER(TRIM(product_name))=:pn"
    ), {"pn": _norm(order.product_name)})).mappings().all()

    # Все компоненты для отображения на этапах
    all_components = [
        {
            "name": (r["warehouse_component_name"] or r["component_name"]).strip(),
            "qty": float(r["norm"]) * order.planned_qty,
            "source": r["source"] or "warehouse",
            "production_type": r["production_type"] or "",
        }
        for r in recipes
    ]

    # Читаем этапы из recipe_stages
    recipe_stages = (await db.execute(text(
        "SELECT id, stage_name, stage_type, sort_order, description, "
        "required_role, depends_on_previous, transfer_qty, instructions "
        "FROM recipe_stages WHERE LOWER(TRIM(product_name))=:pn ORDER BY sort_order, id"
    ), {"pn": _norm(order.product_name)})).mappings().all()

    # Пропускаем этапы, исключённые при создании заказа
    try:
        _skipped = set(json.loads(order.skipped_stage_ids or "[]"))
    except (ValueError, TypeError):
        _skipped = set()
    if _skipped:
        recipe_stages = [rs for rs in recipe_stages if rs["id"] not in _skipped]

    created = 0
    if recipe_stages:
        min_sort = min((rs["sort_order"] or 0) for rs in recipe_stages)
        # Используем вручную заданные этапы
        for rs in recipe_stages:
            stage_type = rs["stage_type"] or "assembly"
            stage_comps = [
                c for c in all_components
                if _component_matches_stage(c.get("source", "warehouse"), stage_type, c.get("production_type", ""))
            ] or all_components
            db.add(OrderStage(
                order_id=order_id,
                stage_type=stage_type,
                stage_name=rs["stage_name"],
                status=_initial_stage_status(rs["sort_order"] or 0, min_sort, rs["depends_on_previous"]),
                sort_order=rs["sort_order"] or 0,
                required_role=rs["required_role"],
                depends_on_previous=rs["depends_on_previous"] if rs["depends_on_previous"] is not None else 1,
                transfer_qty=rs["transfer_qty"] if rs["transfer_qty"] is not None else 0,
                instructions=rs["instructions"],
                components_json=json.dumps(stage_comps, ensure_ascii=False),
                comment=rs["description"],
            ))
            created += 1
    else:
        # Нет этапов — создаём один общий
        db.add(OrderStage(
            order_id=order_id,
            stage_type="assembly",
            stage_name="Сборка",
            status="pending",
            sort_order=0,
            components_json=json.dumps(all_components, ensure_ascii=False),
        ))
        created = 1

    await db.commit()
    # Возвращаем актуальный список этапов (а не {"created": N}), т.к. фронт
    # делает setStages(результат) — объект ломал stages.map на рендере.
    rows = (await db.execute(
        select(OrderStage).where(OrderStage.order_id == order_id).order_by(OrderStage.sort_order, OrderStage.id)
    )).scalars().all()
    return [{**_m(s), "components": s.components} for s in rows]


class CanonicalRouteRequest(BaseModel):
    needs_smd: Optional[bool] = None
    is_receiver: Optional[bool] = None
    needs_assembly: Optional[bool] = None
    replace: Optional[bool] = True   # удалить существующие этапы перед генерацией


@router.post("/orders/{order_id}/stages/generate-canonical")
async def generate_canonical_stages(order_id: int, body: CanonicalRouteRequest, request: Request):
    """Построить канонический маршрут по ТЗ (12 этапов) по признакам изделия.
    Признаки берутся из product_catalog и переопределяются полями запроса."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    if order.status in ("Отменен", "Отменён", "Завершен", "Завершён"):
        raise HTTPException(400, f"Заказ в терминальном статусе «{order.status}»")

    if body.replace:
        await db.execute(delete(OrderStage).where(OrderStage.order_id == order_id))

    # Компоненты рецептуры для отображения на этапах
    recipes = (await db.execute(text(
        "SELECT component_name, production_type, source, norm, warehouse_component_name "
        "FROM recipes WHERE LOWER(TRIM(product_name))=:pn"
    ), {"pn": _norm(order.product_name)})).mappings().all()
    stage_comps = [
        {"name": (r["warehouse_component_name"] or r["component_name"]).strip(),
         "qty": float(r["norm"]) * (order.planned_qty or 0),
         "source": r["source"] or "warehouse",
         "production_type": r["production_type"] or ""}
        for r in recipes
    ]

    flags = await _resolve_product_flags(db, order.product_name, body)
    created = await _add_canonical_stages(db, order_id, flags, stage_comps)

    if order.status == "Создан":
        await db.execute(
            update(Order).where(Order.id == order_id).values(status="В работе", updated_at=func.now())
        )
    await _audit(db, u, "order", order_id, "canonical_route_generated",
                 new_value=json.dumps(flags), details=json.dumps({"created": created}, ensure_ascii=False))
    await db.commit()
    rows = (await db.execute(
        select(OrderStage).where(OrderStage.order_id == order_id).order_by(OrderStage.sort_order, OrderStage.id)
    )).scalars().all()
    return {"created": created, "flags": flags,
            "stages": [{**_m(s), "components": s.components} for s in rows]}


@router.patch("/orders/{order_id}/stages/{stage_id}/assign")
async def assign_stage(order_id: int, stage_id: int, request: Request):
    """Назначить исполнителя на этап."""
    _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    employee_id = body.get("employee_id", "").strip()
    employee_name = body.get("employee_name", "").strip()

    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")

    u = _user(request)
    await db.execute(
        update(OrderStage)
        .where(OrderStage.id == stage_id)
        .values(assigned_to=employee_id, assigned_name=employee_name,
                status="pending",
                updated_at=func.now())
    )
    await _audit(db, u, "stage", stage_id, "stage_assigned",
                 new_value=employee_name or employee_id,
                 details=json.dumps({"order_id": order_id, "stage": stage.stage_name}, ensure_ascii=False))
    if employee_id:
        await notify_user(
            db, employee_id,
            f"Вам назначен этап «{stage.stage_name}»",
            f"Заказ №{order_id}", link="/my-tasks",
        )
    await db.commit()
    updated = (await db.execute(select(OrderStage).where(OrderStage.id == stage_id))).scalar_one()
    return {**_m(updated), "components": updated.components}


@router.post("/orders/{order_id}/stages/auto-assign")
async def auto_assign_order_stages(order_id: int, request: Request):
    """Автоматически распределить свободные этапы заказа по наименее загруженным операторам."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    from app.services.auto_assign import auto_assign_stages
    assigned = await auto_assign_stages(db, order_id, order.product_name)
    if assigned:
        await _audit(db, u, "order", order_id, "stages_auto_assigned",
                     new_value=", ".join(f"{a['stage_name']} → {a['user_name']}" for a in assigned))
    await db.commit()
    return {"success": True, "assigned": assigned,
            "message": f"Назначено этапов: {len(assigned)}" if assigned
                       else "Нет свободных этапов или подходящих операторов"}


# ── Multi-assignee endpoints ──────────────────────────────────────────────────

@router.get("/orders/{order_id}/stages/{stage_id}/assignees")
async def list_stage_assignees(order_id: int, stage_id: int, request: Request):
    """Список исполнителей этапа."""
    _perm(request, "orders.view")
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    rows = (await db.execute(
        select(StageAssignee).where(StageAssignee.stage_id == stage_id).order_by(StageAssignee.id)
    )).scalars().all()
    return [_m(r) for r in rows]


@router.post("/orders/{order_id}/stages/{stage_id}/assignees", status_code=201)
async def add_stage_assignee(order_id: int, stage_id: int, request: Request):
    """Добавить исполнителя на этап (с количеством)."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    user_id = int(body.get("user_id", 0))
    user_name = body.get("user_name", "").strip()
    qty_planned = int(body.get("qty_planned", 0))
    if qty_planned < 0:
        raise HTTPException(400, "Количество не может быть отрицательным")

    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")

    # Сумма распределённого по исполнителям не должна превышать количество заказа
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order and order.planned_qty and qty_planned:
        others_sum = (await db.execute(
            select(func.coalesce(func.sum(StageAssignee.qty_planned), 0))
            .where(StageAssignee.stage_id == stage_id, StageAssignee.user_id != user_id)
        )).scalar_one()
        if int(others_sum) + qty_planned > int(order.planned_qty):
            raise HTTPException(
                400, f"Распределено {int(others_sum) + qty_planned} шт. "
                     f"при количестве заказа {order.planned_qty} шт.")

    # Upsert: если уже есть — обновить количество
    existing = (await db.execute(
        select(StageAssignee).where(
            StageAssignee.stage_id == stage_id,
            StageAssignee.user_id == user_id,
        )
    )).scalar_one_or_none()

    if existing:
        await db.execute(
            update(StageAssignee)
            .where(StageAssignee.id == existing.id)
            .values(user_name=user_name or existing.user_name,
                    qty_planned=qty_planned,
                    updated_at=func.now())
        )
        await db.commit()
        row = (await db.execute(select(StageAssignee).where(StageAssignee.id == existing.id))).scalar_one()
        return _m(row)

    assignee = StageAssignee(
        stage_id=stage_id,
        user_id=user_id,
        user_name=user_name,
        qty_planned=qty_planned,
        status="pending",
    )
    db.add(assignee)
    await db.flush()
    await db.refresh(assignee)
    await _audit(db, u, "stage", stage_id, "assignee_added",
                 new_value=user_name or str(user_id),
                 details=json.dumps({"order_id": order_id, "stage": stage.stage_name,
                                     "qty": qty_planned}, ensure_ascii=False))
    await notify_user(
        db, user_id,
        f"Вам назначен этап «{stage.stage_name}»",
        f"Заказ №{order_id}, план: {qty_planned} шт.", link="/my-tasks",
    )
    await db.commit()
    return _m(assignee)


@router.delete("/orders/{order_id}/stages/{stage_id}/assignees/{user_id}", status_code=200)
async def remove_stage_assignee(order_id: int, stage_id: int, user_id: int, request: Request):
    """Убрать исполнителя с этапа."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    await db.execute(
        delete(StageAssignee).where(
            StageAssignee.stage_id == stage_id,
            StageAssignee.user_id == user_id,
        )
    )
    await _audit(db, u, "stage", stage_id, "assignee_removed",
                 new_value=str(user_id),
                 details=json.dumps({"order_id": order_id}, ensure_ascii=False))
    await db.commit()
    return {"success": True}


@router.patch("/orders/{order_id}/stages/{stage_id}/assignees/{user_id}/start")
async def start_assignee_work(order_id: int, stage_id: int, user_id: int, request: Request):
    """Исполнитель начинает свою часть работы."""
    u = _user(request)
    db = _db(request)
    if u.role not in ("admin", "manager") and u.id != user_id:
        raise HTTPException(403, "Нельзя изменить статус другого исполнителя")

    assignee = (await db.execute(
        select(StageAssignee).where(
            StageAssignee.stage_id == stage_id,
            StageAssignee.user_id == user_id,
        )
    )).scalar_one_or_none()
    if not assignee:
        raise HTTPException(404, "Исполнитель не найден в этапе")
    if assignee.status == "done":
        raise HTTPException(400, "Эта часть работы уже сдана")

    await db.execute(
        update(StageAssignee)
        .where(StageAssignee.id == assignee.id, StageAssignee.status != "done")
        .values(status="in_progress", started_at=func.now(), updated_at=func.now())
    )
    # Этап тоже переводим в in_progress если он ещё pending
    await db.execute(
        update(OrderStage)
        .where(OrderStage.id == stage_id, OrderStage.status == "pending")
        .values(status="in_progress", started_at=func.now(), updated_at=func.now())
    )
    await db.commit()
    row = (await db.execute(select(StageAssignee).where(StageAssignee.id == assignee.id))).scalar_one()
    return _m(row)


@router.patch("/orders/{order_id}/stages/{stage_id}/assignees/{user_id}/complete")
async def complete_assignee_work(order_id: int, stage_id: int, user_id: int, request: Request):
    """Исполнитель завершает свою часть работы."""
    u = _user(request)
    db = _db(request)
    if u.role not in ("admin", "manager") and u.id != user_id:
        raise HTTPException(403, "Нельзя изменить статус другого исполнителя")

    body = await request.json()
    qty_done = int(body.get("qty_done", 0))
    if qty_done < 0:
        raise HTTPException(400, "Количество не может быть отрицательным")

    assignee = (await db.execute(
        select(StageAssignee).where(
            StageAssignee.stage_id == stage_id,
            StageAssignee.user_id == user_id,
        )
    )).scalar_one_or_none()
    if not assignee:
        raise HTTPException(404, "Исполнитель не найден в этапе")
    if assignee.status == "done":
        raise HTTPException(400, "Эта часть работы уже сдана")
    if assignee.qty_planned and qty_done > int(assignee.qty_planned):
        raise HTTPException(400, f"Сдано {qty_done} шт. при плане {assignee.qty_planned} шт.")

    res = await db.execute(
        update(StageAssignee)
        .where(StageAssignee.id == assignee.id, StageAssignee.status != "done")
        .values(status="done", qty_done=qty_done, completed_at=func.now(), updated_at=func.now())
    )
    if res.rowcount == 0:
        raise HTTPException(409, "Эта часть работы уже сдана")

    # Проверяем — все ли исполнители сдали?
    all_assignees = (await db.execute(
        select(StageAssignee).where(StageAssignee.stage_id == stage_id)
    )).scalars().all()
    # Учитываем что текущий уже "done" (обновим позже после commit)
    all_done = all(
        (a.status == "done" or (a.user_id == user_id))
        for a in all_assignees
    )
    if all_done and all_assignees:
        # Завершаем весь этап (guard от двойного закрытия при одновременных запросах)
        stage_res = await db.execute(
            update(OrderStage)
            .where(OrderStage.id == stage_id, OrderStage.status != "done")
            .values(status="done", completed_at=func.now(), updated_at=func.now())
        )
        # Только тот запрос, который реально закрыл этап, продвигает воркфлоу —
        # иначе при гонке следующий этап разблокировался бы дважды.
        if stage_res.rowcount:
            stage = (await db.execute(
                select(OrderStage).where(OrderStage.id == stage_id)
            )).scalar_one()
            order = (await db.execute(
                select(Order).where(Order.id == order_id)
            )).scalar_one_or_none()
            await _advance_workflow_after_stage(db, order, stage, all_assignees)

    await db.commit()
    row = (await db.execute(select(StageAssignee).where(StageAssignee.id == assignee.id))).scalar_one()
    return _m(row)


async def _advance_workflow_after_stage(db, order, stage, stage_assignees):
    """После завершения этапа: записать на склад (если warehouse) и активировать
    следующий этап(ы). Вызывается из обоих путей завершения — ручного complete_stage
    и автоматического (когда все испол(assignees) сдали свою часть)."""
    # Если этап — склад готовой продукции, записываем в finished_goods переданное количество
    if stage.stage_type in FINISHED_GOODS_STAGES and order and order.product_name:
        done_total = sum(int(a.qty_done or 0) for a in stage_assignees)
        qty = int(stage.transferred_qty or 0) or done_total or int(order.planned_qty or 0)
        if qty > 0:
            await db.execute(text("""
                INSERT INTO finished_goods (product_name, good_qty, defect_qty, total_qty, updated_at)
                VALUES (:pn, :qty, 0, :qty, NOW())
                ON CONFLICT (product_name) DO UPDATE
                SET good_qty = finished_goods.good_qty + :qty,
                    total_qty = finished_goods.total_qty + :qty,
                    updated_at = NOW()
            """), {"pn": order.product_name, "qty": qty})

    # Активировать следующий этап если указан next_stage_id
    if stage.next_stage_id:
        next_stage = (await db.execute(
            select(OrderStage).where(OrderStage.id == stage.next_stage_id)
        )).scalar_one_or_none()
        if next_stage and next_stage.status in ("pending", "blocked"):
            await db.execute(
                update(OrderStage).where(OrderStage.id == stage.next_stage_id)
                .values(status="pending", updated_at=func.now())
            )
            await _notify_stage_audience(db, next_stage, order)
        return

    # Логика по sort_order: после завершения этапа разблокируем следующий
    # уровень параллельной группы, если все этапы предыдущих уровней завершены.
    all_stages = (await db.execute(
        select(OrderStage).where(OrderStage.order_id == stage.order_id).order_by(OrderStage.sort_order)
    )).scalars().all()
    # Текущий этап уже помечен done в БД, но в кэше all_stages — старый статус.
    done_ids = {s.id for s in all_stages if s.status == "done"} | {stage.id}

    # Следующий уровень sort_order среди ещё не завершённых этапов
    next_levels = sorted({
        s.sort_order for s in all_stages
        if s.sort_order > stage.sort_order and s.id not in done_ids
    })
    if next_levels:
        target_level = next_levels[0]
        # Все этапы строго предыдущих уровней должны быть завершены
        prev_levels_done = all(
            s.id in done_ids
            for s in all_stages
            if s.sort_order < target_level
        )
        if prev_levels_done:
            # Разблокируем все этапы целевого уровня (параллельная группа)
            for s in all_stages:
                if s.sort_order == target_level and s.status == "blocked":
                    await db.execute(
                        update(OrderStage).where(OrderStage.id == s.id)
                        .values(status="pending", updated_at=func.now())
                    )
                    await _notify_stage_audience(db, s, order)


async def _notify_stage_audience(db, stage, order):
    """Уведомить аудиторию активированного этапа (#41): назначенного исполнителя,
    либо роль этапа, либо (если не задано) — никого лишнего."""
    try:
        title = f"Этап «{stage.stage_name or stage.stage_type}» готов к работе"
        msg = f"Заказ №{stage.order_id}" + (f" · {order.product_name}" if order else "")
        if stage.assigned_to:
            await notify_user(db, str(stage.assigned_to), title, msg, link="/my-tasks", type_="info")
        elif stage.required_role:
            await notify_roles(db, [stage.required_role], title, msg, link="/my-tasks", type_="info")
    except Exception:
        logger.exception("notify stage audience failed (stage #%s)", getattr(stage, "id", "?"))


@router.patch("/orders/{order_id}/stages/{stage_id}/complete")
async def complete_stage(order_id: int, stage_id: int, request: Request):
    """Отметить этап как выполненный."""
    u = _user(request)  # доступно любому авторизованному пользователю
    db = _db(request)
    body = await request.json()
    comment = body.get("comment", "")

    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    if stage.status == "done":
        raise HTTPException(400, "Этап уже завершён")
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order and order.status in ("Отменен", "Отменён", "Завершен", "Завершён"):
        raise HTTPException(400, f"Заказ в терминальном статусе «{order.status}» — этап изменить нельзя")
    # Только назначенный исполнитель (assigned_to или в stage_assignees) или менеджер/админ
    if u.role not in ("admin", "manager"):
        is_assignee = stage.assigned_to == str(u.id)
        if not is_assignee:
            sa_row = (await db.execute(
                select(StageAssignee).where(
                    StageAssignee.stage_id == stage_id,
                    StageAssignee.user_id == u.id,
                )
            )).scalar_one_or_none()
            is_assignee = sa_row is not None
        if not is_assignee:
            raise HTTPException(403, "Вы не назначены на этот этап")

    stage_assignees = (await db.execute(
        select(StageAssignee).where(StageAssignee.stage_id == stage_id)
    )).scalars().all()
    # Исполнитель не может закрыть этап, пока не сдали все; менеджер/админ — может принудительно
    if u.role not in ("admin", "manager") and stage_assignees \
            and not all(a.status == "done" for a in stage_assignees):
        raise HTTPException(400, "Этап завершится, когда все исполнители сдадут свою часть "
                                 "(или менеджер завершит его принудительно)")

    res = await db.execute(
        update(OrderStage)
        .where(OrderStage.id == stage_id, OrderStage.status != "done")
        .values(status="done", completed_at=func.now(),
                comment=comment or stage.comment, updated_at=func.now())
    )
    if res.rowcount == 0:
        raise HTTPException(409, "Этап уже завершён")
    await _audit(db, u, "stage", stage_id, "stage_completed",
                 old_value=stage.status, new_value="done",
                 details=json.dumps({"order_id": order_id, "stage": stage.stage_name,
                                     "comment": comment}, ensure_ascii=False))

    await _advance_workflow_after_stage(db, order, stage, stage_assignees)

    # Webhook: этап завершён (+ признак, что все этапы заказа готовы)
    remaining = (await db.execute(text(
        "SELECT COUNT(*) FROM order_stages WHERE order_id=:oid AND status NOT IN ('done')"
    ), {"oid": order_id})).scalar() or 0
    await _fire_webhooks(db, "stage.completed", {
        "order_id": order_id, "stage_id": stage_id,
        "stage_name": stage.stage_name, "stage_type": stage.stage_type,
        "all_stages_done": remaining == 0,
    })

    await db.commit()
    updated = (await db.execute(select(OrderStage).where(OrderStage.id == stage_id))).scalar_one()
    return {**_m(updated), "components": updated.components}


# ── Гейты контроля качества (AOI / ОТК) канонического маршрута ─────────────────

class StageInspectRequest(BaseModel):
    result: str                              # "pass" | "fail"
    comment: Optional[str] = None
    photo_url: Optional[str] = None
    needs_components: Optional[bool] = False  # на ОТК: нужны ли ещё компоненты
    rework_stage_id: Optional[int] = None     # явный этап возврата (иначе авто по rework_target_type)


@router.post("/orders/{order_id}/stages/{stage_id}/inspect")
async def inspect_stage(order_id: int, stage_id: int, body: StageInspectRequest, request: Request):
    """Контроль качества на этапе-гейте (AOI после СМД, ОТК после сборки РЭА).

      result='pass' — годен: гейт закрывается, маршрут идёт дальше.
      result='fail' — брак: реактивируется этап-источник (rework_target_type:
                      AOI→СМД-монтаж, ОТК→сборка РЭА), а гейт блокируется до
                      повторной сдачи. needs_components=true (на ОТК) дополнительно
                      переводит заказ в «Ожидает компонентов».
    """
    u = _user(request)
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    order = (await db.execute(select(Order).where(Order.id == order_id))).scalar_one_or_none()
    if order and order.status in ("Отменен", "Отменён", "Завершен", "Завершён"):
        raise HTTPException(400, f"Заказ в терминальном статусе «{order.status}»")

    # Доступ: ОТК-роль / админ / менеджер, либо назначенный исполнитель этапа
    if u.role not in ("admin", "manager", "operator_otk"):
        is_assignee = stage.assigned_to == str(u.id)
        if not is_assignee:
            is_assignee = (await db.execute(
                select(StageAssignee.id).where(
                    StageAssignee.stage_id == stage_id, StageAssignee.user_id == u.id)
            )).scalar_one_or_none() is not None
        if not is_assignee:
            raise HTTPException(403, "Нет прав на проверку этого этапа")

    result = (body.result or "").lower()
    comment = (body.comment or "").strip()
    target_type = stage.rework_target_type or QC_GATES.get(stage.stage_type)

    if result == "pass" and not body.needs_components:
        # Годен → закрываем гейт и двигаем маршрут дальше
        stage_assignees = (await db.execute(
            select(StageAssignee).where(StageAssignee.stage_id == stage_id)
        )).scalars().all()
        await db.execute(
            update(OrderStage).where(OrderStage.id == stage_id).values(
                status="done", completed_at=func.now(),
                comment=comment or stage.comment,
                result_photo=body.photo_url or stage.result_photo, updated_at=func.now())
        )
        stage.status = "done"
        await _advance_workflow_after_stage(db, order, stage, stage_assignees)
        await _audit(db, u, "stage", stage_id, "inspect_pass",
                     new_value="pass",
                     details=json.dumps({"order_id": order_id, "comment": comment}, ensure_ascii=False))
        await _fire_webhooks(db, "stage.inspect_pass", {
            "order_id": order_id, "stage_id": stage_id, "stage_type": stage.stage_type})
        await db.commit()
        return {"result": "pass", "stage_id": stage_id, "rework_stage_id": None}

    # result == "fail" (или нужны компоненты) → возврат на доработку
    if result not in ("pass", "fail"):
        raise HTTPException(400, "result должен быть 'pass' или 'fail'")

    # Выбор этапа-источника для возврата брака
    target = None
    if body.rework_stage_id:
        target = (await db.execute(text("""
            SELECT id FROM order_stages WHERE id=:sid AND order_id=:oid AND id != :gate
        """), {"sid": body.rework_stage_id, "oid": order_id, "gate": stage_id})).scalar_one_or_none()
    if not target and target_type:
        target = (await db.execute(text("""
            SELECT id FROM order_stages
            WHERE order_id=:oid AND stage_type=:st AND id != :gate AND sort_order < :gs
            ORDER BY (status='done') DESC, sort_order DESC LIMIT 1
        """), {"oid": order_id, "st": target_type, "gate": stage_id, "gs": stage.sort_order})).scalar_one_or_none()
    if not target:
        target = (await db.execute(text("""
            SELECT id FROM order_stages
            WHERE order_id=:oid AND id != :gate AND sort_order < :gs
            ORDER BY sort_order DESC LIMIT 1
        """), {"oid": order_id, "gate": stage_id, "gs": stage.sort_order})).scalar_one_or_none()

    if target:
        await db.execute(text("""
            UPDATE order_stages SET status='pending', started_at=NULL,
                completed_at=NULL, updated_at=NOW() WHERE id=:sid
        """), {"sid": target})
        await db.execute(text("""
            UPDATE stage_assignees SET status='pending', started_at=NULL,
                completed_at=NULL, updated_at=NOW() WHERE stage_id=:sid
        """), {"sid": target})

    # Блокируем сам гейт до повторной сдачи источника
    await db.execute(text("""
        UPDATE order_stages SET status='blocked', started_at=NULL,
            completed_at=NULL, result_photo=:p, updated_at=NOW() WHERE id=:gate
    """), {"gate": stage_id, "p": body.photo_url or stage.result_photo})

    # Статус заказа
    new_status = "Ожидает компонентов" if body.needs_components else "Доработка"
    await db.execute(text("""
        UPDATE orders SET status=:s, otk_comment=:c,
            otk_attempts = COALESCE(otk_attempts,0) + CASE WHEN :is_otk THEN 1 ELSE 0 END,
            updated_at=NOW() WHERE id=:oid
    """), {"s": new_status, "c": comment, "oid": order_id, "is_otk": stage.stage_type == "otk"})

    # Уведомления исполнителям источника + руководителям
    notify_ids = set()
    if target:
        a = (await db.execute(text("SELECT assigned_to FROM order_stages WHERE id=:sid"),
                              {"sid": target})).scalar()
        if a:
            notify_ids.add(str(a))
        sa = (await db.execute(text(
            "SELECT DISTINCT user_id FROM stage_assignees WHERE stage_id=:sid AND user_id IS NOT NULL"
        ), {"sid": target})).scalars().all()
        notify_ids |= {str(i) for i in sa}
    gate_label = CANONICAL_STAGE_LABELS.get(stage.stage_type, stage.stage_type)
    msg = f"{(order.product_name if order else '')}: брак на «{gate_label}». {comment}".strip()
    for uid in notify_ids:
        await notify_user(db, uid, f"Заказ №{order_id}: возврат на доработку", msg,
                          link="/my-tasks", type_="warning")
    await notify_managers(db, f"{gate_label}: заказ №{order_id} — брак", msg,
                          link=f"/orders/{order_id}", type_="warning")
    if body.needs_components:
        await notify_managers(db, f"Заказ №{order_id}: требуются доп. компоненты",
                              msg, link=f"/orders/{order_id}", type_="warning")

    await _audit(db, u, "stage", stage_id, "inspect_fail",
                 new_value="fail",
                 details=json.dumps({"order_id": order_id, "rework_stage_id": target,
                                     "needs_components": bool(body.needs_components),
                                     "comment": comment}, ensure_ascii=False))
    await _fire_webhooks(db, "stage.inspect_fail", {
        "order_id": order_id, "stage_id": stage_id, "stage_type": stage.stage_type,
        "rework_stage_id": target})
    await db.commit()
    return {"result": "fail", "stage_id": stage_id, "rework_stage_id": target,
            "order_status": new_status}


# ── Маршрутизатор этапов ──────────────────────────────────────────────────────

@router.get("/orders/{order_id}/stages/{stage_id}/route-options")
async def route_options(order_id: int, stage_id: int, request: Request):
    """Кандидаты для следующего шага после этапа: другие незавершённые этапы заказа."""
    _perm(request, "orders.view")
    db = _db(request)
    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")
    others = (await db.execute(
        select(OrderStage)
        .where(OrderStage.order_id == order_id, OrderStage.id != stage_id,
               OrderStage.status != "done")
        .order_by(OrderStage.sort_order, OrderStage.id)
    )).scalars().all()
    return {
        "current": {**_m(stage), "components": stage.components},
        "existing_stages": [
            {"id": s.id, "stage_type": s.stage_type, "stage_name": s.stage_name,
             "status": s.status, "sort_order": s.sort_order}
            for s in others
        ],
    }


@router.post("/orders/{order_id}/stages/{stage_id}/route-next")
async def route_next(order_id: int, stage_id: int, request: Request):
    """Выбрать следующий шаг после этапа.

    body.action:
      "existing" — связать с существующим этапом (body.next_stage_id) и активировать его;
      "new"      — создать новый этап (stage_type/stage_name/required_role/instructions),
                   поставить его следующим и активировать.
    """
    u = _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    action = body.get("action", "new")

    stage = (await db.execute(
        select(OrderStage).where(OrderStage.id == stage_id, OrderStage.order_id == order_id)
    )).scalar_one_or_none()
    if not stage:
        raise HTTPException(404, "Этап не найден")

    if action == "existing":
        nid = body.get("next_stage_id")
        if not nid:
            raise HTTPException(400, "Не указан next_stage_id")
        nxt = (await db.execute(
            select(OrderStage).where(OrderStage.id == nid, OrderStage.order_id == order_id)
        )).scalar_one_or_none()
        if not nxt:
            raise HTTPException(404, "Целевой этап не найден")
        await db.execute(
            update(OrderStage).where(OrderStage.id == stage_id).values(next_stage_id=nid, updated_at=func.now())
        )
        if nxt.status in ("pending", "blocked"):
            await db.execute(
                update(OrderStage).where(OrderStage.id == nid).values(status="pending", updated_at=func.now())
            )
        await _audit(db, u, "stage", stage_id, "route_next",
                     new_value=str(nid),
                     details=json.dumps({"order_id": order_id, "action": "existing"}, ensure_ascii=False))
        await db.commit()
        result = (await db.execute(select(OrderStage).where(OrderStage.id == nid))).scalar_one()
        return {**_m(result), "components": result.components}

    # action == "new"
    max_sort = (await db.execute(
        select(func.max(OrderStage.sort_order)).where(OrderStage.order_id == order_id)
    )).scalar() or 0
    new_stage = OrderStage(
        order_id=order_id,
        stage_type=body.get("stage_type", "otk"),
        stage_name=body.get("stage_name") or body.get("stage_type", "ОТК"),
        status="pending",
        sort_order=max_sort + 1,
        required_role=body.get("required_role"),
        instructions=body.get("instructions"),
        components_json="[]",
    )
    db.add(new_stage)
    await db.flush()
    await db.execute(
        update(OrderStage).where(OrderStage.id == stage_id).values(next_stage_id=new_stage.id, updated_at=func.now())
    )
    await _audit(db, u, "stage", stage_id, "route_next",
                 new_value=new_stage.stage_type,
                 details=json.dumps({"order_id": order_id, "action": "new",
                                     "new_stage_id": new_stage.id}, ensure_ascii=False))
    await db.commit()
    await db.refresh(new_stage)
    return {**_m(new_stage), "components": new_stage.components}


# ── Шаблоны маршрутов (#33) ───────────────────────────────────────────────────

@router.get("/route-templates")
async def list_route_templates(request: Request):
    _perm(request, "orders.view")
    db = _db(request)
    rows = (await db.execute(select(StageRouteTemplate).order_by(StageRouteTemplate.name))).scalars().all()
    out = []
    for r in rows:
        d = _m(r)
        try: d["stages"] = json.loads(r.stages_json or "[]")
        except Exception: d["stages"] = []
        out.append(d)
    return out


@router.post("/route-templates")
async def create_route_template(request: Request):
    """Сохранить шаблон маршрута. body: {name, description?, stages?[], from_order_id?}.
    Если задан from_order_id — этапы берутся из этого заказа."""
    _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "Укажите название шаблона")
    stages = body.get("stages")
    if body.get("from_order_id"):
        src = (await db.execute(
            select(OrderStage).where(OrderStage.order_id == body["from_order_id"])
            .order_by(OrderStage.sort_order, OrderStage.id)
        )).scalars().all()
        stages = [{
            "stage_name": s.stage_name, "stage_type": s.stage_type,
            "required_role": s.required_role, "sort_order": s.sort_order,
            "depends_on_previous": s.depends_on_previous, "instructions": s.instructions,
            "est_minutes": s.est_minutes,
        } for s in src]
    item = StageRouteTemplate(name=name, description=body.get("description"),
                              stages_json=json.dumps(stages or [], ensure_ascii=False))
    db.add(item)
    await db.flush()
    await db.commit()
    await db.refresh(item)
    d = _m(item); d["stages"] = stages or []
    return d


@router.delete("/route-templates/{tid}")
async def delete_route_template(tid: int, request: Request):
    _perm(request, "orders.edit")
    db = _db(request)
    item = (await db.execute(select(StageRouteTemplate).where(StageRouteTemplate.id == tid))).scalar_one_or_none()
    if not item:
        raise HTTPException(404)
    await db.delete(item)
    await db.commit()
    return {"ok": True}


@router.post("/orders/{order_id}/stages/from-template/{tid}")
async def apply_route_template(order_id: int, tid: int, request: Request):
    """Применить шаблон маршрута к заказу: создаёт этапы из шаблона."""
    u = _perm(request, "orders.edit")
    db = _db(request)
    tpl = (await db.execute(select(StageRouteTemplate).where(StageRouteTemplate.id == tid))).scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    try:
        stages = json.loads(tpl.stages_json or "[]")
    except Exception:
        stages = []
    base_sort = (await db.execute(
        select(func.max(OrderStage.sort_order)).where(OrderStage.order_id == order_id)
    )).scalar()
    base = (base_sort + 1) if base_sort is not None else 0
    created = 0
    for i, s in enumerate(stages):
        db.add(OrderStage(
            order_id=order_id,
            stage_type=s.get("stage_type", "assembly"),
            stage_name=s.get("stage_name") or s.get("stage_type", "Этап"),
            status="pending" if (base == 0 and i == 0) else "blocked",
            sort_order=base + (s.get("sort_order") or i),
            required_role=s.get("required_role"),
            depends_on_previous=s.get("depends_on_previous", 1),
            instructions=s.get("instructions"),
            est_minutes=s.get("est_minutes"),
            components_json="[]",
        ))
        created += 1
    await _audit(db, u, "order", order_id, "route_template_applied",
                 new_value=tpl.name, details=json.dumps({"created": created}, ensure_ascii=False))
    await db.commit()
    rows = (await db.execute(
        select(OrderStage).where(OrderStage.order_id == order_id).order_by(OrderStage.sort_order, OrderStage.id)
    )).scalars().all()
    return [{**_m(s), "components": s.components} for s in rows]


# ── Custom Fields ─────────────────────────────────────────────────────────────

@router.get("/custom-fields/definitions")
async def list_field_defs(request: Request):
    _perm(request, "orders.view")
    db = _db(request)
    rows = (await db.execute(
        select(CustomFieldDefinition).where(CustomFieldDefinition.is_active == True)
        .order_by(CustomFieldDefinition.sort_order, CustomFieldDefinition.id)
    )).scalars().all()
    result = []
    for r in rows:
        d = _m(r)
        d["options"] = json.loads(d["options"] or "[]")
        result.append(d)
    return result


@router.post("/custom-fields/definitions", status_code=201)
async def create_field_def(request: Request):
    _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    name = (body.get("name") or "").strip().lower().replace(" ", "_")
    label = (body.get("label") or "").strip()
    if not name or not label:
        raise HTTPException(400, "name и label обязательны")
    if (await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.name == name))).scalar_one_or_none():
        raise HTTPException(409, f"Поле '{name}' уже существует")
    item = CustomFieldDefinition(
        name=name, label=label,
        field_type=body.get("field_type", "text"),
        required=body.get("required", False),
        options=json.dumps(body.get("options", [])),
        sort_order=body.get("sort_order", 0),
        is_active=body.get("is_active", True),
    )
    db.add(item)
    await db.flush()
    await db.commit()
    d = _m(item)
    d["options"] = json.loads(d["options"] or "[]")
    return d


@router.patch("/custom-fields/definitions/{field_id}")
async def update_field_def(field_id: int, request: Request):
    _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.id == field_id))).scalar_one_or_none()
    if not item: raise HTTPException(404, "Поле не найдено")
    for k in ["label", "required", "sort_order", "is_active", "field_type"]:
        if k in body: setattr(item, k, body[k])
    if "options" in body:
        item.options = json.dumps(body["options"])
    await db.flush()
    await db.commit()
    d = _m(item)
    d["options"] = json.loads(d["options"] or "[]")
    return d


@router.delete("/custom-fields/definitions/{field_id}")
async def delete_field_def(field_id: int, request: Request):
    _perm(request, "orders.edit")
    db = _db(request)
    item = (await db.execute(select(CustomFieldDefinition).where(CustomFieldDefinition.id == field_id))).scalar_one_or_none()
    if not item: raise HTTPException(404, "Поле не найдено")
    await db.delete(item)
    await db.commit()
    return {"success": True}


@router.get("/orders/{order_id}/custom-fields")
async def get_order_custom_fields(order_id: int, request: Request):
    _perm(request, "orders.view")
    db = _db(request)
    rows = (await db.execute(
        select(CustomFieldValue).where(CustomFieldValue.order_id == order_id)
    )).scalars().all()
    return {r.field_id: r.value for r in rows}


@router.put("/orders/{order_id}/custom-fields")
async def set_order_custom_fields(order_id: int, request: Request):
    """Upsert кастомных полей заказа. Body: {field_id: value, ...}"""
    _perm(request, "orders.edit")
    db = _db(request)
    body = await request.json()  # {field_id_str: value}
    for field_id_str, value in body.items():
        field_id = int(field_id_str)
        existing = (await db.execute(
            select(CustomFieldValue).where(
                CustomFieldValue.order_id == order_id, CustomFieldValue.field_id == field_id
            )
        )).scalar_one_or_none()
        if existing:
            existing.value = str(value) if value is not None else None
        else:
            db.add(CustomFieldValue(order_id=order_id, field_id=field_id, value=str(value) if value is not None else None))
    await db.commit()
    return {"success": True}


# ── Order Comments ────────────────────────────────────────────────────────────

@router.get("/orders/{order_id}/comments")
async def list_comments(order_id: int, request: Request):
    _perm(request, "orders.view")
    db = _db(request)
    rows = (await db.execute(
        select(OrderComment)
        .where(OrderComment.order_id == order_id)
        .order_by(OrderComment.created_at.asc())
    )).scalars().all()
    return [_m(r) for r in rows]


@router.post("/orders/{order_id}/comments", status_code=201)
async def add_comment(order_id: int, request: Request):
    _perm(request, "orders.view")  # любой авторизованный
    u = _user(request)
    db = _db(request)
    body = await request.json()
    text_body = (body.get("text") or "").strip()
    if not text_body:
        raise HTTPException(400, "Текст комментария не может быть пустым")
    author = getattr(u, "full_name", None) or getattr(u, "username", str(u.id))
    comment = OrderComment(
        order_id=order_id,
        user_id=u.id,
        user_name=author,
        text=text_body,
    )
    db.add(comment)
    await db.flush()

    # Упоминания @username → уведомление упомянутым
    mentions = set(re.findall(r"@([A-Za-z0-9_.\-]+)", text_body))
    if mentions:
        rows = (await db.execute(text(
            "SELECT id, username FROM users WHERE username = ANY(:names)"
        ), {"names": list(mentions)})).mappings().all()
        for r in rows:
            if r["id"] == u.id:
                continue
            await notify_user(db, str(r["id"]),
                              f"Вас упомянули в заказе №{order_id}",
                              f"{author}: {text_body[:140]}",
                              link=f"/orders/{order_id}", type_="info")

    await db.commit()
    await db.refresh(comment)
    return _m(comment)


@router.delete("/orders/{order_id}/comments/{comment_id}")
async def delete_comment(order_id: int, comment_id: int, request: Request):
    u = _user(request)
    db = _db(request)
    comment = (await db.execute(
        select(OrderComment).where(OrderComment.id == comment_id, OrderComment.order_id == order_id)
    )).scalar_one_or_none()
    if not comment:
        raise HTTPException(404, "Комментарий не найден")
    if u.role not in ("admin", "manager") and comment.user_id != u.id:
        raise HTTPException(403, "Нельзя удалить чужой комментарий")
    await db.delete(comment)
    await db.commit()
    return {"success": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _gen_batch_id(db, ptype: str) -> str:
    prefix_map = {"SMD": "SMD", "Сборка": "SB", "Гравировка": "EN", "3D Печать": "3D"}
    prefix = prefix_map.get(ptype, "PR")
    date_part = datetime.utcnow().strftime("%y%m%d")
    base = f"P{date_part}-{prefix}000"
    bid, suffix = base, 1
    while (await db.execute(
        select(ProductionBatch.batch_id).where(ProductionBatch.batch_id == bid)
    )).scalar_one_or_none():
        bid = f"{base}-{suffix}"
        suffix += 1
    return bid


async def _gen_otk_id(db, ptype: str, operator_id: str) -> str:
    prefix_map = {"SMD": "SMD", "Сборка": "SB", "3D Печать": "3D", "Гравировка": "EN"}
    prefix = prefix_map.get(ptype, "OTK")
    op_short = (operator_id or "000")[-3:].zfill(3)
    date_part = datetime.utcnow().strftime("%y%m%d")
    base = f"P{date_part}-{prefix}{op_short}"
    bid, suffix = base, 1
    while (await db.execute(text(
        "SELECT 1 FROM otk_batches WHERE batch_id=:b"
    ), {"b": bid})).scalar_one_or_none():
        bid = f"{base}-{suffix}"
        suffix += 1
    return bid
