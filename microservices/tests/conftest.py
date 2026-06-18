"""
Интеграционные тесты бизнес-логики против живого gateway (http://localhost:8000).

Запуск:
    pip install -r microservices/tests/requirements-test.txt
    pytest microservices/tests -v

Тесты создают изолированные тестовые данные (изделие/компоненты с префиксом ZZTEST-)
и убирают их за собой. Работают против реальной БД в Docker.
"""
import os
import time
import requests
import pytest

BASE = os.environ.get("CRM_BASE_URL", "http://localhost:8000")
ADMIN_USER = os.environ.get("CRM_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("CRM_ADMIN_PASS", "admin")

# Уникальный суффикс на прогон, чтобы тесты не конфликтовали между собой
RUN_ID = str(int(time.time()))


class Api:
    """Тонкий HTTP-клиент с авторизацией и понятными ошибками."""
    def __init__(self, base, token=None):
        self.base = base
        self.s = requests.Session()
        if token:
            self.s.headers["Authorization"] = f"Bearer {token}"

    def _req(self, method, path, **kw):
        r = self.s.request(method, f"{self.base}{path}", timeout=20, **kw)
        return r

    def get(self, path, **kw):  return self._req("GET", path, **kw)
    def post(self, path, json=None, **kw): return self._req("POST", path, json=json, **kw)
    def put(self, path, json=None, **kw):  return self._req("PUT", path, json=json, **kw)
    def patch(self, path, json=None, **kw): return self._req("PATCH", path, json=json, **kw)
    def delete(self, path, **kw): return self._req("DELETE", path, **kw)

    def ok(self, method, path, json=None, expect=(200, 201)):
        """Запрос с проверкой кода. Возвращает JSON-тело."""
        r = self._req(method, path, json=json)
        assert r.status_code in expect, (
            f"{method} {path} -> {r.status_code} (ожидалось {expect})\n{r.text[:500]}"
        )
        try:
            return r.json()
        except Exception:
            return None


@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, f"Логин admin не удался: {r.status_code} {r.text[:300]}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def api(token):
    return Api(BASE, token)


@pytest.fixture
def factory(api):
    """Фабрика тестовых данных с автоочисткой после теста."""
    created = {"orders": [], "recipe_ids": [], "stage_ids": [], "component_ids": [], "products": []}

    def comp(name, stock):
        body = {"name": name, "stock": stock, "category": "ZZTEST", "block": "ZZTEST", "unit": "шт"}
        r = api.post("/api/warehouse/components", json=body)
        assert r.status_code in (200, 201), f"createComponent: {r.status_code} {r.text[:300]}"
        data = r.json()
        if data.get("id"):
            created["component_ids"].append(data["id"])
        return data

    def recipe(product, component, norm, production_type="SMD"):
        body = {
            "component_name": component, "product_name": product, "norm": norm,
            "production_type": production_type, "source": "warehouse",
            "warehouse_component_name": component,
        }
        r = api.post("/api/recipes", json=body)
        assert r.status_code in (200, 201), f"createRecipe: {r.status_code} {r.text[:300]}"
        data = r.json()
        if data.get("id"):
            created["recipe_ids"].append(data["id"])
        if product not in created["products"]:
            created["products"].append(product)
        return data

    def stage(product, name, stage_type, sort_order, depends_on_previous=1, required_role=None):
        body = {
            "product_name": product, "stage_name": name, "stage_type": stage_type,
            "sort_order": sort_order, "depends_on_previous": depends_on_previous,
        }
        if required_role:
            body["required_role"] = required_role
        r = api.post("/api/recipes/recipe-stages", json=body)
        assert r.status_code in (200, 201), f"createRecipeStage: {r.status_code} {r.text[:300]}"
        data = r.json()
        if data.get("id"):
            created["stage_ids"].append(data["id"])
        return data

    def order(product, qty, **extra):
        body = {"product_name": product, "planned_qty": qty, "priority": "Обычный", **extra}
        r = api.post("/api/orders", json=body)
        assert r.status_code in (200, 201), f"createOrder: {r.status_code} {r.text[:300]}"
        data = r.json()
        if data.get("id"):
            created["orders"].append(data["id"])
        return data

    f = type("Factory", (), {})()
    f.comp = comp
    f.recipe = recipe
    f.stage = stage
    f.order = order
    f.api = api
    f.run_id = RUN_ID
    yield f

    # ── Teardown: чистим за собой (best-effort) ──
    for oid in created["orders"]:
        api.delete(f"/api/orders/{oid}")
    for sid in created["stage_ids"]:
        api.delete(f"/api/recipes/recipe-stages/{sid}")
    for rid in created["recipe_ids"]:
        api.delete(f"/api/recipes/{rid}")
    for cid in created["component_ids"]:
        api.delete(f"/api/warehouse/components/{cid}")


def get_stock(api, name):
    """Текущий остаток компонента по имени."""
    r = api.get("/api/warehouse/components")
    for c in r.json():
        if c["name"].strip().lower() == name.strip().lower():
            return float(c["stock"])
    return None
