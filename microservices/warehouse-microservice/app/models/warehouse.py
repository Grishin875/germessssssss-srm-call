from sqlalchemy import Column, Integer, String, Numeric, Text, DateTime, Boolean, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from shared.core.database import Base

# Типы складов (перенесено из Django-CRM apps/warehouse)
WAREHOUSE_TYPES = ("main", "smd", "rea", "finished", "defect")
WAREHOUSE_TYPE_LABELS = {
    "main":     "Основной склад",
    "smd":      "Склад СМД",
    "rea":      "Склад РЭА",
    "finished": "Склад готовой продукции",
    "defect":   "Склад брака",
}
# Дефолтный набор складов, заводится при старте сервиса
DEFAULT_WAREHOUSES = [
    {"code": "MAIN", "name": "Основной склад",            "warehouse_type": "main"},
    {"code": "SMD",  "name": "Склад СМД",                 "warehouse_type": "smd"},
    {"code": "REA",  "name": "Склад РЭА",                 "warehouse_type": "rea"},
    {"code": "FG",   "name": "Склад готовой продукции",   "warehouse_type": "finished"},
    {"code": "DEF",  "name": "Склад брака",               "warehouse_type": "defect"},
]


class Warehouse(Base):
    __tablename__ = "warehouses"

    id = Column(Integer, primary_key=True)
    code = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    warehouse_type = Column(String(20), default="main")   # main | smd | rea | finished | defect
    address = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class WarehouseStock(Base):
    """Остаток компонента на конкретном складе.

    Связь с компонентом — по имени (как и везде в germess). Инвариант:
    сумма quantity по всем складам для компонента == warehouse_components.stock.
    Поддерживается reconcile-ом (излишек/недостаток относят на Основной склад).
    """
    __tablename__ = "warehouse_stock"
    __table_args__ = (UniqueConstraint("warehouse_id", "component_name", name="uq_warehouse_component"),)

    id = Column(Integer, primary_key=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=False)
    component_name = Column(String(255), nullable=False)
    quantity = Column(Numeric(15, 3), default=0)
    reserved = Column(Numeric(15, 3), default=0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

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
    reserved = Column(Numeric(15, 3), default=0)   # зарезервировано под заказы; available = stock - reserved
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


# ── Закупка (procurement) ─────────────────────────────────────────────────────
PURCHASE_STATUSES = ("draft", "ordered", "received", "cancelled")
PURCHASE_STATUS_LABELS = {
    "draft":     "Черновик",
    "ordered":   "Заказано",
    "received":  "Получено",
    "cancelled": "Отменено",
}


class Supplier(Base):
    """Поставщик."""
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), unique=True, nullable=False)
    contact = Column(String(255))
    phone = Column(String(100))
    email = Column(String(255))
    note = Column(Text)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PurchaseRequest(Base):
    """Заявка на закупку. Статусы: draft → ordered → received (+ cancelled)."""
    __tablename__ = "purchase_requests"

    id = Column(Integer, primary_key=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id", ondelete="SET NULL"))
    status = Column(String(30), default="draft")
    note = Column(Text)
    order_ref = Column(String(100))          # связанный заказ производства (опц.)
    created_by = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PurchaseRequestItem(Base):
    """Позиция заявки на закупку."""
    __tablename__ = "purchase_request_items"

    id = Column(Integer, primary_key=True)
    request_id = Column(Integer, ForeignKey("purchase_requests.id", ondelete="CASCADE"), nullable=False)
    component_name = Column(String(255), nullable=False)
    quantity = Column(Numeric(15, 3), default=0)
    received_qty = Column(Numeric(15, 3), default=0)
    unit_price = Column(Numeric(15, 2))
    note = Column(Text)


# ── Заявки на компоненты (брак / дозапрос со склада) ──────────────────────────
COMPONENT_REQUEST_STATUSES = ("pending", "issued", "rejected")
COMPONENT_REQUEST_STATUS_LABELS = {
    "pending":  "Ожидает",
    "issued":   "Выдано",
    "rejected": "Отклонено",
}


class ComponentRequest(Base):
    """Заявка оператора на дополнительный компонент (как правило — брак).

    Создаётся оператором без склад-прав; склад выдаёт (issue) или отклоняет
    (reject). При выдаче списывается остаток warehouse_components."""
    __tablename__ = "component_requests"

    id = Column(Integer, primary_key=True)
    order_id = Column(Integer)
    stage_id = Column(Integer)
    component_name = Column(String(500), nullable=False)
    qty = Column(Numeric(15, 3))
    reason = Column(String(200), default="брак")
    status = Column(String(50), default="pending")   # pending | issued | rejected
    requested_by = Column(Integer)
    requested_by_name = Column(String(200))
    issued_by = Column(Integer)
    issued_by_name = Column(String(200))
    comment = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
