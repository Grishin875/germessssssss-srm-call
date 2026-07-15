from sqlalchemy import Column, Integer, String, Text, DateTime, Numeric, UniqueConstraint, Boolean
from sqlalchemy.sql import func
from shared.core.database import Base


class ProductCatalog(Base):
    """Справочник изделий — единый источник имён продуктов."""
    __tablename__ = "product_catalog"

    id          = Column(Integer, primary_key=True)
    name        = Column(String(500), nullable=False, unique=True)  # совпадает с product_name везде
    sku         = Column(String(100))           # артикул
    category    = Column(String(200))           # категория
    description = Column(Text)                  # описание
    unit        = Column(String(50), default="шт")  # единица измерения
    is_active   = Column(Boolean, default=True)
    # Признаки канонического маршрута по ТЗ (определяют ветвление этапов заказа):
    needs_smd      = Column(Boolean, default=True)   # нужен блок СМД (склад СМД→монтаж→AOI→гравировка)
    is_receiver    = Column(Boolean, default=False)  # приёмник: после СМД — прошивка, без сборки РЭА
    needs_assembly = Column(Boolean, default=True)   # нужна сборка РЭА (склад РЭА→выдача→сборка→ОТК)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())

# production_type values — определяет отдел/процесс:
#   SMD | Сборка | Гравировка | 3D Печать | Корпус | Склад
# source values — откуда берётся компонент физически:
#   warehouse | smd | engraving | 3d_print | purchase | case

class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True)
    component_name = Column(String(500), nullable=False)
    product_name = Column(String(500), nullable=False)
    product_id = Column(Integer)                        # ФАЗА 1: стабильная ссылка на product_catalog.id (backfill по имени); связь по id, а не по тексту
    norm = Column(Numeric(15, 4), nullable=False)
    production_type = Column(String(100))              # DEPRECATED (Фаза 3): тип наследуется от этапа; пока оставлен для совместимости
    source = Column(String(50), default="warehouse")   # NEW: откуда берётся
    stage_id = Column(Integer)                         # явная привязка компонента к этапу рецептуры (recipe_stages.id); NULL = авто по source
    warehouse_component_name = Column(String(500))
    designator = Column(String(100))
    board_side = Column(String(10))
    component_size = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RecipeCase(Base):
    """Корпус изделия в рецептуре."""
    __tablename__ = "recipe_cases"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500), nullable=False)
    product_id = Column(Integer)                        # ФАЗА 1: ссылка на product_catalog.id (backfill по имени)
    case_name = Column(String(255), nullable=False)    # название корпуса
    source = Column(String(50), default="warehouse")   # warehouse | 3d_print | purchase
    qty = Column(Integer, default=1)
    comment = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("product_name", "case_name", name="uq_recipe_case"),
    )


class RecipeProductOrder(Base):
    __tablename__ = "recipe_product_order"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(255), unique=True, nullable=False)
    product_id = Column(Integer)                        # ФАЗА 1: ссылка на product_catalog.id (backfill по имени)
    production_type = Column(String(100), nullable=False, default="SMD")  # DEPRECATED (Фаза 3): роль/тип живёт в этапе
    assigned_role = Column(String(50))  # DEPRECATED (Фаза 3): кто делает — теперь берём из операции этапа
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RecipeAttachment(Base):
    __tablename__ = "recipe_attachments"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500))
    product_id = Column(Integer)                        # ФАЗА 1: ссылка на product_catalog.id (backfill по имени)
    attachment_type = Column(String(50))
    file_path = Column(String(500))
    original_name = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())


class FinishedGoods(Base):
    __tablename__ = "finished_goods"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500), unique=True, nullable=False)
    product_id = Column(Integer)                        # ФАЗА 1: ссылка на product_catalog.id (backfill по имени)
    good_qty = Column(Integer, default=0)
    defect_qty = Column(Integer, default=0)
    total_qty = Column(Integer, default=0)
    reserved = Column(Integer, default=0)   # зарезервировано под заказы-потребители (под-изделия)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Planning(Base):
    __tablename__ = "planning"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RecipeStage(Base):
    """Производственный этап изделия — задаётся вручную в рецептуре.
    ФАЗА 1 (новая модель): этап — единственный носитель правды о маршруте. operation_type_id
    ссылается на справочник операций (роль/берёт компоненты/гейт/приходует ГП/нужна партия)."""
    __tablename__ = "recipe_stages"

    id          = Column(Integer, primary_key=True)
    product_name = Column(String(500), nullable=False)
    product_id  = Column(Integer)                         # ФАЗА 1: ссылка на product_catalog.id (backfill по имени)
    stage_name  = Column(String(200), nullable=False)
    stage_type  = Column(String(50), default="assembly")  # DEPRECATED: код операции; правда теперь в operation_type_id
    operation_type_id = Column(Integer)                  # ФАЗА 1: ссылка на operation_types.id (backfill по stage_type)
    sort_order  = Column(Integer, default=0)
    description = Column(Text)                           # краткое описание
    instructions = Column(Text)                          # подробная инструкция как выполнять
    required_role = Column(String(50))                   # нужная роль (перекрывает default_role операции, если задана)
    depends_on_previous = Column(Integer, default=1)     # 1=ждать предыдущий, 0=параллельно
    transfer_qty = Column(Integer, default=0)            # DEPRECATED: заменяется require_transfer
    require_transfer = Column(Boolean, default=False)    # ФАЗА 1: требовать ввод переданного кол-ва при завершении этапа
    output_name = Column(String(500))                    # что выходит из этапа (полуфабрикат/результат); вход следующего этапа
    is_final    = Column(Boolean, default=False)         # ФАЗА 1: этап выпускает готовое изделие (единственный финал, не по max sort_order)
    rework_target_stage_id = Column(Integer)             # ФАЗА 1: куда возвращать брак с этого гейта (recipe_stages.id); NULL = по справочнику/фолбэку
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RecipeStageEdge(Base):
    """ФАЗА 1: явное ребро графа маршрута между этапами рецептуры.
    Позволяет задать параллельные ветки, развилки и слияния (граф «50/50»), не полагаясь
    только на sort_order. edge_type: 'normal' — обычный переход; 'rework' — возврат брака.
    Пусто = линейный маршрут по sort_order (обратная совместимость)."""
    __tablename__ = "recipe_stage_edges"

    id            = Column(Integer, primary_key=True)
    product_id    = Column(Integer)
    from_stage_id = Column(Integer, nullable=False)      # recipe_stages.id
    to_stage_id   = Column(Integer, nullable=False)      # recipe_stages.id
    edge_type     = Column(String(20), default="normal") # normal | rework
    created_at    = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("from_stage_id", "to_stage_id", "edge_type", name="uq_recipe_stage_edge"),
    )


class OperationType(Base):
    """ФАЗА 1: единый справочник производственных операций/этапов — источник правды о том,
    что за операция: отдел/роль, берёт ли компоненты, контроль ли (гейт), куда возвращать
    брак, приходует ли готовую продукцию, нужна ли отдельная партия, сервисный ли это этап
    (ОТК/склад/отгрузка — авто-хвост). Заменяет захардкоженные словари в коде
    (_STAGE_TO_PRODUCTION_TYPE / _NON_CONSUMING_STAGES / QC_GATES / _DEFAULT_ROLE)."""
    __tablename__ = "operation_types"

    id            = Column(Integer, primary_key=True)
    code          = Column(String(50), nullable=False, unique=True)  # smd | assembly | otk | warehouse_fg | ...
    display_name  = Column(String(200), nullable=False)
    production_type = Column(String(100))                # прежний ярлык партии (SMD/Сборка/...); NULL для сервисных
    default_role  = Column(String(50))                   # роль исполнителя по умолчанию
    consumes_components     = Column(Boolean, default=True)   # берёт ли компоненты со склада
    is_qc_gate    = Column(Boolean, default=False)       # контроль качества (pass/fail, нельзя закрыть обычным «Готово»)
    rework_to_code = Column(String(50))                  # куда возвращать брак (code операции) — для гейтов
    produces_finished_goods = Column(Boolean, default=False) # приходует ГП при завершении
    needs_batch   = Column(Boolean, default=False)       # создавать производственную партию
    is_service    = Column(Boolean, default=False)       # сервисный этап хвоста (склад/ОТК/распределение/отгрузка)
    sort_hint     = Column(Integer, default=0)           # типовой порядок в маршруте
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime, server_default=func.now())
    updated_at    = Column(DateTime, server_default=func.now(), onupdate=func.now())
