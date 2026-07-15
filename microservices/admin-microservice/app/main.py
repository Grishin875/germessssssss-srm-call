from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints.operators import router as operators_router
from app.api.v1.endpoints.tasks import router as tasks_router
from app.api.v1.endpoints.shifts import router as shifts_router
from app.api.v1.endpoints.admin import router as admin_router
from app.api.v1.endpoints.settings import router as settings_router
from shared.core.database import make_engine, make_session_factory, Base
from shared.core.security import decode_token
from app.models.admin import (  # noqa
    Operator, ProductionTask, ShiftSchedule, Suggestion, ShiftChecklist,
    StageType, SystemRole, OrderStatus, StatusTransition, Priority, Notification, AuditLog, SlaRule,
)

engine = make_engine(settings.DATABASE_URL)
session_factory = make_session_factory(engine)


_DEFAULT_STAGE_TYPES = [
    ("smd",       "СМД",        "#8b5cf6", 0),
    ("assembly",  "Сборка",     "#0ea5e9", 1),
    ("3d_print",  "3D Печать",  "#10b981", 2),
    ("engraving", "Гравировка", "#f59e0b", 3),
    ("case",      "Корпус",     "#f97316", 4),
    ("warehouse", "Склад",      "#6b7280", 5),
    # Канонический маршрут по ТЗ
    ("distribution",   "Распределение заказа",     "#64748b", 6),
    ("warehouse_smd",  "Склад СМД",                "#6b7280", 7),
    ("aoi",            "AOI — контроль",           "#ec4899", 8),
    ("firmware",       "Прошивка",                 "#14b8a6", 9),
    ("warehouse_rea",  "Склад РЭА",                "#6b7280", 10),
    ("issue_rea",      "Выдача со склада РЭА",      "#6b7280", 11),
    ("otk",            "ОТК",                      "#22c55e", 12),
    ("warehouse_fg",   "Склад готовой продукции",  "#6b7280", 13),
    ("order_assembly", "Сборка всего заказа",      "#0ea5e9", 14),
    ("shipment",       "Отгрузка",                 "#3b82f6", 15),
]

_DEFAULT_ROLES = [
    ("operator_smd",       "Оператор СМД",     ["smd"],       True),
    ("montažnik",          "Монтажник",         ["assembly"],  True),
    ("operator_3d",        "Оператор 3D",       ["3d_print"],  True),
    ("operator_engraving", "Гравёр",            ["engraving"], True),
    ("operator_otk",       "Оператор ОТК",      [],            False),
    ("operator_shipment",  "Оператор отгрузки", [],            False),
    ("warehouse",          "Кладовщик",         ["warehouse"], False),
    ("manager",            "Менеджер",          [],            False),
    ("admin",              "Администратор",     [],            False),
]

_DEFAULT_STATUSES = [
    ("Создан",                  "#6b7280", False, 0),
    ("Назначен",                "#6366f1", False, 1),
    ("В работе",                "#0ea5e9", False, 2),
    ("Доработка",               "#f59e0b", False, 3),
    ("На проверке ОТК",         "#8b5cf6", False, 4),
    ("Готов к проверке ОТК",    "#8b5cf6", False, 5),
    ("Передан на ОТК",          "#8b5cf6", False, 6),
    ("Готов к отгрузке",        "#10b981", False, 7),
    ("Завершен",                "#10b981", True,  8),
    ("Отменен",                 "#ef4444", True,  9),
]

_DEFAULT_PRIORITIES = [
    ("normal",   "Обычный",   "#6b7280", 0),
    ("high",     "Высокий",   "#f59e0b", 50),
    ("urgent",   "Срочный",   "#ef4444", 100),
    ("low",      "Низкий",    "#94a3b8", -10),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    import json as _json
    from sqlalchemy import text as _text
    from app.services.sla_monitor import sla_monitor_loop
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Seed stage types
        for code, label, color, sort_order in _DEFAULT_STAGE_TYPES:
            await conn.execute(_text(
                "INSERT INTO stage_types (code,label,color,sort_order,is_active) VALUES (:c,:l,:col,:s,true) ON CONFLICT (code) DO NOTHING"
            ), {"c": code, "l": label, "col": color, "s": sort_order})
        # Seed system roles
        for code, label, stages, is_prod in _DEFAULT_ROLES:
            await conn.execute(_text(
                "INSERT INTO system_roles (code,label,allowed_stage_types,is_production,is_active) VALUES (:c,:l,:st,:p,true) ON CONFLICT (code) DO NOTHING"
            ), {"c": code, "l": label, "st": _json.dumps(stages), "p": is_prod})
        # Seed order statuses
        for code, color, is_terminal, sort_order in _DEFAULT_STATUSES:
            await conn.execute(_text(
                "INSERT INTO order_statuses (code,label,color,is_terminal,sort_order,is_active) VALUES (:c,:c,:col,:t,:s,true) ON CONFLICT (code) DO NOTHING"
            ), {"c": code, "col": color, "t": is_terminal, "s": sort_order})
        # Seed priorities
        for code, label, color, weight in _DEFAULT_PRIORITIES:
            await conn.execute(_text(
                "INSERT INTO priorities (code,label,color,sort_weight,is_active) VALUES (:c,:l,:col,:w,true) ON CONFLICT (code) DO NOTHING"
            ), {"c": code, "l": label, "col": color, "w": weight})
    sla_task = asyncio.create_task(sla_monitor_loop(session_factory))
    yield
    sla_task.cancel()
    try:
        await sla_task
    except asyncio.CancelledError:
        pass
    await engine.dispose()


app = FastAPI(title="Admin Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://crmb3.ru", "http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


@app.middleware("http")
async def db_and_auth_middleware(request: Request, call_next) -> Response:
    async with session_factory() as session:
        request.state.db = session
        request.state.current_user = None
        auth = request.headers.get("Authorization", "")
        token = auth.replace("Bearer ", "") if auth.startswith("Bearer ") else ""
        if token:
            payload = decode_token(token, settings.JWT_SECRET)
            if payload:
                from sqlalchemy import text
                row = (await session.execute(
                    text("SELECT id, username, full_name, role, is_active, departments_access, user_permissions FROM users WHERE id=:id"),
                    {"id": payload.get("id")}
                )).mappings().one_or_none()
                if row and row["is_active"]:
                    class _U:
                        pass
                    u = _U()
                    for k in ("id", "username", "full_name", "role", "is_active", "departments_access", "user_permissions"):
                        setattr(u, k, row[k])
                    u.departments_access = u.departments_access or []
                    from shared.core.permissions import resolve_permissions
                    # Эффективные права (как в auth /me): дефолты роли + сохранённые.
                    u.user_permissions = resolve_permissions(
                        u.role, u.departments_access, u.user_permissions or {})
                    request.state.current_user = u
        try:
            response = await call_next(request)
            await session.commit()
        except Exception:
            await session.rollback()
            raise
    return response


app.include_router(operators_router, prefix="/api", tags=["operators"])
app.include_router(tasks_router, prefix="/api", tags=["tasks"])
app.include_router(shifts_router, prefix="/api", tags=["shifts"])
app.include_router(admin_router, prefix="/api", tags=["admin"])
app.include_router(settings_router, prefix="/api", tags=["settings"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "admin"}
