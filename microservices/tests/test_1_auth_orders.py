"""Тесты: авторизация, создание заказа, генерация этапов из рецептуры."""
from conftest import BASE, get_stock
import requests


# ── Auth ──────────────────────────────────────────────────────────────────────

def test_login_ok(token):
    assert isinstance(token, str) and len(token) > 20


def test_login_wrong_password():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"username": "admin", "password": "WRONG-xxx"}, timeout=20)
    assert r.status_code in (400, 401, 403), f"Неверный пароль должен отклоняться, а вернул {r.status_code}"


def test_me_requires_token():
    r = requests.get(f"{BASE}/api/auth/me", timeout=20)
    assert r.status_code in (401, 403, 500), f"auth/me без токена: {r.status_code}"


# ── Создание заказа ───────────────────────────────────────────────────────────

def test_order_created_status(factory):
    p = f"ZZTEST-ORD-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-a"
    factory.comp(comp, 1000)
    factory.recipe(p, comp, 2, "SMD")

    o = factory.order(p, 5)
    assert o["id"] > 0
    assert o["product_name"] == p
    assert o["status"] in ("Создан", "В работе"), f"Неожиданный статус: {o['status']}"


def test_order_waits_when_no_components(factory):
    """Если компонентов на складе не хватает — заказ 'Ожидает компонентов'."""
    p = f"ZZTEST-NOCOMP-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-low"
    factory.comp(comp, 1)            # мало
    factory.recipe(p, comp, 10, "SMD")  # надо 10*qty

    o = factory.order(p, 5)          # нужно 50, есть 1
    assert o["status"] == "Ожидает компонентов", f"Ожидался дефицит, статус: {o['status']}"


def test_order_generates_stages_on_start(factory):
    """После старта заказа этапы создаются из recipe_stages."""
    p = f"ZZTEST-GEN-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-g"
    factory.comp(comp, 1000)
    factory.recipe(p, comp, 1, "SMD")
    factory.stage(p, "Пайка SMD", "smd", 0)
    factory.stage(p, "Сборка", "assembly", 1)

    o = factory.order(p, 3)
    # запускаем
    r = factory.api.post(f"/api/orders/{o['id']}/start")
    assert r.status_code in (200, 201), f"start: {r.status_code} {r.text[:300]}"

    stages = factory.api.ok("GET", f"/api/orders/{o['id']}/stages")
    names = sorted(s["stage_name"] for s in stages)
    assert "Пайка SMD" in names and "Сборка" in names, f"Этапы не сгенерированы: {names}"
