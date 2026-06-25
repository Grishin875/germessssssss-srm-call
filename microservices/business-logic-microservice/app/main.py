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
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Миграции: добавляем колонки если они отсутствуют
        from sqlalchemy import text
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS assigned_department VARCHAR(100)"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_comment TEXT"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS required_role VARCHAR(50)"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS depends_on_previous INTEGER DEFAULT 1"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS transfer_qty INTEGER DEFAULT 0"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS transferred_qty INTEGER"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS instructions TEXT"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS next_stage_id INTEGER"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS on_fail_stage_id INTEGER"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS submit_photo_url VARCHAR(500)"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_rejection_photo VARCHAR(500)"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS otk_attempts INTEGER DEFAULT 0"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS skipped_stage_ids TEXT"))
        # Раздел B — расширения этапов
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS est_minutes INTEGER"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS checklist TEXT DEFAULT '[]'"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS result_photo VARCHAR(500)"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS pause_reason TEXT"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags TEXT"))
        # Канонический маршрут (ТЗ) — тип этапа возврата брака для гейтов AOI/ОТК
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS rework_target_type VARCHAR(50)"))
        # Руководители проекта (несколько) — только они закрывают заказ и печатают наряд
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS managers TEXT"))
        # Комплектация заказа (несколько позиций для Excel) + даты получения/отправки
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS positions TEXT"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS received_date VARCHAR(50)"))
        await conn.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipment_date VARCHAR(50)"))
        # Резерв компонентов: «reserved» на складе (владелец — warehouse-сервис; дублируем
        # здесь идемпотентно, т.к. business-logic пишет в reserved при создании заказа).
        await conn.execute(text("ALTER TABLE warehouse_components ADD COLUMN IF NOT EXISTS reserved NUMERIC(15,3) DEFAULT 0"))
        # Мультипозиционные заказы: позиция = order_item; этапы/партии/ОТК ссылаются на позицию.
        # order_id сохраняется для обратной совместимости и существующих запросов.
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS order_item_id INTEGER"))
        await conn.execute(text("ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS order_item_id INTEGER"))
        await conn.execute(text("ALTER TABLE otk_batches ADD COLUMN IF NOT EXISTS order_item_id INTEGER"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_order_stages_item ON order_stages(order_item_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_production_batches_item ON production_batches(order_item_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_otk_batches_item ON otk_batches(order_item_id)"))
        # «Принять задачу»: закрепление этапа лично за исполнителем
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS accepted_by VARCHAR(50)"))
        await conn.execute(text("ALTER TABLE order_stages ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP"))
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
