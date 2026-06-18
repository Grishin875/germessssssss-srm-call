from sqlalchemy import Column, Integer, String, Numeric, Text, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from shared.core.database import Base

# source values: warehouse | smd | engraving | 3d_print | purchase
SOURCE_VALUES = ("warehouse", "smd", "engraving", "3d_print", "purchase")
SOURCE_LABELS = {
    "warehouse": "Склад",
    "smd":       "SMD",
    "engraving": "Гравировка",
    "3d_print":  "3D-печать",
    "purchase":  "Закупка",
}


class WarehouseComponent(Base):
    __tablename__ = "warehouse_components"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    stock = Column(Numeric(15, 3), default=0)
    category = Column(String(100), default="Разное")
    unit = Column(String(50))
    min_stock = Column(Numeric(15, 3))
    comment = Column(Text)
    units_per_reel = Column(Numeric(15, 3))
    block = Column(String(50), default="СМД")
    source = Column(String(50), default="warehouse")   # NEW: откуда берётся компонент
    package_type = Column(String(100))
    size = Column(String(100))
    capacitance = Column(String(100))
    voltage = Column(String(100))
    tolerance = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ProductionStock(Base):
    __tablename__ = "production_stock"

    id = Column(Integer, primary_key=True)
    component_name = Column(String(255), unique=True, nullable=False)
    quantity = Column(Numeric(15, 3), default=0)
    category = Column(String(100), default="Разное")
    block = Column(String(50), default="СМД")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Operation(Base):
    __tablename__ = "operations"

    id = Column(Integer, primary_key=True)
    operation_date = Column(DateTime, server_default=func.now())
    operation_type = Column(String(50), nullable=False)
    component_name = Column(String(255))
    quantity = Column(Numeric(15, 3))
    note = Column(Text)
    operator_id = Column(String(50))
    additional_info = Column(Text)
    operation_id = Column(String(100), unique=True)
    created_at = Column(DateTime, server_default=func.now())


# case source values: warehouse | 3d_print | purchase
class Case(Base):
    """Корпуса для изделий — отдельный учёт."""
    __tablename__ = "cases"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    source = Column(String(50), default="warehouse")   # warehouse | 3d_print | purchase
    stock = Column(Integer, default=0)
    min_stock = Column(Integer, default=0)
    color = Column(String(50))
    material = Column(String(100))
    comment = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
