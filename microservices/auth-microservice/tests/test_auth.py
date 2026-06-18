import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture
def mock_user():
    u = MagicMock()
    u.id = 1
    u.username = "admin"
    u.role = "admin"
    u.is_active = True
    u.full_name = "Admin"
    u.photo_url = None
    u.departments_access = []
    u.user_permissions = {}
    u.last_login = None
    u.created_at = None
    u.email = None
    u.phone = None
    return u


@pytest.mark.asyncio
async def test_health():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "auth"


@pytest.mark.asyncio
async def test_register_disabled():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/auth/register", json={})
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_login_missing_fields():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/api/auth/login", json={"username": "", "password": ""})
    assert resp.status_code in (400, 401, 422, 500)


@pytest.mark.asyncio
async def test_login_wrong_credentials():
    from app.main import app
    with patch("app.services.user_service.authenticate_user", new_callable=AsyncMock, return_value=None):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/auth/login", json={"username": "nobody", "password": "wrong"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_no_token():
    from app.main import app
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/api/auth/me")
    assert resp.status_code in (401, 403)
