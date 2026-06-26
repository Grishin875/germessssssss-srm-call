from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints.otk import router as otk_router
from app.api.v1.endpoints.sc import router as sc_router
from shared.core.database import make_engine, make_session_factory, Base
from shared.core.security import decode_token
from app.models.otk import (  # noqa
    OtkBatch, DefectRecord, ScRepair, OtkDefectType, DefectCategory,
    OtkRegulationProblem, OtkRegulationMeasurement, OtkRegulationReplacement, OtkRegulationTool,
)

engine = make_engine(settings.DATABASE_URL)
session_factory = make_session_factory(engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import logging
    from sqlalchemy import text
    # 1) Свои таблицы — отдельной транзакцией.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    # 2) Миграции по одной, терпимо к ошибке: таблица orders создаётся business-logic,
    #    на чистой БД её может ещё не быть; раньше общий transaction откатывал и create_all
    #    (otk_batches) → взаимный дедлок business-logic↔otk на пустой базе.
    _MIGRATIONS = [
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS rejection_photo_url VARCHAR(500)",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS shipped_qty INTEGER DEFAULT 0",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS ship_date TIMESTAMP",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS shipper_id VARCHAR(50)",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(200)",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS recipient VARCHAR(200)",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS source_batch_id VARCHAR(100)",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS is_firmware_done INTEGER DEFAULT 0",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS firmware_qty INTEGER DEFAULT 0",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS firmware_version VARCHAR(100)",
        "ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS order_item_id INTEGER",
        "ALTER TABLE sc_repairs ADD COLUMN IF NOT EXISTS operator_id VARCHAR(50)",
        "ALTER TABLE sc_repairs ADD COLUMN IF NOT EXISTS repaired_qty INTEGER DEFAULT 0",
        "ALTER TABLE sc_repairs ADD COLUMN IF NOT EXISTS comment TEXT",
        "ALTER TABLE sc_repairs ADD COLUMN IF NOT EXISTS items_json TEXT",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS submit_photo_url VARCHAR(500)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_rejection_photo VARCHAR(500)",
        "ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_attempts INTEGER DEFAULT 0",
    ]
    for _stmt in _MIGRATIONS:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(_stmt))
        except Exception as e:
            logging.getLogger("migrations").warning("skip migration [%s]: %s", type(e).__name__, _stmt[:70])
    yield
    await engine.dispose()


app = FastAPI(title="OTK Service", lifespan=lifespan)

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
                    text("SELECT id, username, role, is_active, departments_access, user_permissions FROM users WHERE id=:id"),
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


app.include_router(otk_router, prefix="/api", tags=["otk"])
app.include_router(sc_router, prefix="/api", tags=["sc"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "otk"}
