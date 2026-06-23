from typing import Optional, List
from decimal import Decimal
from pydantic import BaseModel
from datetime import datetime


# ── Component ─────────────────────────────────────────────────────────────────

class ComponentCreate(BaseModel):
    name: str
    stock: float = 0
    category: str = "Разное"
    unit: Optional[str] = None
    min_stock: Optional[float] = None
    comment: Optional[str] = None
    units_per_reel: Optional[float] = None
    block: str = "СМД"
    source: str = "warehouse"          # warehouse | smd | engraving | 3d_print | purchase
    package_type: Optional[str] = None
    size: Optional[str] = None
    capacitance: Optional[str] = None
    voltage: Optional[str] = None
    tolerance: Optional[str] = None


class ComponentUpdate(ComponentCreate):
    pass


class ComponentOut(BaseModel):
    id: int
    name: str
    stock: float
    category: str
    unit: Optional[str]
    min_stock: Optional[float]
    comment: Optional[str]
    units_per_reel: Optional[float]
    block: str
    source: str = "warehouse"
    package_type: Optional[str]
    size: Optional[str]
    capacitance: Optional[str]
    voltage: Optional[str]
    tolerance: Optional[str]
    reserved_qty: float = 0
    available: float

    class Config:
        from_attributes = True


# ── Batch ─────────────────────────────────────────────────────────────────────

class BatchItem(BaseModel):
    name: str
    qty: float
    isNew: bool = False
    category: Optional[str] = None


class BatchOperationRequest(BaseModel):
    operationType: str          # incoming | writeoff
    items: List[BatchItem]
    operationId: Optional[str] = None
    toProduction: bool = False
    writeoffReason: Optional[str] = None
    writeoffComment: Optional[str] = None
    employeeId: Optional[str] = None


# ── Reserve ───────────────────────────────────────────────────────────────────

class ReserveItem(BaseModel):
    component_name: str
    quantity: float


class ReserveForOrderRequest(BaseModel):
    order_id: int
    product_name: str
    items: List[ReserveItem]          # список компонентов для списания


# ── Operations ────────────────────────────────────────────────────────────────

class OperationOut(BaseModel):
    id: int
    operation_date: Optional[datetime]
    operation_type: str
    component_name: Optional[str]
    quantity: Optional[float]
    note: Optional[str]
    operator_id: Optional[str]
    additional_info: Optional[str]
    operation_id: Optional[str]

    class Config:
        from_attributes = True


class ProductionStockOut(BaseModel):
    id: int
    component_name: str
    quantity: float
    category: str
    block: str
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


# ── Warehouses ────────────────────────────────────────────────────────────────

class WarehouseCreate(BaseModel):
    code: str
    name: str
    warehouse_type: str = "main"      # main | smd | rea | finished | defect
    address: Optional[str] = None
    is_active: bool = True


class WarehouseUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    warehouse_type: Optional[str] = None
    address: Optional[str] = None
    is_active: Optional[bool] = None


class WarehouseOut(BaseModel):
    id: int
    code: str
    name: str
    warehouse_type: str
    type_label: str = ""
    address: Optional[str] = None
    is_active: bool = True
    positions_count: int = 0          # сколько позиций лежит на складе
    total_quantity: float = 0         # суммарное кол-во

    class Config:
        from_attributes = True


class WarehouseStockOut(BaseModel):
    warehouse_id: int
    warehouse_name: str = ""
    warehouse_type: str = ""
    component_name: str
    quantity: float
    reserved: float = 0
    available: float = 0


class StockTransferRequest(BaseModel):
    component_name: str
    from_warehouse_id: int
    to_warehouse_id: int
    quantity: float
    note: Optional[str] = None


# ── Case ──────────────────────────────────────────────────────────────────────

class CaseCreate(BaseModel):
    name: str
    source: str = "warehouse"         # warehouse | 3d_print | purchase
    stock: int = 0
    min_stock: int = 0
    color: Optional[str] = None
    material: Optional[str] = None
    comment: Optional[str] = None


class CaseUpdate(CaseCreate):
    pass


class CaseOut(BaseModel):
    id: int
    name: str
    source: str
    stock: int
    min_stock: int
    color: Optional[str]
    material: Optional[str]
    comment: Optional[str]

    class Config:
        from_attributes = True


# ── Закупка (procurement) ─────────────────────────────────────────────────────

class SupplierCreate(BaseModel):
    name: str
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    note: Optional[str] = None
    is_active: bool = True


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    note: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierOut(BaseModel):
    id: int
    name: str
    contact: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    note: Optional[str] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class PurchaseItemIn(BaseModel):
    component_name: str
    quantity: float = 0
    unit_price: Optional[float] = None
    note: Optional[str] = None


class PurchaseItemOut(BaseModel):
    id: int
    component_name: str
    quantity: float
    received_qty: float = 0
    unit_price: Optional[float] = None
    note: Optional[str] = None


class PurchaseRequestCreate(BaseModel):
    supplier_id: Optional[int] = None
    note: Optional[str] = None
    order_ref: Optional[str] = None
    items: List[PurchaseItemIn] = []


class PurchaseRequestUpdate(BaseModel):
    supplier_id: Optional[int] = None
    status: Optional[str] = None       # draft | ordered | received | cancelled
    note: Optional[str] = None
    order_ref: Optional[str] = None
    items: Optional[List[PurchaseItemIn]] = None


class PurchaseRequestOut(BaseModel):
    id: int
    supplier_id: Optional[int] = None
    supplier_name: Optional[str] = None
    status: str
    status_label: str = ""
    note: Optional[str] = None
    order_ref: Optional[str] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    items: List[PurchaseItemOut] = []
    total_qty: float = 0
    total_cost: float = 0

    class Config:
        from_attributes = True


class ShortageItem(BaseModel):
    component_name: str
    quantity: float


class FromShortageRequest(BaseModel):
    items: List[ShortageItem] = []
    supplier_id: Optional[int] = None
    order_ref: Optional[str] = None
    note: Optional[str] = None


# ── Заявки на компоненты (брак / дозапрос со склада) ──────────────────────────

class ComponentRequestCreate(BaseModel):
    order_id: int
    stage_id: Optional[int] = None
    component_name: str
    qty: float
    reason: Optional[str] = "брак"
    comment: Optional[str] = None
