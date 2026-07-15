from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints.products import router as products_router
from shared.core.database import make_engine, make_session_factory, Base
from shared.core.security import decode_token
from app.models.products import (  # noqa
    Recipe, RecipeProductOrder, RecipeAttachment, FinishedGoods, Planning,
    RecipeCase, RecipeStage, ProductCatalog, OperationType, RecipeStageEdge,
)

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
        # Вход/выход этапа: компонент привязывается к этапу, этап объявляет результат (полуфабрикат)
        await conn.execute(text("ALTER TABLE recipes ADD COLUMN IF NOT EXISTS stage_id INTEGER"))
        await conn.execute(text("ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS output_name VARCHAR(500)"))
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
        # ── ФАЗА 1: фундамент новой модели рецептуры (всё добавочно, поведение не меняется) ──
        # Новые колонки-ссылки и поля этапа.
        for _stmt in [
            "ALTER TABLE recipes ADD COLUMN IF NOT EXISTS product_id INTEGER",
            "ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS product_id INTEGER",
            "ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS operation_type_id INTEGER",
            "ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS require_transfer BOOLEAN DEFAULT false",
            "ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS is_final BOOLEAN DEFAULT false",
            "ALTER TABLE recipe_stages ADD COLUMN IF NOT EXISTS rework_target_stage_id INTEGER",
            "ALTER TABLE recipe_cases ADD COLUMN IF NOT EXISTS product_id INTEGER",
            "ALTER TABLE recipe_product_order ADD COLUMN IF NOT EXISTS product_id INTEGER",
            "ALTER TABLE recipe_attachments ADD COLUMN IF NOT EXISTS product_id INTEGER",
            "ALTER TABLE finished_goods ADD COLUMN IF NOT EXISTS product_id INTEGER",
        ]:
            await conn.execute(text(_stmt))

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

    # ── ФАЗА 1: seed справочника операций + backfill product_id/operation_type_id ──
    # Отдельной транзакцией, терпимо к ошибке: это подготовка новой модели, она не должна
    # мешать старту сервиса. Ничего не переписывает (ON CONFLICT DO NOTHING / только IS NULL).
    try:
        async with engine.begin() as conn3:
            from sqlalchemy import text as _t
            # Единый справочник операций. Свойства взяты из прежних захардкоженных словарей
            # (_STAGE_TO_PRODUCTION_TYPE / _NON_CONSUMING_STAGES / QC_GATES / _DEFAULT_ROLE).
            # ВАЖНО: это ЦЕЛЕВАЯ (исправленная) модель, а не дословный снимок текущего поведения.
            # Часть значений сознательно отличается от сегодняшнего кода (напр. marking/repair
            # НЕ потребляют компоненты, у ряда операций задана роль по умолчанию) — на Фазе 3,
            # когда эти колонки начнут читаться, это станет намеренным исправлением, не регрессией.
            # Колонки: code, display_name, production_type, default_role, consumes_components,
            #          is_qc_gate, rework_to_code, produces_finished_goods, needs_batch, is_service, sort_hint
            await conn3.execute(_t("""
                INSERT INTO operation_types
                  (code, display_name, production_type, default_role, consumes_components,
                   is_qc_gate, rework_to_code, produces_finished_goods, needs_batch, is_service, sort_hint)
                VALUES
                  ('distribution','Распределение заказа',NULL,NULL,false,false,NULL,false,false,true,10),
                  ('warehouse_smd','Склад СМД',NULL,'warehouse',false,false,NULL,false,false,true,20),
                  ('smd','СМД-монтаж','SMD','operator_smd',true,false,NULL,false,true,false,30),
                  ('aoi','AOI — контроль',NULL,'operator_otk',false,true,'smd',false,false,true,40),
                  ('3d_print','3D Печать','3D Печать','operator_3d',true,false,NULL,false,true,false,45),
                  ('case','Корпус','Корпус','operator_3d',true,false,NULL,false,true,false,48),
                  ('engraving','Гравировка','Гравировка','operator_engraving',true,false,NULL,false,true,false,50),
                  ('marking','Маркировка',NULL,'operator_engraving',false,false,NULL,false,false,false,55),
                  ('firmware','Прошивка',NULL,NULL,false,false,NULL,false,false,true,60),
                  ('programmer','Программатор',NULL,NULL,false,false,NULL,false,false,true,65),
                  ('warehouse_rea','Склад РЭА',NULL,'warehouse',false,false,NULL,false,false,true,70),
                  ('issue_rea','Выдача со склада РЭА',NULL,'warehouse',false,false,NULL,false,false,true,80),
                  ('assembly','Сборка РЭА','Сборка','montažnik',true,false,NULL,false,false,false,90),
                  ('assembly_rea','Монтаж РЭА','Сборка','montažnik',true,false,NULL,false,false,false,92),
                  ('otk','Проверка ОТК',NULL,'operator_otk',false,true,'assembly',false,false,true,100),
                  ('repair','Ремонт РЭА',NULL,'montažnik',false,false,NULL,false,false,false,105),
                  ('batch_check','Проверка партии',NULL,'operator_otk',false,false,NULL,false,false,true,108),
                  ('warehouse_fg','Склад готовой продукции',NULL,'warehouse',false,false,NULL,true,false,true,110),
                  ('order_assembly','Сборка всего заказа',NULL,'operator_shipment',false,false,NULL,false,false,true,120),
                  ('shipment','Отгрузка',NULL,'operator_shipment',false,false,NULL,false,false,true,130),
                  ('warehouse','Склад (устар.)',NULL,'warehouse',false,false,NULL,false,false,true,200)
                ON CONFLICT (code) DO NOTHING
            """))
            # Доводим каталог до полноты: имена изделий из рецептур, которых ещё нет в каталоге.
            # DISTINCT ON (lower(trim)) — чтобы регистро-варианты одного имени внутри источника
            # не создали почти-дубль; NOT EXISTS видит и строки, вставленные предыдущими
            # источниками в этой же транзакции (кросс-источниковые варианты тоже не задвоятся).
            for _src in ("recipes", "recipe_stages", "recipe_cases",
                         "finished_goods", "recipe_attachments"):
                await conn3.execute(_t(
                    "INSERT INTO product_catalog (name) "
                    "SELECT DISTINCT ON (lower(trim(s.product_name))) s.product_name "
                    f"FROM {_src} s "
                    "WHERE s.product_name IS NOT NULL AND trim(s.product_name) <> '' "
                    "AND NOT EXISTS (SELECT 1 FROM product_catalog pc "
                    "                WHERE lower(trim(pc.name)) = lower(trim(s.product_name))) "
                    "ORDER BY lower(trim(s.product_name)), s.product_name "
                    "ON CONFLICT (name) DO NOTHING"
                ))
            # Backfill product_id по имени (только там, где ещё NULL). Берём МИНИМАЛЬНЫЙ
            # подходящий id — детерминированно даже если в каталоге остались регистро-варианты.
            for _tbl in ("recipes", "recipe_stages", "recipe_cases",
                         "recipe_product_order", "recipe_attachments", "finished_goods"):
                await conn3.execute(_t(
                    f"UPDATE {_tbl} t SET product_id = ("
                    "  SELECT min(pc.id) FROM product_catalog pc "
                    "  WHERE lower(trim(pc.name)) = lower(trim(t.product_name))) "
                    "WHERE t.product_id IS NULL "
                    "AND EXISTS (SELECT 1 FROM product_catalog pc "
                    "            WHERE lower(trim(pc.name)) = lower(trim(t.product_name)))"
                ))
            # Backfill operation_type_id по коду stage_type.
            await conn3.execute(_t(
                "UPDATE recipe_stages rs SET operation_type_id = ot.id FROM operation_types ot "
                "WHERE rs.operation_type_id IS NULL AND ot.code = rs.stage_type"
            ))
    except Exception:
        _logging.getLogger(__name__).exception("recipe phase-1 seed/backfill migration skipped")

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
                    from shared.core.permissions import resolve_permissions
                    class _U:
                        pass
                    u = _U()
                    for k in ("id", "username", "role", "is_active", "departments_access", "user_permissions"):
                        setattr(u, k, row[k])
                    u.departments_access = u.departments_access or []
                    # Эффективные права (как в auth /me): дефолты роли + сохранённые.
                    # Иначе кнопка на фронте есть, а products отвечает 403.
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


app.include_router(products_router, prefix="/api", tags=["products"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "products"}
