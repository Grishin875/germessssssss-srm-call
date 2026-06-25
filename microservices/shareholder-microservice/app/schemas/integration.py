from typing import Optional, List
from pydantic import BaseModel, Field


# ── 1С schemas ────────────────────────────────────────────────────────────────

class OneCOrderItem(BaseModel):
    nomenclature_code: str   # код номенклатуры в 1С
    nomenclature_name: str   # наименование
    quantity: int = Field(gt=0)        # позиция заказа из 1С строго > 0
    unit: Optional[str] = "шт"


class OneCOrderWebhook(BaseModel):
    """Входящий заказ из 1С"""
    external_id: str          # ID заказа в 1С
    order_number: Optional[str] = None
    client_name: Optional[str] = None
    items: List[OneCOrderItem]
    deadline: Optional[str] = None
    comment: Optional[str] = None


class OneCNomenclatureItem(BaseModel):
    """Номенклатура из 1С для синхронизации склада"""
    code: str
    name: str
    unit: Optional[str] = "шт"
    quantity: Optional[float] = Field(0, ge=0)   # остаток-снимок не может быть < 0


class OneCStockWebhook(BaseModel):
    """Остатки склада из 1С"""
    items: List[OneCNomenclatureItem]


# ── Bitrix24 schemas ──────────────────────────────────────────────────────────

class BitrixDealWebhook(BaseModel):
    """Входящая сделка из Битрикс24"""
    deal_id: str
    title: str
    product_name: Optional[str] = None
    quantity: Optional[int] = Field(1, gt=0)     # кол-во в сделке Битрикс строго > 0
    deadline: Optional[str] = None
    responsible_name: Optional[str] = None
    comment: Optional[str] = None
    stage: Optional[str] = None


# ── Export schemas ────────────────────────────────────────────────────────────

class ExportShipmentsRequest(BaseModel):
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class NomenclatureMapping(BaseModel):
    """Маппинг номенклатуры 1С ↔ product_name CRM"""
    onec_code: str
    onec_name: str
    crm_product_name: str
