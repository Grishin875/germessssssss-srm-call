from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints.products import router as products_router
from shared.core.database import make_engine, make_session_factory, Base
from shared.core.security import decode_token
from app.models.products import Recipe, RecipeProductOrder, RecipeAttachment, FinishedGoods, Planning, RecipeCase, RecipeStage, ProductCatalog  # noqa

engine = make_engine(settings.DATABASE_URL)
session_factory = make_session_factory(engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Миграции: добавляем колонку если она отсутствует
        from sqlalchemy import text
        await conn.execute(text("ALTER TABLE recipes ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'warehouse'"))
        await conn.execute(text("ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS required_role VARCHAR(50)"))
        await conn.execute(text("ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS instructions TEXT"))
        await conn.execute(text("ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS depends_on_previous INTEGER DEFAULT 1"))
        await conn.execute(text("ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS transfer_qty INTEGER DEFAULT 0"))
        await conn.execute(text("ALTER TABLE recipe_product_order ADD COLUMN IF NOT EXISTS assigned_role VARCHAR(50)"))
        # Признаки канонического маршрута по ТЗ на изделии
        await conn.execute(text("ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS needs_smd BOOLEAN DEFAULT true"))
        await conn.execute(text("ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS is_receiver BOOLEAN DEFAULT false"))
        await conn.execute(text("ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS needs_assembly BOOLEAN DEFAULT true"))
        # Резерв готовой продукции под заказы-потребители (под-изделия / вложенный BOM)
        await conn.execute(text("ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS reserved INTEGER DEFAULT 0"))
        # Авто-импорт существующих изделий в каталог из recipe_product_order
        await conn.execute(text("""
            INSERT INTO product_catalog (name)
            SELECT DISTINCT product_name FROM recipe_product_order
            WHERE product_name IS NOT NULL AND product_name != ''
            ON CONFLICT (name) DO NOTHING
        """))

    # Дедуп рецептов + уникальный функциональный индекс (страховка от задвоения BOM).
    # В отдельной транзакции с подавлением ошибок: грязные данные не должны валить старт.
    import logging as _logging
    try:
        async with engine.begin() as conn2:
            from sqlalchemy import text as _text
            await conn2.execute(_text("""
                DELETE FROM recipes r USING recipes r2
                WHERE r.id < r2.id
                  AND lower(trim(r.component_name)) = lower(trim(r2.component_name))
                  AND lower(trim(r.product_name))   = lower(trim(r2.product_name))
                  AND coalesce(r.production_type,'') = coalesce(r2.production_type,'')
            """))
            await conn2.execute(_text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_recipe_lower
                ON recipes (lower(trim(component_name)), lower(trim(product_name)),
                            coalesce(production_type,''))
            """))
    except Exception:
        _logging.getLogger(__name__).exception("recipe dedup/index migration skipped")
    yield
    await engine.dispose()


app = FastAPI(title="Products Service", lifespan=lifespan)

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


app.include_router(products_router, prefix="/api", tags=["products"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "products"}
