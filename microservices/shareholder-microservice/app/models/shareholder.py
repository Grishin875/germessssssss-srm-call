from sqlalchemy import Column, Integer, String, Text, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from shared.core.database import Base


class IntegrationNomenclatureMapping(Base):
    __tablename__ = "integration_nomenclature_mapping"

    id = Column(Integer, primary_key=True)
    onec_code = Column(String(100), unique=True, nullable=False)
    onec_name = Column(String(500), nullable=False)
    crm_product_name = Column(String(500), nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class IntegrationOrder(Base):
    __tablename__ = "integration_orders"

    id = Column(Integer, primary_key=True)
    source = Column(String(20), nullable=False)
    external_id = Column(String(200), nullable=False)
    crm_order_id = Column(Integer)
    raw_payload = Column(JSONB)
    status = Column(String(50), default="pending")
    error_message = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_integration_order"),
    )
