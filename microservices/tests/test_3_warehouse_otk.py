"""Тесты: склад (списание/возврат) и ОТК статус-машина, SLA."""
from conftest import get_stock


# ── Склад: списание при создании и возврат при отмене ──────────────────────────

def test_components_writeoff_on_create(factory):
    """При создании заказа компоненты списываются со склада."""
    p = f"ZZTEST-WO-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-wo"
    factory.comp(comp, 100)
    factory.recipe(p, comp, 2, "SMD")

    before = get_stock(factory.api, comp)
    assert before == 100
    factory.order(p, 10)  # demand = 2 * 10 = 20
    after = get_stock(factory.api, comp)
    assert after == 80, f"Ожидалось 80 после списания, получено {after}"


def test_components_returned_on_cancel(factory):
    """При отмене заказа списанные компоненты возвращаются (идемпотентно)."""
    p = f"ZZTEST-RET-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-ret"
    factory.comp(comp, 100)
    factory.recipe(p, comp, 5, "SMD")

    o = factory.order(p, 4)  # demand = 20
    assert get_stock(factory.api, comp) == 80

    # отмена → возврат
    r = factory.api.delete(f"/api/orders/{o['id']}")
    assert r.status_code in (200, 201), f"cancel: {r.status_code} {r.text[:300]}"
    assert get_stock(factory.api, comp) == 100, "Компоненты не вернулись на склад"

    # повторная отмена не должна задвоить возврат
    factory.api.delete(f"/api/orders/{o['id']}")
    assert get_stock(factory.api, comp) == 100, "Повторная отмена задвоила возврат!"


def test_cancel_terminal_order_rejected(factory):
    """Нельзя отменить уже отменённый заказ."""
    p = f"ZZTEST-TERM-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-t"
    factory.comp(comp, 100)
    factory.recipe(p, comp, 1, "SMD")
    o = factory.order(p, 2)
    factory.api.delete(f"/api/orders/{o['id']}")            # первая отмена ок
    r = factory.api.delete(f"/api/orders/{o['id']}")        # вторая
    assert r.status_code == 400, f"Повторная отмена должна давать 400, а дала {r.status_code}"


# ── ОТК статус-машина ──────────────────────────────────────────────────────────

def test_otk_pass_updates_order_status(factory):
    """Заказ сдан в ОТК и принят (годно) → партия 'готово к отгрузке'."""
    p = f"ZZTEST-OTK-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-otk"
    factory.comp(comp, 1000)
    factory.recipe(p, comp, 1, "SMD")
    factory.stage(p, "Сборка", "assembly", 0)

    o = factory.order(p, 3)
    factory.api.post(f"/api/orders/{o['id']}/start")
    # сдаём в ОТК
    r = factory.api.post(f"/api/orders/{o['id']}/submit-otk", json={})
    assert r.status_code in (200, 201), f"submit-otk: {r.status_code} {r.text[:300]}"
    body = r.json()
    otk_ids = body.get("otk_batch_ids") or []
    assert otk_ids, f"ОТК-партии не созданы: {body}"

    # ОТК принимает всё годным (result=1)
    chk = factory.api.post("/api/otk/check", json={
        "batchId": otk_ids[0], "otkId": "1", "result": 1
    })
    assert chk.status_code in (200, 201), f"otk/check: {chk.status_code} {chk.text[:300]}"
    res = chk.json()
    assert res.get("status") == "готово к отгрузке", f"Статус партии: {res.get('status')}"

    # статус заказа пересчитан статус-машиной
    order = factory.api.ok("GET", f"/api/orders/{o['id']}")
    assert order["status"] in ("Готов к отгрузке", "На проверке ОТК", "Завершен"), \
        f"Статус заказа после ОТК: {order['status']}"


def test_otk_defect_returns_to_rework(factory):
    """Брак в ОТК (result=3) → заказ возвращается на доработку."""
    p = f"ZZTEST-DEF-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-def"
    factory.comp(comp, 1000)
    factory.recipe(p, comp, 1, "SMD")
    factory.stage(p, "Сборка", "assembly", 0)

    o = factory.order(p, 2)
    factory.api.post(f"/api/orders/{o['id']}/start")
    r = factory.api.post(f"/api/orders/{o['id']}/submit-otk", json={})
    otk_ids = r.json().get("otk_batch_ids") or []
    assert otk_ids

    chk = factory.api.post("/api/otk/check", json={
        "batchId": otk_ids[0], "otkId": "1", "result": 3, "defect_comment": "тестовый брак"
    })
    assert chk.status_code in (200, 201), f"otk/check defect: {chk.status_code} {chk.text[:300]}"

    order = factory.api.ok("GET", f"/api/orders/{o['id']}")
    assert order["status"] == "Доработка", f"После брака ожидалась Доработка, а статус {order['status']}"


# ── SLA ────────────────────────────────────────────────────────────────────────

def test_sla_check_endpoint(api):
    """Эндпоинт проверки SLA-нарушений доступен и возвращает список."""
    r = api.get("/api/sla-rules/check")
    assert r.status_code == 200, f"sla-rules/check: {r.status_code} {r.text[:300]}"
    assert isinstance(r.json(), list)
