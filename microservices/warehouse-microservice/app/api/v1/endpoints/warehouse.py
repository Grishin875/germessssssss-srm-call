from fastapi import APIRouter, Depends, HTTPException, Request
from typing import List, Optional

from app.schemas.warehouse import (
    ComponentCreate, ComponentUpdate, ComponentOut,
    BatchOperationRequest, OperationOut, ProductionStockOut,
    CaseCreate, CaseUpdate, CaseOut, ReserveForOrderRequest,
)
from app.services import warehouse_service

router = APIRouter()


def _db(request: Request):
    return request.state.db


def _user(request: Request):
    user = request.state.current_user
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return user


def _require_perm(request: Request, perm: str):
    user = _user(request)
    if user.role == "admin":
        return user
    perms = user.user_permissions or {}
    if not perms.get(perm):
        raise HTTPException(status_code=403, detail=f"Недостаточно прав: {perm}")
    return user


# ── Components ───────────────────────────────────────────────────────────────

@router.get("/components", response_model=List[ComponentOut])
async def list_components(request: Request):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_components(_db(request))


@router.get("/components/by-name/{name}", response_model=ComponentOut)
async def get_component_by_name(name: str, request: Request):
    _require_perm(request, "warehouse.view")
    comp = await warehouse_service.get_component_by_name(_db(request), name)
    if not comp:
        raise HTTPException(status_code=404, detail="Компонент не найден")
    return comp


@router.post("/components", response_model=ComponentOut)
async def create_component(body: ComponentCreate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.create_component(_db(request), body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/components/{comp_id}", response_model=ComponentOut)
async def update_component(comp_id: int, body: ComponentUpdate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.update_component(_db(request), comp_id, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/components/{comp_id}")
async def delete_component(comp_id: int, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        await warehouse_service.delete_component(_db(request), comp_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True, "message": "Компонент удалён"}


@router.post("/components/verify-reservations")
async def verify_reservations(request: Request, fix: bool = False):
    """Проверка целостности остатков (отрицательный stock).
    ?fix=true — привести найденные отрицательные остатки к нулю."""
    _require_perm(request, "warehouse.edit")
    return await warehouse_service.verify_reservations(_db(request), fix=fix)


# ── Batch ────────────────────────────────────────────────────────────────────

@router.post("/batch")
async def batch_operation(body: BatchOperationRequest, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.batch_operation(_db(request), body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Categories / Inventory ───────────────────────────────────────────────────

@router.get("/categories")
async def list_categories(request: Request):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_categories(_db(request))


@router.get("/inventory")
async def get_inventory(request: Request):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.get_inventory(_db(request))


# ── Operations ───────────────────────────────────────────────────────────────

@router.get("/operations/types")
async def operation_types(request: Request):
    _require_perm(request, "warehouse.view")
    return [
        {"value": "RECEIVE", "label": "Оприходование"},
        {"value": "WRITEOFF", "label": "Списание"},
        {"value": "CREATE", "label": "Создание компонента"},
        {"value": "UPDATE", "label": "Обновление компонента"},
        {"value": "DELETE", "label": "Удаление компонента"},
    ]


@router.get("/operations")
async def list_operations(
    request: Request,
    limit: int = 100, offset: int = 0,
    component_name: Optional[str] = None,
    operation_type: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    _require_perm(request, "warehouse.view")
    rows, total = await warehouse_service.list_operations(
        _db(request), limit, offset, component_name, operation_type, date_from, date_to
    )
    return {"operations": rows, "total": total, "limit": limit, "offset": offset}


# ── Production stock ─────────────────────────────────────────────────────────

@router.get("/production-stock", response_model=List[ProductionStockOut])
async def list_production_stock(request: Request):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_production_stock(_db(request))


# ── Availability check + reserve ─────────────────────────────────────────────

@router.post("/check-availability")
async def check_availability(request: Request):
    """Проверить наличие компонентов без списания."""
    _require_perm(request, "warehouse.view")
    body = await request.json()
    items = body.get("items", [])  # [{"component_name": str, "quantity": float}]
    if not items:
        return {"can_produce": True, "missing": [], "available": [], "total_items": 0}
    return await warehouse_service.check_availability(_db(request), items)


@router.post("/reserve-for-order")
async def reserve_for_order(body: ReserveForOrderRequest, request: Request):
    """Списать компоненты со склада под конкретный заказ (идемпотентно)."""
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.reserve_for_order(_db(request), body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Cases ─────────────────────────────────────────────────────────────────────

@router.get("/cases", response_model=List[CaseOut])
async def list_cases(request: Request):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_cases(_db(request))


@router.post("/cases", response_model=CaseOut, status_code=201)
async def create_case(body: CaseCreate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.create_case(_db(request), body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/cases/{case_id}", response_model=CaseOut)
async def update_case(case_id: int, body: CaseUpdate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.update_case(_db(request), case_id, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/cases/{case_id}")
async def delete_case(case_id: int, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        await warehouse_service.delete_case(_db(request), case_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True}


@router.patch("/cases/{case_id}/adjust")
async def adjust_case_stock(case_id: int, request: Request):
    """delta > 0 = приход, delta < 0 = списание."""
    _require_perm(request, "warehouse.edit")
    body = await request.json()
    delta = int(body.get("delta", 0))
    note = body.get("note", "")
    try:
        return await warehouse_service.adjust_case_stock(_db(request), case_id, delta, note)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
