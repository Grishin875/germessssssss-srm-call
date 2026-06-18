from sqlalchemy import Column, Integer, String, Text, DateTime, Float, Boolean, ForeignKey
from sqlalchemy.sql import func
from shared.core.database import Base


class Operator(Base):
    __tablename__ = "operators"

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    role = Column(String(100))
    employee_id = Column(String(50), unique=True, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ProductionTask(Base):
    __tablename__ = "production_tasks"

    id = Column(Integer, primary_key=True)
    title = Column(String(500), nullable=False)
    description = Column(Text, default="")
    priority = Column(String(20), default="normal")
    status = Column(String(20), default="pending")
    assigned_operator_id = Column(String(50))
    created_by = Column(Integer)
    completed_by = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())
    completed_at = Column(DateTime)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ShiftSchedule(Base):
    __tablename__ = "shift_schedule"

    id = Column(Integer, primary_key=True)
    shift_date = Column(String(20), nullable=False)
    shift_type = Column(String(50))
    start_time = Column(String(10))
    end_time = Column(String(10))
    operator_id = Column(String(50), nullable=False)
    department = Column(String(100))
    comment = Column(Text)
    status = Column(String(50), default="Запланирована")
    actual_hours = Column(Float)
    created_by = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Suggestion(Base):
    __tablename__ = "suggestions"

    id = Column(Integer, primary_key=True)
    title = Column(String(500))
    description = Column(Text)
    category = Column(String(100))
    user_id = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ShiftChecklist(Base):
    __tablename__ = "shift_checklist"

    id = Column(Integer, primary_key=True)
    title = Column(String(500))
    category = Column(String(100))
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())


# ── A. Динамические типы этапов ───────────────────────────────────────────────
class StageType(Base):
    __tablename__ = "stage_types"

    id         = Column(Integer, primary_key=True)
    code       = Column(String(50), unique=True, nullable=False)   # smd, assembly, ...
    label      = Column(String(100), nullable=False)               # "СМД", "Сборка"
    color      = Column(String(20), default="#6b7280")             # hex color
    icon       = Column(String(50))                                # emoji или code
    sort_order = Column(Integer, default=0)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ── B. Настраиваемые роли ─────────────────────────────────────────────────────
class SystemRole(Base):
    __tablename__ = "system_roles"

    id                 = Column(Integer, primary_key=True)
    code               = Column(String(50), unique=True, nullable=False)  # operator_smd, ...
    label              = Column(String(100), nullable=False)
    allowed_stage_types = Column(Text, default="[]")  # JSON список кодов stage_type
    is_production      = Column(Boolean, default=False)  # производственная роль
    is_active          = Column(Boolean, default=True)
    created_at         = Column(DateTime, server_default=func.now())
    updated_at         = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ── C. Воркфлоу статусов заказа ───────────────────────────────────────────────
class OrderStatus(Base):
    __tablename__ = "order_statuses"

    id          = Column(Integer, primary_key=True)
    code        = Column(String(100), unique=True, nullable=False)
    label       = Column(String(100), nullable=False)
    color       = Column(String(20), default="#6b7280")
    is_terminal = Column(Boolean, default=False)   # финальный статус
    sort_order  = Column(Integer, default=0)
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


class StatusTransition(Base):
    __tablename__ = "status_transitions"

    id           = Column(Integer, primary_key=True)
    from_status  = Column(String(100), nullable=False)
    to_status    = Column(String(100), nullable=False)
    allowed_roles = Column(Text, default="[]")  # JSON список ролей, [] = все
    created_at   = Column(DateTime, server_default=func.now())


# ── F. Настраиваемые приоритеты ───────────────────────────────────────────────
class Priority(Base):
    __tablename__ = "priorities"

    id          = Column(Integer, primary_key=True)
    code        = Column(String(50), unique=True, nullable=False)
    label       = Column(String(100), nullable=False)
    color       = Column(String(20), default="#6b7280")
    sort_weight = Column(Integer, default=0)   # чем больше — тем важнее
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ── G. Уведомления ───────────────────────────────────────────────────────────
class Notification(Base):
    __tablename__ = "notifications"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, nullable=False)
    type       = Column(String(50), default="info")   # info | warning | success
    title      = Column(String(300), nullable=False)
    message    = Column(Text)
    link       = Column(String(500))    # куда перейти по клику
    is_read    = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


# ── N. SLA правила ───────────────────────────────────────────────────────────
class SlaRule(Base):
    """Правило SLA: для каждого статуса — максимальное время пребывания в нём."""
    __tablename__ = "sla_rules"

    id           = Column(Integer, primary_key=True)
    status       = Column(String(100), nullable=False, unique=True)  # статус заказа
    max_hours    = Column(Integer, nullable=False, default=24)        # мак. часов в статусе
    notify_roles = Column(Text, default="[]")                        # JSON список ролей
    is_active    = Column(Boolean, default=True)
    created_at   = Column(DateTime, server_default=func.now())
    updated_at   = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ── H. Аудит ─────────────────────────────────────────────────────────────────
class AuditLog(Base):
    __tablename__ = "audit_log"

    id          = Column(Integer, primary_key=True)
    entity_type = Column(String(50), nullable=False)  # order | stage | user
    entity_id   = Column(Integer)
    user_id     = Column(Integer)
    user_name   = Column(String(200))
    action      = Column(String(100), nullable=False)  # status_changed | assigned | ...
    old_value   = Column(Text)
    new_value   = Column(Text)
    details     = Column(Text)    # JSON доп. инфо
    created_at  = Column(DateTime, server_default=func.now())


# ── L. Webhooks ──────────────────────────────────────────────────────────────
class Webhook(Base):
    """Исходящий webhook: POST на URL при наступлении событий."""
    __tablename__ = "webhooks"

    id          = Column(Integer, primary_key=True)
    name        = Column(String(200), nullable=False)
    url         = Column(Text, nullable=False)
    events      = Column(Text, default="[]")     # JSON: ["order.status_changed","stage.completed",...]
    secret      = Column(String(200))            # HMAC-секрет (опц.)
    is_active   = Column(Boolean, default=True)
    last_status = Column(String(50))             # результат последнего вызова
    last_called_at = Column(DateTime)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


# ── G. Подписки на уведомления ───────────────────────────────────────────────
class NotificationSubscription(Base):
    """Подписка пользователя/роли на тип события уведомления."""
    __tablename__ = "notification_subscriptions"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer)                 # либо user_id, либо role
    role       = Column(String(100))
    event_type = Column(String(100), nullable=False)  # order.status_changed | stage.completed | sla.violation | mention | otk.defect
    enabled    = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
