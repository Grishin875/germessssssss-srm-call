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
