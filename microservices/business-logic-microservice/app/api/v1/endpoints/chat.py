"""
Чат для общения внутри CRM.

Каналы (chat_channels):
  group  — групповой канал (произвольные участники)
  direct — личная переписка двух пользователей
  order  — обсуждение конкретного заказа (один канал на заказ)

Доставка — через polling (фронт опрашивает /messages?after_id=). У каждого
участника хранится last_read_message_id для подсчёта непрочитанных.
"""
import re
import logging
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from sqlalchemy import select, text, func
from pydantic import BaseModel

from app.models.business import ChatChannel, ChatChannelMember, ChatMessage
from shared.core.notify import notify_user

router = APIRouter()
logger = logging.getLogger(__name__)

GENERAL_CHANNEL_NAME = "Общий чат"
_MENTION_RE = re.compile(r"@([A-Za-z0-9_.\-а-яёА-ЯЁ]+)")


def _db(r: Request):
    return r.state.db


def _user(r: Request):
    u = r.state.current_user
    if not u:
        raise HTTPException(401, "Не авторизован")
    return u


def _uname(u) -> str:
    return getattr(u, "full_name", None) or getattr(u, "username", None) or str(u.id)


async def _is_member(db, channel_id: int, user_id: int) -> bool:
    row = (await db.execute(
        select(ChatChannelMember.id).where(
            ChatChannelMember.channel_id == channel_id,
            ChatChannelMember.user_id == user_id,
        )
    )).scalar_one_or_none()
    return row is not None


async def _ensure_member(db, channel_id: int, user_id: int, user_name: str = None):
    if not await _is_member(db, channel_id, user_id):
        db.add(ChatChannelMember(channel_id=channel_id, user_id=user_id, user_name=user_name))
        await db.flush()


async def _ensure_general(db, user_id: int, user_name: str):
    """Гарантировать наличие общего канала и членство в нём текущего пользователя."""
    ch = (await db.execute(
        select(ChatChannel).where(ChatChannel.kind == "group",
                                  ChatChannel.name == GENERAL_CHANNEL_NAME)
    )).scalar_one_or_none()
    if not ch:
        ch = ChatChannel(kind="group", name=GENERAL_CHANNEL_NAME, created_by=user_id)
        db.add(ch)
        await db.flush()
    await _ensure_member(db, ch.id, user_id, user_name)
    return ch


async def _channel_payload(db, ch: ChatChannel, user_id: int) -> dict:
    """Сериализовать канал для текущего пользователя (непрочитанные, последнее сообщение, имя)."""
    member = (await db.execute(
        select(ChatChannelMember).where(
            ChatChannelMember.channel_id == ch.id,
            ChatChannelMember.user_id == user_id,
        )
    )).scalar_one_or_none()
    last_read = (member.last_read_message_id if member else 0) or 0

    unread = (await db.execute(text("""
        SELECT COUNT(*) FROM chat_messages
        WHERE channel_id=:cid AND id > :lr AND is_deleted=false AND user_id != :uid
    """), {"cid": ch.id, "lr": last_read, "uid": user_id})).scalar() or 0

    last_msg = (await db.execute(text("""
        SELECT text, user_name, created_at FROM chat_messages
        WHERE channel_id=:cid AND is_deleted=false ORDER BY id DESC LIMIT 1
    """), {"cid": ch.id})).mappings().one_or_none()

    members = (await db.execute(
        select(ChatChannelMember).where(ChatChannelMember.channel_id == ch.id)
    )).scalars().all()

    # Имя для отображения: direct → имя собеседника, иначе name канала
    title = ch.name
    if ch.kind == "direct":
        other = next((m for m in members if m.user_id != user_id), None)
        title = (other.user_name if other else None) or "Личная переписка"

    return {
        "id": ch.id,
        "kind": ch.kind,
        "name": title,
        "order_id": ch.order_id,
        "unread": int(unread),
        "members": [{"user_id": m.user_id, "user_name": m.user_name} for m in members],
        "member_count": len(members),
        "last_message": (last_msg["text"] if last_msg else None),
        "last_message_author": (last_msg["user_name"] if last_msg else None),
        "last_message_at": (last_msg["created_at"].isoformat() if last_msg and last_msg["created_at"] else None),
        "updated_at": ch.updated_at.isoformat() if ch.updated_at else None,
    }


# ── Каналы ────────────────────────────────────────────────────────────────────

@router.get("/chat/channels")
async def list_channels(request: Request):
    u = _user(request)
    db = _db(request)
    await _ensure_general(db, u.id, _uname(u))
    channels = (await db.execute(
        select(ChatChannel)
        .join(ChatChannelMember, ChatChannelMember.channel_id == ChatChannel.id)
        .where(ChatChannelMember.user_id == u.id, ChatChannel.is_archived == False)
    )).scalars().all()
    out = [await _channel_payload(db, ch, u.id) for ch in channels]
    out.sort(key=lambda c: (c["last_message_at"] or c["updated_at"] or ""), reverse=True)
    await db.commit()
    return out


@router.get("/chat/unread")
async def total_unread(request: Request):
    u = _user(request)
    db = _db(request)
    total = (await db.execute(text("""
        SELECT COALESCE(SUM(cnt), 0) FROM (
            SELECT (
                SELECT COUNT(*) FROM chat_messages msg
                WHERE msg.channel_id = m.channel_id
                  AND msg.id > COALESCE(m.last_read_message_id, 0)
                  AND msg.is_deleted = false AND msg.user_id != :uid
            ) AS cnt
            FROM chat_channel_members m
            JOIN chat_channels c ON c.id = m.channel_id
            WHERE m.user_id = :uid AND c.is_archived = false
        ) s
    """), {"uid": u.id})).scalar() or 0
    return {"unread": int(total)}


class CreateChannelRequest(BaseModel):
    name: str
    member_ids: Optional[list[int]] = None


@router.post("/chat/channels", status_code=201)
async def create_channel(body: CreateChannelRequest, request: Request):
    u = _user(request)
    db = _db(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Укажите название канала")
    ch = ChatChannel(kind="group", name=name, created_by=u.id)
    db.add(ch)
    await db.flush()
    await _ensure_member(db, ch.id, u.id, _uname(u))
    for uid in set(body.member_ids or []):
        if uid == u.id:
            continue
        name_row = (await db.execute(text(
            "SELECT COALESCE(full_name, username) FROM users WHERE id=:id"
        ), {"id": uid})).scalar_one_or_none()
        await _ensure_member(db, ch.id, uid, name_row or str(uid))
    payload = await _channel_payload(db, ch, u.id)
    await db.commit()
    return payload


class DirectRequest(BaseModel):
    user_id: int


@router.post("/chat/channels/direct")
async def open_direct(body: DirectRequest, request: Request):
    """Получить/создать личный канал между текущим пользователем и user_id."""
    u = _user(request)
    db = _db(request)
    if body.user_id == u.id:
        raise HTTPException(400, "Нельзя открыть переписку с самим собой")
    # Ищем существующий direct-канал, где оба — участники
    existing = (await db.execute(text("""
        SELECT c.id FROM chat_channels c
        JOIN chat_channel_members m1 ON m1.channel_id=c.id AND m1.user_id=:a
        JOIN chat_channel_members m2 ON m2.channel_id=c.id AND m2.user_id=:b
        WHERE c.kind='direct' LIMIT 1
    """), {"a": u.id, "b": body.user_id})).scalar_one_or_none()
    if existing:
        ch = (await db.execute(select(ChatChannel).where(ChatChannel.id == existing))).scalar_one()
    else:
        other_name = (await db.execute(text(
            "SELECT COALESCE(full_name, username) FROM users WHERE id=:id"
        ), {"id": body.user_id})).scalar_one_or_none()
        if other_name is None:
            raise HTTPException(404, "Пользователь не найден")
        ch = ChatChannel(kind="direct", name=None, created_by=u.id)
        db.add(ch)
        await db.flush()
        await _ensure_member(db, ch.id, u.id, _uname(u))
        await _ensure_member(db, ch.id, body.user_id, other_name)
    payload = await _channel_payload(db, ch, u.id)
    await db.commit()
    return payload


@router.get("/chat/order/{order_id}")
async def open_order_channel(order_id: int, request: Request):
    """Получить/создать канал обсуждения заказа и вступить в него."""
    u = _user(request)
    db = _db(request)
    order = (await db.execute(text(
        "SELECT product_name FROM orders WHERE id=:id"
    ), {"id": order_id})).mappings().one_or_none()
    if not order:
        raise HTTPException(404, "Заказ не найден")
    ch = (await db.execute(
        select(ChatChannel).where(ChatChannel.kind == "order", ChatChannel.order_id == order_id)
    )).scalar_one_or_none()
    if not ch:
        ch = ChatChannel(kind="order", order_id=order_id, created_by=u.id,
                         name=f"Заказ №{order_id} · {order['product_name']}")
        db.add(ch)
        await db.flush()
    await _ensure_member(db, ch.id, u.id, _uname(u))
    payload = await _channel_payload(db, ch, u.id)
    await db.commit()
    return payload


class AddMembersRequest(BaseModel):
    member_ids: list[int]


@router.post("/chat/channels/{channel_id}/members")
async def add_members(channel_id: int, body: AddMembersRequest, request: Request):
    u = _user(request)
    db = _db(request)
    if not await _is_member(db, channel_id, u.id) and u.role != "admin":
        raise HTTPException(403, "Вы не участник канала")
    for uid in set(body.member_ids or []):
        name_row = (await db.execute(text(
            "SELECT COALESCE(full_name, username) FROM users WHERE id=:id"
        ), {"id": uid})).scalar_one_or_none()
        if name_row is not None:
            await _ensure_member(db, channel_id, uid, name_row)
    ch = (await db.execute(select(ChatChannel).where(ChatChannel.id == channel_id))).scalar_one()
    payload = await _channel_payload(db, ch, u.id)
    await db.commit()
    return payload


# ── Сообщения ─────────────────────────────────────────────────────────────────

@router.get("/chat/channels/{channel_id}/messages")
async def list_messages(channel_id: int, request: Request,
                        after_id: int = 0, before_id: Optional[int] = None,
                        limit: int = 50):
    u = _user(request)
    db = _db(request)
    if not await _is_member(db, channel_id, u.id) and u.role != "admin":
        raise HTTPException(403, "Вы не участник канала")
    limit = max(1, min(limit, 200))
    if after_id:
        # Новые сообщения (для polling) — по возрастанию
        rows = (await db.execute(text("""
            SELECT id, channel_id, user_id, user_name, text, reply_to, is_deleted, created_at, edited_at
            FROM chat_messages WHERE channel_id=:cid AND id > :aid
            ORDER BY id ASC LIMIT :lim
        """), {"cid": channel_id, "aid": after_id, "lim": limit})).mappings().all()
    elif before_id:
        # История вверх — берём по убыванию и разворачиваем
        rows = (await db.execute(text("""
            SELECT id, channel_id, user_id, user_name, text, reply_to, is_deleted, created_at, edited_at
            FROM chat_messages WHERE channel_id=:cid AND id < :bid
            ORDER BY id DESC LIMIT :lim
        """), {"cid": channel_id, "bid": before_id, "lim": limit})).mappings().all()
        rows = list(reversed(rows))
    else:
        rows = (await db.execute(text("""
            SELECT id, channel_id, user_id, user_name, text, reply_to, is_deleted, created_at, edited_at
            FROM chat_messages WHERE channel_id=:cid
            ORDER BY id DESC LIMIT :lim
        """), {"cid": channel_id, "lim": limit})).mappings().all()
        rows = list(reversed(rows))
    out = []
    for r in rows:
        d = dict(r)
        d["text"] = "" if d["is_deleted"] else d["text"]
        d["created_at"] = d["created_at"].isoformat() if d["created_at"] else None
        d["edited_at"] = d["edited_at"].isoformat() if d["edited_at"] else None
        out.append(d)
    return out


class SendMessageRequest(BaseModel):
    text: str
    reply_to: Optional[int] = None


async def _notify_mentions(db, text_body: str, channel_id: int, author_id: int, author_name: str,
                           already=None):
    """Уведомить упомянутых @username (если они участники канала). `already` — id,
    кому уже ушло общее уведомление о сообщении (чтобы не слать дубль)."""
    names = set(_MENTION_RE.findall(text_body or ""))
    if not names:
        return
    skip = {int(x) for x in (already or set())}
    for nm in names:
        uid = (await db.execute(text(
            "SELECT id FROM users WHERE LOWER(username)=LOWER(:n) OR LOWER(full_name)=LOWER(:n) LIMIT 1"
        ), {"n": nm})).scalar_one_or_none()
        if uid and uid != author_id and uid not in skip and await _is_member(db, channel_id, uid):
            await notify_user(db, str(uid), f"{author_name} упомянул вас в чате",
                              text_body[:140], link="/chat", type_="info")


@router.post("/chat/channels/{channel_id}/messages", status_code=201)
async def send_message(channel_id: int, body: SendMessageRequest, request: Request):
    u = _user(request)
    db = _db(request)
    txt = (body.text or "").strip()
    if not txt:
        raise HTTPException(400, "Пустое сообщение")
    if len(txt) > 5000:
        raise HTTPException(400, "Сообщение слишком длинное")
    ch = (await db.execute(select(ChatChannel).where(ChatChannel.id == channel_id))).scalar_one_or_none()
    if not ch:
        raise HTTPException(404, "Канал не найден")
    if not await _is_member(db, channel_id, u.id):
        # для order/group авто-вступление, для direct — запрет
        if ch.kind == "direct":
            raise HTTPException(403, "Вы не участник переписки")
        await _ensure_member(db, channel_id, u.id, _uname(u))

    msg = ChatMessage(channel_id=channel_id, user_id=u.id, user_name=_uname(u),
                      text=txt, reply_to=body.reply_to)
    db.add(msg)
    await db.flush()
    # автор сразу «прочитал» своё сообщение
    await db.execute(text("""
        UPDATE chat_channel_members SET last_read_message_id=:mid
        WHERE channel_id=:cid AND user_id=:uid
    """), {"mid": msg.id, "cid": channel_id, "uid": u.id})
    await db.execute(text("UPDATE chat_channels SET updated_at=NOW() WHERE id=:id"), {"id": channel_id})

    # Уведомления остальным участникам (без замьюченных) + упоминания
    others = (await db.execute(text("""
        SELECT user_id FROM chat_channel_members
        WHERE channel_id=:cid AND user_id != :uid AND COALESCE(is_muted, false) = false
    """), {"cid": channel_id, "uid": u.id})).scalars().all()
    title = f"{_uname(u)}" + (f" · {ch.name}" if ch.kind != "direct" and ch.name else "")
    for uid in others:
        await notify_user(db, str(uid), f"Новое сообщение от {title}",
                          txt[:140], link="/chat", type_="info")
    # Упомянутым шлём отдельное уведомление, но НЕ дублируем тем, кто уже получил общее.
    await _notify_mentions(db, txt, channel_id, u.id, _uname(u), already=set(others))

    await db.commit()
    return {
        "id": msg.id, "channel_id": channel_id, "user_id": u.id,
        "user_name": _uname(u), "text": txt, "reply_to": body.reply_to,
        "is_deleted": False,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
        "edited_at": None,
    }


class ReadRequest(BaseModel):
    last_message_id: int


@router.post("/chat/channels/{channel_id}/read")
async def mark_read(channel_id: int, body: ReadRequest, request: Request):
    u = _user(request)
    db = _db(request)
    # Ограничиваем переданный id реальным максимумом сообщений канала: иначе клиент
    # мог бы «прочитать наперёд» (last_read > всех будущих id) и навсегда скрыть непрочитанные.
    await db.execute(text("""
        UPDATE chat_channel_members
        SET last_read_message_id = GREATEST(
            COALESCE(last_read_message_id, 0),
            LEAST(:mid, (SELECT COALESCE(MAX(id), 0) FROM chat_messages WHERE channel_id=:cid)))
        WHERE channel_id=:cid AND user_id=:uid
    """), {"mid": body.last_message_id, "cid": channel_id, "uid": u.id})
    await db.commit()
    return {"ok": True}


@router.delete("/chat/messages/{message_id}")
async def delete_message(message_id: int, request: Request):
    u = _user(request)
    db = _db(request)
    msg = (await db.execute(select(ChatMessage).where(ChatMessage.id == message_id))).scalar_one_or_none()
    if not msg:
        raise HTTPException(404, "Сообщение не найдено")
    if msg.user_id != u.id and u.role not in ("admin", "manager"):
        raise HTTPException(403, "Можно удалять только свои сообщения")
    msg.is_deleted = True
    await db.commit()
    return {"ok": True}
