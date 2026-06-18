from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from shared.core.database import Base


class FirmwareBatch(Base):
    __tablename__ = "firmware_batches"

    id = Column(Integer, primary_key=True)
    batch_id = Column(String(100), unique=True, nullable=False)
    source_batch_id = Column(String(100))
    product_name = Column(String(500))
    qty = Column(Integer, default=0)
    good_qty = Column(Integer, default=0)
    defect_qty = Column(Integer, default=0)
    operator_id = Column(String(50))
    firmware_version = Column(String(100))
    status = Column(String(100), default="В работе")
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    comment = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Document(Base):
    __tablename__ = "documents"

    id          = Column(Integer, primary_key=True)
    name        = Column(String(500), nullable=False)
    description = Column(Text)
    category    = Column(String(200))
    tags        = Column(Text)
    file_path   = Column(String(1000))
    file_name   = Column(String(500))
    file_type   = Column(String(20))   # pdf | docx | xlsx | jpg | png
    file_size   = Column(Integer, default=0)
    content     = Column(Text)         # extracted/editable text
    created_by  = Column(Integer)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
