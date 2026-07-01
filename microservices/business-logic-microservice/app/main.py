from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints.orders import router as orders_router
from app.api.v1.endpoints.chat import router as chat_router
from shared.core.database import make_engine, make_session_factory, Base
from shared.core.security import decode_token
from app.models.business import Order, OrderItem, ProductionBatch, ProductionBatchOperator, ProductionDailyProgress, OrderStage, OrderComment, CustomFieldDefinition, CustomFieldValue, StageAssignee, ChatChannel, ChatChannelMember, ChatMessage  # noqa

engine = make_engine(settings.DATABASE_URL)
session_factory = make_session_factory(engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    from sqlalchemy import text
    # 1) Свои таблицы — отдельной транзакцией (коммитятся независимо от миграций ниже).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # 2) Идемпотентные миграции — КАЖДАЯ своей транзакцией и терпима к ошибке. На чистой
    #    БД таблица другого сервиса может ещё не существовать (её создаёт владелец); раньше
    #    общий `engine.begin()` откатывал и create_all → дедлок между business-logic и otk.
    _MIGRATIONS = [
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_department VARCHAR(100)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_comment TEXT",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS required_role VARCHAR(50)",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS depends_on_previous INTEGER DEFAULT 1",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS transfer_qty INTEGER DEFAULT 0",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS transferred_qty INTEGER",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS instructions TEXT",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS next_stage_id INTEGER",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS on_fail_stage_id INTEGER",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS submit_photo_url VARCHAR(500)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_rejection_photo VARCHAR(500)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_attempts INTEGER DEFAULT 0",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS skipped_stage_ids TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id INTEGER",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS est_minutes INTEGER",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS checklist TEXT DEFAULT '[]'",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS result_photo VARCHAR(500)",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS pause_reason TEXT",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags TEXT",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS rework_target_type VARCHAR(50)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS managers TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS positions TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_date VARCHAR(50)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_date VARCHAR(50)",
        "ALTER TABLE warehouse_components ADD COLUMN IF NOT EXISTS reserved NUMERIC(15,3) DEFAULT 0",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS order_item_id INTEGER",
        "ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS order_item_id INTEGER",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS order_item_id INTEGER",
        "CREATE INDEX IF NOT EXISTS ix_order_stages_item ON order_stages(order_item_id)",
        "CREATE INDEX IF NOT EXISTS ix_production_batches_item ON production_batches(order_item_id)",
        "CREATE INDEX IF NOT EXISTS ix_otk_batches_item ON otk_batches(order_item_id)",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(50)",
        "ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP",
    ]
    for _stmt in _MIGRATIONS:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(_stmt))
        except Exception as e:
            logging.getLogger("migrations").warning("skip migration [%s]: %s", type(e).__name__, _stmt[:70])
    yield
    await engine.dispose()


app = FastAPI(title="Business Logic Service", lifespan=lifespan)

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
                    text("SELECT id, username, role, is_active, departments_access, user_permissions FROM users WHERE id = :id"),
                    {"id": payload.get("id")}
                )).mappings().one_or_none()
                if row and row["is_active"]:
                    class _U:
                        pass
                    u = _U()
                    for k in ("id", "username", "role", "is_active", "departments_access", "user_permissions"):
                        setattr(u, k, row[k])
                    u.departments_access = u.departments_access or []
                    u.user_permissions = u.user_permissions or {}
                    request.state.current_user = u
        try:
            response = await call_next(request)
            await session.commit()
        except Exception:
            await session.rollback()
            raise
    return response


app.include_router(orders_router, prefix="/api", tags=["orders", "production"])
app.include_router(chat_router, prefix="/api", tags=["chat"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "business-logic"}
