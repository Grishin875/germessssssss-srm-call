import json
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, UniqueConstraint, Boolean
from sqlalchemy.sql import func
from shared.core.database import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True)
    product_name = Column(String(500), nullable=False)
    planned_qty = Column(Integer, nullable=False)
    actual_qty = Column(Integer, default=0)
    assigned_operator_id = Column(String(50))
    priority = Column(String(50), default="Обычный")
    deadline = Column(String(50))
    comment = Column(Text)
    status = Column(String(100), default="Создан")
    assigned_department = Column(String(100))
    managers = Column(Text)                        # JSON список id руководителей проекта
    otk_comment = Column(Text)
    submit_photo_url = Column(String(500))        # фото оператора при сдаче в ОТК
    otk_rejection_photo = Column(String(500))     # фото брака от ОТК
    otk_attempts = Column(Integer, default=0)     # сколько раз отправляли в ОТК
    skipped_stage_ids = Column(Text)              # JSON: id этапов рецептуры, пропущенных в этом заказе
    tags = Column(Text)                           # JSON список тегов/меток заказа
    positions = Column(Text)                      # JSON: [{name, qty}] — комплектация (список позиций для Excel)
    received_date = Column(String(50))            # дата получения заказа
    shipment_date = Column(String(50))            # дата отправки заказа
    parent_order_id = Column(Integer)             # родительский заказ (для авто-под-заказов на полуфабрикаты)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class OrderItem(Base):
    """Позиция заказа (line item). Заказ = шапка + список позиций.
    Каждая позиция = изделие из каталога + кол-во, со своим производством/ОТК."""
    __tablename__ = "order_items"

    id           = Column(Integer, primary_key=True)
    order_id     = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    product_name = Column(String(500), nullable=False)   # изделие из каталога/рецептур
    planned_qty  = Column(Integer, nullable=False, default=0)
    actual_qty   = Column(Integer, default=0)
    status       = Column(String(100), default="Создан")  # своя статус-машина позиции
    sort_order   = Column(Integer, default=0)
    priority     = Column(String(50))                      # null = наследует приоритет заказа
    comment      = Column(Text)
    skipped_stage_ids = Column(Text)                       # JSON: пропуски этапов рецептуры этой позиции
    created_at   = Column(DateTime, server_default=func.now())
    updated_at   = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ProductionBatch(Base):
    __tablename__ = "production_batches"

    batch_id = Column(String(100), primary_key=True)
    product_name = Column(String(500))
    production_type = Column(String(100))
    planned_qty = Column(Integer)
    actual_qty = Column(Integer, default=0)
    operator_id = Column(String(50))
    status = Column(String(100), default="Запланировано")
    order_id = Column(Integer, ForeignKey("orders.id"))
    order_item_id = Column(Integer, ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True)
    comment = Column(Text)
    line_number = Column(String(50))
    mounting_operator_number = Column(String(50))
    start_date = Column(DateTime)
    end_date = Column(DateTime)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ProductionBatchOperator(Base):
    __tablename__ = "production_batch_operators"

    id = Column(Integer, primary_key=True)
    batch_id = Column(String(100), ForeignKey("production_batches.batch_id"))
    operator_id = Column(String(50))
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("batch_id", "operator_id", name="uq_batch_operator"),
    )


class ProductionDailyProgress(Base):
    __tablename__ = "production_daily_progress"

    id = Column(Integer, primary_key=True)
    batch_id = Column(String(100), ForeignKey("production_batches.batch_id"))
    production_date = Column(String(20))
    qty_produced = Column(Integer, default=0)
    comment = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("batch_id", "production_date", name="uq_batch_date"),
    )


class CustomFieldDefinition(Base):
    """Определение кастомного поля для заказа."""
    __tablename__ = "custom_field_definitions"

    id         = Column(Integer, primary_key=True)
    name       = Column(String(100), nullable=False, unique=True)  # machine name
    label      = Column(String(200), nullable=False)               # отображаемое имя
    field_type = Column(String(20), nullable=False, default="text")  # text|number|date|select
    required   = Column(Boolean, default=False)
    options    = Column(Text, default="[]")   # JSON список для select
    sort_order = Column(Integer, default=0)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CustomFieldValue(Base):
    """Значение кастомного поля для конкретного заказа."""
    __tablename__ = "custom_field_values"

    id         = Column(Integer, primary_key=True)
    order_id   = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    field_id   = Column(Integer, ForeignKey("custom_field_definitions.id", ondelete="CASCADE"), nullable=False)
    value      = Column(Text)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("order_id", "field_id", name="uq_order_field"),
    )


class OrderComment(Base):
    """Комментарий к заказу."""
    __tablename__ = "order_comments"

    id         = Column(Integer, primary_key=True)
    order_id   = Column(Integer, ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    user_id    = Column(Integer, nullable=False)
    user_name  = Column(String(200))
    text       = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class OrderStage(Base):
    """
    Производственный этап заказа.
    stage_type: smd | engraving | 3d_print | assembly | warehouse | case
    status: pending | in_progress | done | blocked
    """
    __tablename__ = "order_stages"

    id            = Column(Integer, primary_key=True)
    order_id      = Column(Integer, ForeignKey("orders.id"), nullable=False)
    order_item_id = Column(Integer, ForeignKey("order_items.id", ondelete="CASCADE"), nullable=True)
    stage_type    = Column(String(50), nullable=False)
    stage_name    = Column(String(200))
    status        = Column(String(50), default="pending")
    sort_order    = Column(Integer, default=0)
    assigned_to   = Column(String(100))
    assigned_name = Column(String(200))
    accepted_by   = Column(String(50))                # кто «принял» задачу — закреплена лично за ним
    accepted_at   = Column(DateTime)                  # когда принял
    required_role = Column(String(50))
    depends_on_previous = Column(Integer, default=1)  # 1=ждать, 0=параллельно
    transfer_qty  = Column(Integer, default=0)        # 1=фиксировать передачу
    transferred_qty = Column(Integer)                 # фактически передано следующему этапу
    instructions  = Column(Text)                      # инструкция для исполнителя
    next_stage_id = Column(Integer, nullable=True)    # ребро графа: куда идёт ПОСЛЕ завершения/прохождения (pass)
    on_fail_stage_id = Column(Integer, nullable=True) # ребро графа: куда идёт при БРАКЕ на гейте (напр. Ремонт РЭА)
    rework_target_type = Column(String(50))           # legacy: тип этапа, куда уходит брак (если нет on_fail_stage_id)
    components_json = Column(Text, default="[]")
    output_name   = Column(String(500))               # что выходит из этапа (полуфабрикат/результат из рецептуры)
    est_minutes   = Column(Integer)                   # норматив времени на этап (мин)
    checklist     = Column(Text, default="[]")        # JSON: [{text, done}]
    result_photo  = Column(String(500))               # фото результата этапа
    pause_reason  = Column(Text)                      # причина паузы
    paused_at     = Column(DateTime)                  # когда поставлен на паузу
    started_at    = Column(DateTime)
    completed_at  = Column(DateTime)
    comment       = Column(Text)
    created_at    = Column(DateTime, server_default=func.now())
    updated_at    = Column(DateTime, server_default=func.now(), onupdate=func.now())

    @property
    def components(self) -> list:
        try:
            return json.loads(self.components_json or "[]")
        except Exception:
            return []


class StageAssignee(Base):
    """
    Исполнитель этапа с частью объёма.
    Один этап может иметь несколько исполнителей, каждый берёт qty_planned штук.
    """
    __tablename__ = "stage_assignees"

    id          = Column(Integer, primary_key=True)
    stage_id    = Column(Integer, ForeignKey("order_stages.id", ondelete="CASCADE"), nullable=False)
    user_id     = Column(Integer, nullable=False)
    user_name   = Column(String(200))
    qty_planned = Column(Integer, default=0)
    qty_done    = Column(Integer, default=0)
    status      = Column(String(50), default="pending")  # pending | in_progress | done
    started_at  = Column(DateTime)
    completed_at = Column(DateTime)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("stage_id", "user_id", name="uq_stage_user"),
    )


class ChatChannel(Base):
    """Канал чата. kind: group | direct | order.
    Для order-каналов order_id указывает на заказ (один канал на заказ)."""
    __tablename__ = "chat_channels"

    id          = Column(Integer, primary_key=True)
    kind        = Column(String(20), nullable=False, default="group")  # group | direct | order
    name        = Column(String(200))                 # для group/order; для direct формируется на лету
    order_id    = Column(Integer, nullable=True)       # для kind='order'
    created_by  = Column(Integer)
    is_archived = Column(Boolean, default=False)
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())


class ChatChannelMember(Base):
    """Участник канала + его прочитанность (last_read_message_id для непрочитанных)."""
    __tablename__ = "chat_channel_members"

    id                   = Column(Integer, primary_key=True)
    channel_id           = Column(Integer, ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False)
    user_id              = Column(Integer, nullable=False)
    user_name            = Column(String(200))
    last_read_message_id = Column(Integer, default=0)
    is_muted             = Column(Boolean, default=False)
    joined_at            = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("channel_id", "user_id", name="uq_channel_user"),
    )


class ChatMessage(Base):
    """Сообщение в канале чата."""
    __tablename__ = "chat_messages"

    id         = Column(Integer, primary_key=True)
    channel_id = Column(Integer, ForeignKey("chat_channels.id", ondelete="CASCADE"), nullable=False)
    user_id    = Column(Integer, nullable=False)
    user_name  = Column(String(200))
    text       = Column(Text, nullable=False)
    reply_to   = Column(Integer, nullable=True)        # id сообщения, на которое отвечают
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
    edited_at  = Column(DateTime, nullable=True)


class StageRouteTemplate(Base):
    """Переиспользуемый шаблон маршрута производства (#33).
    stages_json — список этапов: [{stage_name, stage_type, required_role,
    sort_order, depends_on_previous, instructions, est_minutes}]."""
    __tablename__ = "stage_route_templates"

    id          = Column(Integer, primary_key=True)
    name        = Column(String(200), nullable=False)
    description = Column(Text)
    stages_json = Column(Text, default="[]")
    created_at  = Column(DateTime, server_default=func.now())
    updated_at  = Column(DateTime, server_default=func.now(), onupdate=func.now())
