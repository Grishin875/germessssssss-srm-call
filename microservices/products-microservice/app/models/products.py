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
    norm = Column(Numeric(15, 4), nullable=False)
    production_type = Column(String(100))
    source = Column(String(50), default="warehouse")   # NEW: откуда берётся
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
    production_type = Column(String(100), nullable=False, default="SMD")
    assigned_role = Column(String(50))  # кто делает: operator_smd | montažnik | operator_3d | operator_engraving
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class RecipeAttachment(Base):
    __tablename__ = "recipe_attachments"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500))
    attachment_type = Column(String(50))
    file_path = Column(String(500))
    original_name = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())


class FinishedGoods(Base):
    __tablename__ = "finished_goods"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500), unique=True, nullable=False)
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
    """Производственный этап изделия — задаётся вручную в рецептуре."""
    __tablename__ = "recipe_stages"

    id          = Column(Integer, primary_key=True)
    product_name = Column(String(500), nullable=False)
    stage_name  = Column(String(200), nullable=False)
    stage_type  = Column(String(50), default="assembly")  # assembly | smd | engraving | 3d_print | case | warehouse
    sort_order  = Column(Integer, default=0)
    description = Column(Text)                           # краткое описание
    instructions = Column(Text)                          # подробная инструкция как выполнять
    required_role = Column(String(50))                   # нужная роль
    depends_on_previous = Column(Integer, default=1)     # 1=ждать предыдущий, 0=параллельно
    transfer_qty = Column(Integer, default=0)            # 1=фиксировать передачу кол-ва следующему этапу
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())
