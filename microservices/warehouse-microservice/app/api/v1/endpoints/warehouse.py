from fastapi import APIRouter, Depends, HTTPException, Request
from typing import List, Optional

from app.schemas.warehouse import (
    ComponentCreate, ComponentUpdate, ComponentOut,
    BatchOperationRequest, OperationOut, ProductionStockOut,
    CaseCreate, CaseUpdate, CaseOut, ReserveForOrderRequest,
    WarehouseCreate, WarehouseUpdate, WarehouseOut, WarehouseStockOut, StockTransferRequest,
    SupplierCreate, SupplierUpdate, SupplierOut,
    PurchaseRequestCreate, PurchaseRequestUpdate, PurchaseRequestOut, FromShortageRequest,
    ComponentRequestCreate,
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


# ── Warehouses (мультисклад) ──────────────────────────────────────────────────

@router.get("/warehouses", response_model=List[WarehouseOut])
async def list_warehouses(request: Request, include_inactive: bool = False):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_warehouses(_db(request), include_inactive=include_inactive)


@router.post("/warehouses", response_model=WarehouseOut, status_code=201)
async def create_warehouse(body: WarehouseCreate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.create_warehouse(_db(request), body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/warehouses/{wid}", response_model=WarehouseOut)
async def update_warehouse(wid: int, body: WarehouseUpdate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.update_warehouse(_db(request), wid, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/warehouses/{wid}")
async def delete_warehouse(wid: int, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        await warehouse_service.delete_warehouse(_db(request), wid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True}


@router.get("/warehouses/{wid}/stock", response_model=List[WarehouseStockOut])
async def warehouse_stock(wid: int, request: Request):
    _require_perm(request, "warehouse.view")
    try:
        return await warehouse_service.get_warehouse_stock(_db(request), wid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/stock/by-component/{component_name}", response_model=List[WarehouseStockOut])
async def component_distribution(component_name: str, request: Request):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.get_component_distribution(_db(request), component_name)


@router.post("/warehouses/transfer")
async def transfer_stock(body: StockTransferRequest, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.transfer_stock(_db(request), body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Закупка: поставщики ───────────────────────────────────────────────────────

@router.get("/suppliers", response_model=List[SupplierOut])
async def list_suppliers(request: Request, include_inactive: bool = False):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_suppliers(_db(request), include_inactive=include_inactive)


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
async def create_supplier(body: SupplierCreate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.create_supplier(_db(request), body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/suppliers/{sid}", response_model=SupplierOut)
async def update_supplier(sid: int, body: SupplierUpdate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.update_supplier(_db(request), sid, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/suppliers/{sid}")
async def delete_supplier(sid: int, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        await warehouse_service.delete_supplier(_db(request), sid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True}


# ── Закупка: заявки ───────────────────────────────────────────────────────────

@router.get("/purchase-requests", response_model=List[PurchaseRequestOut])
async def list_purchase_requests(request: Request, status: Optional[str] = None):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_purchase_requests(_db(request), status=status)


@router.get("/purchase-requests/{pid}", response_model=PurchaseRequestOut)
async def get_purchase_request(pid: int, request: Request):
    _require_perm(request, "warehouse.view")
    try:
        return await warehouse_service.get_purchase_request(_db(request), pid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/purchase-requests", response_model=PurchaseRequestOut, status_code=201)
async def create_purchase_request(body: PurchaseRequestCreate, request: Request):
    user = _require_perm(request, "warehouse.edit")
    return await warehouse_service.create_purchase_request(
        _db(request), body, created_by=getattr(user, "username", None))


@router.post("/purchase-requests/from-shortage", response_model=PurchaseRequestOut, status_code=201)
async def purchase_from_shortage(body: FromShortageRequest, request: Request):
    user = _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.create_from_shortage(
            _db(request), body, created_by=getattr(user, "username", None))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/purchase-requests/{pid}", response_model=PurchaseRequestOut)
async def update_purchase_request(pid: int, body: PurchaseRequestUpdate, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.update_purchase_request(_db(request), pid, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/purchase-requests/{pid}/receive", response_model=PurchaseRequestOut)
async def receive_purchase_request(pid: int, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.receive_purchase_request(_db(request), pid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/purchase-requests/{pid}")
async def delete_purchase_request(pid: int, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        await warehouse_service.delete_purchase_request(_db(request), pid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True}


# ── Заявки на компоненты (брак / дозапрос) ────────────────────────────────────

@router.post("/component-requests")
async def create_component_request(body: ComponentRequestCreate, request: Request):
    """Создать заявку на компонент (брак). Доступно любому авторизованному оператору."""
    user = _user(request)
    try:
        return await warehouse_service.create_component_request(
            _db(request), body,
            user_id=getattr(user, "id", None),
            user_name=getattr(user, "username", None),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/component-requests")
async def list_component_requests(request: Request, status: Optional[str] = None):
    _require_perm(request, "warehouse.view")
    return await warehouse_service.list_component_requests(_db(request), status=status)


@router.post("/component-requests/{req_id}/issue")
async def issue_component_request(req_id: int, request: Request):
    user = _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.issue_component_request(
            _db(request), req_id,
            user_id=getattr(user, "id", None),
            user_name=getattr(user, "username", None),
        )
    except PermissionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/component-requests/{req_id}/reject")
async def reject_component_request(req_id: int, request: Request):
    _require_perm(request, "warehouse.edit")
    try:
        return await warehouse_service.reject_component_request(_db(request), req_id)
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
