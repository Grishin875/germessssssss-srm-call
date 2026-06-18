import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_health():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "warehouse"


@pytest.mark.asyncio
async def test_components_no_auth():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/warehouse/components")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_batch_invalid_type():
    from app.services.warehouse_service import batch_operation
    from app.schemas.warehouse import BatchOperationRequest, BatchItem
    db = AsyncMock()
    with pytest.raises(ValueError, match="Неверный тип операции"):
        await batch_operation(db, BatchOperationRequest(operationType="invalid", items=[BatchItem(name="X", qty=1)]))


@pytest.mark.asyncio
async def test_batch_empty_items():
    from app.services.warehouse_service import batch_operation
    from app.schemas.warehouse import BatchOperationRequest
    db = AsyncMock()
    with pytest.raises(ValueError, match="пуст"):
        await batch_operation(db, BatchOperationRequest(operationType="writeoff", items=[]))
