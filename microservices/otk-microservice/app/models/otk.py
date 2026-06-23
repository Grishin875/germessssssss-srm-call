from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean
from sqlalchemy.sql import func
from shared.core.database import Base


class OtkBatch(Base):
    __tablename__ = "otk_batches"

    id = Column(Integer, primary_key=True)
    batch_id = Column(String(100), unique=True, nullable=False)
    product_name = Column(String(500))
    production_type = Column(String(100))
    released_qty = Column(Integer, default=0)
    good_qty = Column(Integer, default=0)
    defect_qty = Column(Integer, default=0)
    shipped_qty = Column(Integer, default=0)
    maker_id = Column(String(50))
    status = Column(String(100), default="Принята")
    receive_date = Column(DateTime)
    check_date = Column(DateTime)
    ship_date = Column(DateTime)
    shipper_id = Column(String(50))
    invoice_number   = Column(String(200), nullable=True)
    recipient        = Column(String(200), nullable=True)
    defect_comment = Column(Text)
    rejection_photo_url = Column(String(500))   # фото брака от ОТК
    source_batch_id = Column(String(100))
    order_id = Column(Integer)
    order_item_id = Column(Integer)   # позиция заказа (мультипозиционные заказы); без FK (кросс-сервис)
    is_firmware_done = Column(Boolean, default=False)
    firmware_qty = Column(Integer)
    firmware_version = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())


class DefectRecord(Base):
    __tablename__ = "defect_records"

    id = Column(Integer, primary_key=True)
    otk_batch_id = Column(Integer, ForeignKey("otk_batches.id"))
    defect_category_id = Column(Integer)
    otk_defect_type_id = Column(Integer)
    designator = Column(String(100))
    quantity = Column(Integer)
    comment = Column(Text)
    created_at = Column(DateTime, server_default=func.now())


class ScRepair(Base):
    __tablename__ = "sc_repairs"

    id = Column(Integer, primary_key=True)
    otk_batch_id = Column(Integer, ForeignKey("otk_batches.id"))
    operator_id = Column(String(50))
    repaired_qty = Column(Integer, default=0)
    comment = Column(Text)
    items_json = Column(Text)  # [{defect_type, original_qty, fixed_qty, comment}]
    created_at = Column(DateTime, server_default=func.now())


class OtkDefectType(Base):
    __tablename__ = "otk_defect_types"

    id = Column(Integer, primary_key=True)
    category = Column(String(100))
    subdescription = Column(String(500))
    sort_order = Column(Integer, default=0)


class DefectCategory(Base):
    __tablename__ = "defect_categories"

    id = Column(Integer, primary_key=True)
    name = Column(String(100))
    is_active = Column(Boolean, default=True)


class OtkRegulationProblem(Base):
    __tablename__ = "otk_regulation_problems"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500))
    problem = Column(Text)
    solution = Column(Text)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class OtkRegulationMeasurement(Base):
    __tablename__ = "otk_regulation_measurements"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500))
    point_name = Column(String(255))
    expected_value = Column(String(255))
    unit = Column(String(50))
    comment = Column(Text)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class OtkRegulationReplacement(Base):
    __tablename__ = "otk_regulation_replacements"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500))
    original_component = Column(String(500))
    replacement = Column(String(500))
    comment = Column(Text)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


class OtkRegulationTool(Base):
    __tablename__ = "otk_regulation_tools"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500))
    tool_name = Column(String(255))
    comment = Column(Text)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
