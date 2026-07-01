"""Settings endpoints: stage types, roles, order statuses, priorities, notifications, audit."""
import json
from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, delete

from app.models.admin import StageType, SystemRole, OrderStatus, StatusTransition, Priority, Notification, AuditLog, SlaRule, Webhook, NotificationSubscription

router = APIRouter()


def _db(r): return r.state.db
def _user(r):
    u = r.state.current_user
    if not u: raise HTTPException(401, "Не авторизован")
    return u
def _admin(r):
    u = _user(r)
    if u.role != "admin": raise HTTPException(403, "Только для администраторов")
    return u
def _m(obj) -> dict:
    return {c.key: getattr(obj, c.key) for c in obj.__mapper__.column_attrs}


# ── A. Stage Types ────────────────────────────────────────────────────────────

@router.get("/stage-types")
async def list_stage_types(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(select(StageType).order_by(StageType.sort_order, StageType.id))).scalars().all()
    return [_m(r) for r in rows]


@router.post("/stage-types")
async def create_stage_type(request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    code = (body.get("code") or "").strip().lower().replace(" ", "_")
    label = (body.get("label") or "").strip()
    if not code or not label:
        raise HTTPException(400, "code и label обязательны")
    if (await db.execute(select(StageType).where(StageType.code == code))).scalar_one_or_none():
        raise HTTPException(409, f"Тип '{code}' уже существует")
    item = StageType(
        code=code, label=label,
        color=body.get("color", "#6b7280"),
        icon=body.get("icon"),
        sort_order=body.get("sort_order", 0),
        is_active=body.get("is_active", True),
    )
    db.add(item)
    await db.flush()
    return _m(item)


@router.patch("/stage-types/{item_id}")
async def update_stage_type(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(StageType).where(StageType.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    for k in ["label", "color", "icon", "sort_order", "is_active"]:
        if k in body: setattr(item, k, body[k])
    await db.flush()
    await db.refresh(item)  # подтянуть onupdate updated_at внутри async-контекста (иначе MissingGreenlet → 500)
    return _m(item)


@router.delete("/stage-types/{item_id}")
async def delete_stage_type(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    item = (await db.execute(select(StageType).where(StageType.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    await db.delete(item)
    return {"ok": True}


# ── B. System Roles ──────────────────────────────────────────────────────────

@router.get("/system-roles")
async def list_system_roles(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(select(SystemRole).order_by(SystemRole.label))).scalars().all()
    return [_m(r) for r in rows]


@router.post("/system-roles")
async def create_system_role(request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    code = (body.get("code") or "").strip().lower().replace(" ", "_")
    label = (body.get("label") or "").strip()
    if not code or not label: raise HTTPException(400, "code и label обязательны")
    if (await db.execute(select(SystemRole).where(SystemRole.code == code))).scalar_one_or_none():
        raise HTTPException(409, f"Роль '{code}' уже существует")
    item = SystemRole(
        code=code, label=label,
        allowed_stage_types=json.dumps(body.get("allowed_stage_types", [])),
        is_production=body.get("is_production", False),
        is_active=body.get("is_active", True),
    )
    db.add(item)
    await db.flush()
    row = _m(item)
    row["allowed_stage_types"] = json.loads(row["allowed_stage_types"] or "[]")
    return row


@router.patch("/system-roles/{item_id}")
async def update_system_role(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(SystemRole).where(SystemRole.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    for k in ["label", "is_production", "is_active"]:
        if k in body: setattr(item, k, body[k])
    if "allowed_stage_types" in body:
        item.allowed_stage_types = json.dumps(body["allowed_stage_types"])
    await db.flush()
    await db.refresh(item)  # подтянуть onupdate updated_at внутри async-контекста (иначе MissingGreenlet → 500)
    row = _m(item)
    row["allowed_stage_types"] = json.loads(row["allowed_stage_types"] or "[]")
    return row


@router.delete("/system-roles/{item_id}")
async def delete_system_role(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    item = (await db.execute(select(SystemRole).where(SystemRole.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    await db.delete(item)
    return {"ok": True}


# ── C. Order Statuses & Transitions ──────────────────────────────────────────

@router.get("/order-statuses")
async def list_order_statuses(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(select(OrderStatus).order_by(OrderStatus.sort_order, OrderStatus.id))).scalars().all()
    return [_m(r) for r in rows]


@router.post("/order-statuses")
async def create_order_status(request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    code = (body.get("code") or "").strip()
    label = (body.get("label") or "").strip()
    if not code or not label: raise HTTPException(400, "code и label обязательны")
    if (await db.execute(select(OrderStatus).where(OrderStatus.code == code))).scalar_one_or_none():
        raise HTTPException(409, f"Статус '{code}' уже существует")
    item = OrderStatus(
        code=code, label=label,
        color=body.get("color", "#6b7280"),
        is_terminal=body.get("is_terminal", False),
        sort_order=body.get("sort_order", 0),
        is_active=body.get("is_active", True),
    )
    db.add(item)
    await db.flush()
    return _m(item)


@router.patch("/order-statuses/{item_id}")
async def update_order_status(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(OrderStatus).where(OrderStatus.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    for k in ["label", "color", "is_terminal", "sort_order", "is_active"]:
        if k in body: setattr(item, k, body[k])
    await db.flush()
    await db.refresh(item)  # подтянуть onupdate updated_at внутри async-контекста (иначе MissingGreenlet → 500)
    return _m(item)


@router.delete("/order-statuses/{item_id}")
async def delete_order_status(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    item = (await db.execute(select(OrderStatus).where(OrderStatus.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    await db.delete(item)
    return {"ok": True}


@router.get("/status-transitions")
async def list_transitions(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(select(StatusTransition).order_by(StatusTransition.from_status))).scalars().all()
    result = []
    for r in rows:
        d = _m(r)
        d["allowed_roles"] = json.loads(d["allowed_roles"] or "[]")
        result.append(d)
    return result


@router.post("/status-transitions")
async def create_transition(request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    item = StatusTransition(
        from_status=body["from_status"],
        to_status=body["to_status"],
        allowed_roles=json.dumps(body.get("allowed_roles", [])),
    )
    db.add(item)
    await db.flush()
    d = _m(item)
    d["allowed_roles"] = json.loads(d["allowed_roles"] or "[]")
    return d


@router.delete("/status-transitions/{item_id}")
async def delete_transition(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    item = (await db.execute(select(StatusTransition).where(StatusTransition.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    await db.delete(item)
    return {"ok": True}


# ── F. Priorities ─────────────────────────────────────────────────────────────

@router.get("/priorities")
async def list_priorities(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(select(Priority).order_by(Priority.sort_weight.desc(), Priority.id))).scalars().all()
    return [_m(r) for r in rows]


@router.post("/priorities")
async def create_priority(request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    code = (body.get("code") or "").strip()
    label = (body.get("label") or "").strip()
    if not code or not label: raise HTTPException(400, "code и label обязательны")
    if (await db.execute(select(Priority).where(Priority.code == code))).scalar_one_or_none():
        raise HTTPException(409, f"Приоритет '{code}' уже существует")
    item = Priority(code=code, label=label, color=body.get("color", "#6b7280"), sort_weight=body.get("sort_weight", 0), is_active=body.get("is_active", True))
    db.add(item)
    await db.flush()
    return _m(item)


@router.patch("/priorities/{item_id}")
async def update_priority(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(Priority).where(Priority.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    for k in ["label", "color", "sort_weight", "is_active"]:
        if k in body: setattr(item, k, body[k])
    await db.flush()
    await db.refresh(item)  # подтянуть onupdate updated_at внутри async-контекста (иначе MissingGreenlet → 500)
    return _m(item)


@router.delete("/priorities/{item_id}")
async def delete_priority(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    item = (await db.execute(select(Priority).where(Priority.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    await db.delete(item)
    return {"ok": True}


# ── L. Webhooks ───────────────────────────────────────────────────────────────

@router.get("/webhooks")
async def list_webhooks(request: Request):
    _admin(request)
    db = _db(request)
    rows = (await db.execute(select(Webhook).order_by(Webhook.id))).scalars().all()
    return [_m(r) for r in rows]


@router.post("/webhooks")
async def create_webhook(request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    url = (body.get("url") or "").strip()
    name = (body.get("name") or "").strip()
    if not url or not name:
        raise HTTPException(400, "name и url обязательны")
    events = body.get("events") or []
    item = Webhook(name=name, url=url,
                   events=json.dumps(events, ensure_ascii=False),
                   secret=body.get("secret") or None,
                   is_active=body.get("is_active", True))
    db.add(item)
    await db.flush()
    return _m(item)


@router.patch("/webhooks/{item_id}")
async def update_webhook(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(Webhook).where(Webhook.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    for k in ["name", "url", "secret", "is_active"]:
        if k in body: setattr(item, k, body[k])
    if "events" in body:
        item.events = json.dumps(body["events"], ensure_ascii=False)
    await db.flush()
    await db.refresh(item)  # подтянуть onupdate updated_at внутри async-контекста (иначе MissingGreenlet → 500)
    return _m(item)


@router.delete("/webhooks/{item_id}")
async def delete_webhook(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    item = (await db.execute(select(Webhook).where(Webhook.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    await db.delete(item)
    return {"ok": True}


@router.post("/webhooks/{item_id}/test")
async def test_webhook(item_id: int, request: Request):
    """Тестовый вызов webhook."""
    _admin(request)
    db = _db(request)
    import httpx
    from sqlalchemy import func as _func
    item = (await db.execute(select(Webhook).where(Webhook.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    payload = {"event": "test", "message": "Тестовый вызов из Germess CRM"}
    status = "ok"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.post(item.url, json=payload)
            status = f"{resp.status_code}"
    except Exception as e:
        status = f"error: {str(e)[:80]}"
    item.last_status = status
    item.last_called_at = _func.now()
    await db.flush()
    return {"status": status}


# ── G. Подписки на уведомления ────────────────────────────────────────────────

@router.get("/notification-subscriptions")
async def list_subscriptions(request: Request):
    u = _user(request)
    db = _db(request)
    q = select(NotificationSubscription)
    rows = (await db.execute(q)).scalars().all()
    # отдаём подписки, относящиеся к текущему пользователю или его роли
    out = [_m(r) for r in rows if r.user_id == u.id or (r.role and r.role == u.role)]
    return out


@router.put("/notification-subscriptions")
async def set_subscription(request: Request):
    """Включить/выключить подписку текущего пользователя на тип события."""
    u = _user(request)
    db = _db(request)
    body = await request.json()
    event_type = (body.get("event_type") or "").strip()
    enabled = bool(body.get("enabled", True))
    if not event_type:
        raise HTTPException(400, "event_type обязателен")
    item = (await db.execute(
        select(NotificationSubscription).where(
            NotificationSubscription.user_id == u.id,
            NotificationSubscription.event_type == event_type,
        )
    )).scalar_one_or_none()
    if item:
        item.enabled = enabled
    else:
        item = NotificationSubscription(user_id=u.id, event_type=event_type, enabled=enabled)
        db.add(item)
    await db.flush()
    return _m(item)


# ── G. Notifications ──────────────────────────────────────────────────────────

@router.get("/notifications")
async def get_notifications(request: Request):
    user = _user(request)
    db = _db(request)
    rows = (await db.execute(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )).scalars().all()
    return [_m(r) for r in rows]


@router.get("/notifications/unread-count")
async def unread_count(request: Request):
    user = _user(request)
    db = _db(request)
    from sqlalchemy import func
    count = (await db.execute(
        select(func.count()).where(Notification.user_id == user.id, Notification.is_read == False)
    )).scalar()
    return {"count": count}


@router.post("/notifications/read-all")
async def mark_all_read(request: Request):
    user = _user(request)
    db = _db(request)
    from sqlalchemy import update
    await db.execute(
        update(Notification).where(Notification.user_id == user.id, Notification.is_read == False).values(is_read=True)
    )
    return {"ok": True}


@router.patch("/notifications/{notif_id}/read")
async def mark_read(notif_id: int, request: Request):
    user = _user(request)
    db = _db(request)
    item = (await db.execute(
        select(Notification).where(Notification.id == notif_id, Notification.user_id == user.id)
    )).scalar_one_or_none()
    if not item: raise HTTPException(404)
    item.is_read = True
    await db.flush()
    return _m(item)


@router.post("/notifications/send")
async def send_notification(request: Request):
    """Internal endpoint to create a notification for a user."""
    _user(request)
    db = _db(request)
    body = await request.json()
    notif = Notification(
        user_id=body["user_id"],
        type=body.get("type", "info"),
        title=body["title"],
        message=body.get("message"),
        link=body.get("link"),
    )
    db.add(notif)
    await db.flush()
    return _m(notif)


# ── H. Audit Log ─────────────────────────────────────────────────────────────

@router.get("/audit-log")
async def get_audit_log(request: Request, entity_type: str = None, entity_id: int = None, limit: int = 100):
    _user(request)
    db = _db(request)
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(limit)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [_m(r) for r in rows]


@router.post("/audit-log")
async def create_audit_entry(request: Request):
    """Internal endpoint — called by other services to log actions."""
    _user(request)
    db = _db(request)
    body = await request.json()
    user = _user(request)
    entry = AuditLog(
        entity_type=body.get("entity_type", "unknown"),
        entity_id=body.get("entity_id"),
        user_id=user.id,
        user_name=getattr(user, "full_name", None) or getattr(user, "username", str(user.id)),
        action=body.get("action", "unknown"),
        old_value=body.get("old_value"),
        new_value=body.get("new_value"),
        details=body.get("details"),
    )
    db.add(entry)
    await db.flush()
    return _m(entry)


# ── N. SLA Rules ──────────────────────────────────────────────────────────────

@router.get("/sla-rules")
async def list_sla_rules(request: Request):
    _user(request)
    db = _db(request)
    rows = (await db.execute(select(SlaRule).order_by(SlaRule.id))).scalars().all()
    result = []
    for r in rows:
        d = _m(r)
        d["notify_roles"] = json.loads(d["notify_roles"] or "[]")
        result.append(d)
    return result


@router.post("/sla-rules")
async def create_sla_rule(request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    status = (body.get("status") or "").strip()
    if not status:
        raise HTTPException(400, "status обязателен")
    if (await db.execute(select(SlaRule).where(SlaRule.status == status))).scalar_one_or_none():
        raise HTTPException(409, f"SLA для статуса '{status}' уже существует")
    item = SlaRule(
        status=status,
        max_hours=int(body.get("max_hours", 24)),
        notify_roles=json.dumps(body.get("notify_roles", [])),
        is_active=body.get("is_active", True),
    )
    db.add(item)
    await db.flush()
    d = _m(item)
    d["notify_roles"] = json.loads(d["notify_roles"] or "[]")
    return d


@router.patch("/sla-rules/{item_id}")
async def update_sla_rule(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    body = await request.json()
    item = (await db.execute(select(SlaRule).where(SlaRule.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    for k in ["max_hours", "is_active"]:
        if k in body: setattr(item, k, body[k])
    if "notify_roles" in body:
        item.notify_roles = json.dumps(body["notify_roles"])
    await db.flush()
    await db.refresh(item)  # подтянуть onupdate updated_at внутри async-контекста (иначе MissingGreenlet → 500)
    d = _m(item)
    d["notify_roles"] = json.loads(d["notify_roles"] or "[]")
    return d


@router.delete("/sla-rules/{item_id}")
async def delete_sla_rule(item_id: int, request: Request):
    _admin(request)
    db = _db(request)
    item = (await db.execute(select(SlaRule).where(SlaRule.id == item_id))).scalar_one_or_none()
    if not item: raise HTTPException(404)
    await db.delete(item)
    return {"ok": True}


@router.get("/sla-rules/check")
async def check_sla_violations(request: Request):
    """Возвращает заказы, нарушившие SLA (просрочены). Для фронта и фонового мониторинга."""
    _user(request)
    db = _db(request)
    from sqlalchemy import text as _text, func as _func
    from datetime import datetime, timedelta
    rules = (await db.execute(select(SlaRule).where(SlaRule.is_active == True))).scalars().all()
    if not rules:
        return []
    violations = []
    for rule in rules:
        cutoff = datetime.utcnow() - timedelta(hours=rule.max_hours)
        rows = (await db.execute(_text("""
            SELECT id, product_name, status, updated_at, deadline
            FROM orders
            WHERE status = :st AND updated_at < :cutoff
            AND status NOT IN ('Завершен', 'Завершён', 'Отменен', 'Отменён', 'Выполнен')
        """), {"st": rule.status, "cutoff": cutoff})).mappings().all()
        for r in rows:
            violations.append({
                "order_id": r["id"],
                "product_name": r["product_name"],
                "status": r["status"],
                "updated_at": str(r["updated_at"]),
                "hours_overdue": int((datetime.utcnow() - r["updated_at"]).total_seconds() / 3600) - rule.max_hours,
                "sla_max_hours": rule.max_hours,
            })
    return violations
