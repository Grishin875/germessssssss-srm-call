from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime


class RecipeCreate(BaseModel):
    component_name: str
    product_name: str
    norm: float
    production_type: str
    source: str = "warehouse"             # warehouse | smd | engraving | 3d_print | purchase
    stage_id: Optional[int] = None        # явная привязка к этапу рецептуры (recipe_stages.id)
    warehouse_component_name: Optional[str] = None
    designator: Optional[str] = None
    board_side: Optional[str] = None   # TOP | BOTTOM | None
    component_size: Optional[str] = None


class RecipeUpdate(RecipeCreate):
    pass


class RecipeOut(BaseModel):
    id: int
    component_name: str
    product_name: str
    norm: float
    production_type: str
    source: str = "warehouse"
    warehouse_component_name: Optional[str]
    designator: Optional[str]
    board_side: Optional[str]
    component_size: Optional[str]
    stock_on_warehouse: float = 0

    class Config:
        from_attributes = True


class DemandPlanItem(BaseModel):
    product: str
    qty: int


class CalculateDemandRequest(BaseModel):
    plan: List[DemandPlanItem]


class ProductOrderItem(BaseModel):
    product_name: str
    production_type: str = "SMD"
    sort_order: int = 0
    assigned_role: Optional[str] = None  # кто делает: operator_smd | montažnik | operator_3d | operator_engraving


# ── RecipeCase ────────────────────────────────────────────────────────────────

class RecipeCaseCreate(BaseModel):
    product_name: str
    case_name: str
    source: str = "warehouse"          # warehouse | 3d_print | purchase
    qty: int = 1
    comment: Optional[str] = None


class RecipeCaseUpdate(BaseModel):
    source: str = "warehouse"
    qty: int = 1
    comment: Optional[str] = None


class RecipeCaseOut(BaseModel):
    id: int
    product_name: str
    case_name: str
    source: str
    qty: int
    comment: Optional[str]

    class Config:
        from_attributes = True


# ── RecipeStage ────────────────────────────────────────────────────────────────

class RecipeStageCreate(BaseModel):
    product_name: str
    stage_name: str
    stage_type: str = "assembly"
    sort_order: int = 0
    description: Optional[str] = None
    instructions: Optional[str] = None
    required_role: Optional[str] = None
    depends_on_previous: int = 1
    transfer_qty: int = 0
    output_name: Optional[str] = None    # что выходит из этапа (полуфабрикат/результат)
    # ФАЗА 2 (новая модель):
    is_final: bool = False               # этап выпускает готовое изделие
    require_transfer: bool = False       # требовать ввод переданного кол-ва при завершении
    rework_target_stage_id: Optional[int] = None  # куда возвращать брак с этого гейта


class RecipeStageUpdate(BaseModel):
    stage_name: Optional[str] = None
    stage_type: Optional[str] = None
    sort_order: Optional[int] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    required_role: Optional[str] = None
    depends_on_previous: Optional[int] = None
    transfer_qty: Optional[int] = None
    output_name: Optional[str] = None    # "" очищает результат этапа
    is_final: Optional[bool] = None
    require_transfer: Optional[bool] = None
    rework_target_stage_id: Optional[int] = None


class RecipeStageOut(BaseModel):
    id: int
    product_name: str
    stage_name: str
    stage_type: str
    sort_order: int
    description: Optional[str]

    class Config:
        from_attributes = True
