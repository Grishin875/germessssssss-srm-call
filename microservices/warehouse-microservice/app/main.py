from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints.warehouse import router as warehouse_router
from shared.core.database import make_engine, make_session_factory, Base
from shared.core.security import decode_token
from app.models.warehouse import (  # noqa
    WarehouseComponent, ProductionStock, Operation, Case, Warehouse, WarehouseStock,
    Supplier, PurchaseRequest, PurchaseRequestItem, ComponentRequest,
)

engine = make_engine(settings.DATABASE_URL)
session_factory = make_session_factory(engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Идемпотентные миграции
        from sqlalchemy import text
        await conn.execute(text(
            "ALTER TABLE warehouse_components ADD COLUMN IF NOT EXISTS reserved NUMERIC(15,3) DEFAULT 0"
        ))
    # Завести дефолтные склады + разложить текущие остатки по Основному складу
    from app.services import warehouse_service
    async with session_factory() as session:
        await warehouse_service.seed_warehouses(session)
        await warehouse_service.reconcile_stock(session)
    yield
    await engine.dispose()


app = FastAPI(title="Warehouse Service", lifespan=lifespan)

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
                from sqlalchemy import select
                from sqlalchemy.orm import DeclarativeBase
                # Lazy import to avoid circular deps — use raw query
                from sqlalchemy import text
                result = await session.execute(
                    text("SELECT id, username, role, is_active, departments_access, user_permissions FROM users WHERE id = :id"),
                    {"id": payload.get("id")}
                )
                row = result.mappings().one_or_none()
                if row and row["is_active"]:
                    from shared.core.permissions import resolve_permissions
                    class _User:
                        pass
                    u = _User()
                    u.id = row["id"]
                    u.username = row["username"]
                    u.role = row["role"]
                    u.is_active = row["is_active"]
                    u.departments_access = row["departments_access"] or []
                    # Эффективные права (как в auth /me): дефолты роли + сохранённые.
                    # Иначе кнопка на фронте есть, а warehouse отвечает 403.
                    u.user_permissions = resolve_permissions(
                        u.role, u.departments_access, row["user_permissions"] or {})
                    request.state.current_user = u
        try:
            response = await call_next(request)
            await session.commit()
        except Exception:
            await session.rollback()
            raise
    return response


app.include_router(warehouse_router, prefix="/api/warehouse", tags=["warehouse"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "warehouse"}
