"""
Канонический производственный маршрут заказа (ТЗ).

12 шагов из ТЗ (шаг «формирование заказа» = само создание заказа, поэтому
этапами становятся шаги 2–12):

  1. формирование заказа               → create_order (не этап)
  2. распределение заказа              → distribution
  3. склад СМД                         → warehouse_smd   (выдача СМД-компонентов)
  4. СМД-монтаж                        → smd
  5. AOI (контроль)                    → aoi    [гейт] брак → назад в СМД-монтаж
  6. гравировка                        → engraving
  7. ветвление по признаку «приёмник»:
       приёмник     → прошивка         → firmware → склад готовой продукции
       не приёмник  → склад РЭА        → warehouse_rea
                      выдача со склада  → issue_rea
                      сборка РЭА        → assembly
                      проверка ОТК      → otk    [гейт] брак → назад в сборку РЭА
  8. склад готовой продукции           → warehouse_fg
  9. сборка всего заказа               → order_assembly
 10. отгрузка                          → shipment

Признаки изделия (product_catalog):
  needs_smd       — нужен ли блок СМД (склад СМД + монтаж + AOI + гравировка)
  is_receiver     — изделие-приёмник (после СМД — прошивка, без сборки РЭА)
  needs_assembly  — нужна ли сборка РЭА (склад РЭА → выдача → сборка → ОТК)
"""

# Гейты контроля качества: stage_type → stage_type, куда возвращается брак.
QC_GATES = {
    "aoi": "smd",        # AOI: брак → переделка СМД-монтажа → снова AOI
    "otk": "assembly",   # ОТК: брак → назад в сборку РЭА → снова ОТК
}

# Этапы-склады, которые при завершении приходуют готовую продукцию.
# Только реальный склад готовой продукции "warehouse_fg". Generic-тип "warehouse"
# убран: это промежуточный складской этап (склад СМД/РЭА), он НЕ должен приходовать ГП.
FINISHED_GOODS_STAGES = {"warehouse_fg"}

# Канонические типы этапов и их человекочитаемые названия.
CANONICAL_STAGE_LABELS = {
    "distribution":   "Распределение заказа",
    "warehouse_smd":  "Склад СМД",
    "smd":            "СМД-монтаж",
    "aoi":            "AOI — контроль",
    "engraving":      "Гравировка",
    "firmware":       "Прошивка",
    "warehouse_rea":  "Склад РЭА",
    "issue_rea":      "Выдача со склада РЭА",
    "assembly":       "Сборка РЭА",
    "otk":            "Проверка ОТК",
    "warehouse_fg":   "Склад готовой продукции",
    "order_assembly": "Сборка всего заказа",
    "shipment":       "Отгрузка",
}

# Роль по умолчанию для этапа (если в системе заведена соответствующая роль).
_DEFAULT_ROLE = {
    "smd":       "operator_smd",
    "engraving": "operator_engraving",
    "aoi":       "operator_otk",
    "otk":       "operator_otk",
    "shipment":  "operator_shipment",
}


def build_canonical_stages(
    needs_smd: bool = True,
    is_receiver: bool = False,
    needs_assembly: bool = True,
) -> list[dict]:
    """Собрать список этапов канонического маршрута по признакам изделия.

    Возвращает список словарей с полями:
      stage_type, stage_name, sort_order, depends_on_previous,
      required_role, rework_target_type, instructions
    Этапы идут последовательно (depends_on_previous=1); sort_order с шагом 10.
    """
    steps: list[str] = ["distribution"]

    if needs_smd:
        steps += ["warehouse_smd", "smd", "aoi", "engraving"]

    if is_receiver:
        # Приёмник: прошивка, затем сразу склад готовой продукции (без сборки РЭА)
        steps += ["firmware"]
    elif needs_assembly:
        # Не приёмник: полный цикл РЭА
        steps += ["warehouse_rea", "issue_rea", "assembly", "otk"]

    steps += ["warehouse_fg", "order_assembly", "shipment"]

    out: list[dict] = []
    for i, st in enumerate(steps):
        out.append({
            "stage_type": st,
            "stage_name": CANONICAL_STAGE_LABELS.get(st, st),
            "sort_order": (i + 1) * 10,
            "depends_on_previous": 1,
            "required_role": _DEFAULT_ROLE.get(st),
            "rework_target_type": QC_GATES.get(st),
            "instructions": None,
        })
    return out
