from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from shared.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    email = Column(String(255))
    phone = Column(String(50))
    birth_date = Column(DateTime)
    role = Column(String(50), default="user")          # admin | manager | user | operator_smd
    operator_function = Column(String(50))
    is_active = Column(Boolean, default=True)
    departments_access = Column(JSONB, default=list)
    user_permissions = Column(JSONB, default=dict)
    photo_url = Column(String(500))
    last_login = Column(DateTime)
    password_reset_token = Column(String(255))
    password_reset_expires = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
