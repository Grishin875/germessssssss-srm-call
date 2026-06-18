"""Тесты: пропуск этапов и цепочка активации (blocked → pending)."""


def _stages_by_name(api, order_id):
    stages = api.ok("GET", f"/api/orders/{order_id}/stages")
    return {s["stage_name"]: s for s in stages}


def test_skip_stage_excluded(factory):
    """Этап, помеченный пропущенным, не создаётся в заказе."""
    p = f"ZZTEST-SKIP-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-s"
    factory.comp(comp, 1000)
    factory.recipe(p, comp, 1, "SMD")
    s1 = factory.stage(p, "Этап-A", "smd", 0)
    s2 = factory.stage(p, "Этап-B", "3d_print", 1)
    s3 = factory.stage(p, "Этап-C", "assembly", 2)

    # создаём заказ, пропуская Этап-B
    o = factory.order(p, 2, skipped_stage_ids=[s2["id"]])
    factory.api.post(f"/api/orders/{o['id']}/start")

    names = set(_stages_by_name(factory.api, o["id"]).keys())
    assert "Этап-A" in names
    assert "Этап-C" in names
    assert "Этап-B" not in names, f"Пропущенный этап всё равно создан: {names}"


def test_stage_chain_activation(factory):
    """Завершение этапа разблокирует следующий уровень (blocked → pending)."""
    p = f"ZZTEST-CHAIN-{factory.run_id}"
    comp = f"ZZCOMP-{factory.run_id}-c"
    factory.comp(comp, 1000)
    factory.recipe(p, comp, 1, "SMD")
    factory.stage(p, "Шаг1", "smd", 0, depends_on_previous=1)
    factory.stage(p, "Шаг2", "assembly", 1, depends_on_previous=1)

    o = factory.order(p, 2)
    factory.api.post(f"/api/orders/{o['id']}/start")

    st = _stages_by_name(factory.api, o["id"])
    assert "Шаг1" in st and "Шаг2" in st
    # Первый — активен (pending), второй — заблокирован
    assert st["Шаг1"]["status"] == "pending", f"Шаг1: {st['Шаг1']['status']}"
    assert st["Шаг2"]["status"] == "blocked", f"Шаг2 должен быть blocked, а он {st['Шаг2']['status']}"

    # Завершаем первый
    r = factory.api.patch(f"/api/orders/{o['id']}/stages/{st['Шаг1']['id']}/complete", json={})
    assert r.status_code in (200, 201), f"complete: {r.status_code} {r.text[:300]}"

    st2 = _stages_by_name(factory.api, o["id"])
    assert st2["Шаг1"]["status"] == "done"
    assert st2["Шаг2"]["status"] == "pending", f"Шаг2 не разблокирован: {st2['Шаг2']['status']}"
