from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func
from datetime import datetime
import secrets

from app.models.user import User
from app.schemas.auth import UserCreate, UserUpdate, ApproveRegistrationRequest
from app.services.permissions import (
    build_default_permissions, restrict_permissions,
    resolve_permissions, ALLOWED_ROLES, PRODUCTION_ROLES,
)
from shared.core.security import hash_password, verify_password


async def _sync_operator(db: AsyncSession, user: "User"):
    """Create/update operator record when user has a production role."""
    from sqlalchemy import text
    name = (user.full_name or user.username).strip()
    emp_id = str(user.id)
    if user.role in PRODUCTION_ROLES and user.is_active:
        await db.execute(text("""
            INSERT INTO operators (employee_id, name, role)
            VALUES (:eid, :name, :role)
            ON CONFLICT (employee_id) DO UPDATE SET name=:name, role=:role
        """), {"eid": emp_id, "name": name, "role": user.role})
    else:
        # deactivate: keep record but mark role as inactive
        await db.execute(text("""
            UPDATE operators SET role=:role WHERE employee_id=:eid
        """), {"eid": emp_id, "role": user.role})


async def get_user_by_username(db: AsyncSession, username: str) -> Optional[User]:
    result = await db.execute(select(User).where(func.lower(User.username) == username.lower()))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: int) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(func.lower(User.email) == email.lower()))
    return result.scalar_one_or_none()


def _enrich_user(user: User) -> User:
    deps = user.departments_access if isinstance(user.departments_access, list) else []
    user.departments_access = deps
    user.user_permissions = resolve_permissions(user.role, deps, user.user_permissions)
    return user


async def authenticate_user(db: AsyncSession, username: str, password: str) -> Optional[User]:
    user = await get_user_by_username(db, username)
    if not user:
        return None
    if not verify_password(password, user.password_hash):
        return None
    await db.execute(update(User).where(User.id == user.id).values(last_login=datetime.utcnow()))
    await db.commit()
    return _enrich_user(user)


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    if data.role not in ALLOWED_ROLES:
        raise ValueError(f"Недопустимая роль. Разрешены: {', '.join(ALLOWED_ROLES)}")
    existing = await get_user_by_username(db, data.username)
    if existing:
        raise ValueError("Пользователь с таким логином уже существует")
    deps = data.departments_access or []
    perms = restrict_permissions(data.role, deps, data.user_permissions)
    if not perms:
        perms = build_default_permissions(data.role, deps)
    user = User(
        username=data.username.lower(),
        password_hash=hash_password(data.password),
        full_name=data.full_name or data.username,
        role=data.role,
        is_active=True,
        departments_access=deps,
        user_permissions=perms,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    await _sync_operator(db, user)
    await db.commit()
    return _enrich_user(user)


async def update_user(db: AsyncSession, user_id: int, data: UserUpdate) -> User:
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("Пользователь не найден")

    values: dict = {}
    if data.username is not None:
        existing = await db.execute(
            select(User).where(func.lower(User.username) == data.username.lower(), User.id != user_id)
        )
        if existing.scalar_one_or_none():
            raise ValueError("Пользователь с таким логином уже существует")
        values["username"] = data.username.lower()
    if data.email is not None:
        values["email"] = data.email.lower()
    if data.full_name is not None:
        values["full_name"] = data.full_name
    if data.role is not None:
        if data.role not in ALLOWED_ROLES:
            raise ValueError(f"Недопустимая роль. Разрешены: {', '.join(ALLOWED_ROLES)}")
        values["role"] = data.role
        values["operator_function"] = None
    if data.is_active is not None:
        values["is_active"] = data.is_active
    if data.departments_access is not None:
        values["departments_access"] = data.departments_access
    if data.password:
        if len(data.password) < 6:
            raise ValueError("Пароль должен быть не менее 6 символов")
        values["password_hash"] = hash_password(data.password)

    effective_role = data.role if data.role is not None else user.role
    effective_deps = data.departments_access if data.departments_access is not None else (user.departments_access or [])

    if data.user_permissions is not None:
        values["user_permissions"] = restrict_permissions(effective_role, effective_deps, data.user_permissions)
    elif data.role is not None or data.departments_access is not None:
        values["user_permissions"] = build_default_permissions(effective_role, effective_deps)

    if values:
        values["updated_at"] = datetime.utcnow()
        await db.execute(update(User).where(User.id == user_id).values(**values))
        await db.commit()

    user = await get_user_by_id(db, user_id)
    await _sync_operator(db, user)
    await db.commit()
    return _enrich_user(user)


async def delete_user(db: AsyncSession, user_id: int, current_user_id: int) -> dict:
    if user_id == current_user_id:
        raise ValueError("Нельзя удалить самого себя")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    try:
        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
        return {"success": True, "message": "Пользователь успешно удалён"}
    except Exception as e:
        await db.rollback()
        if "23503" in str(e):
            archived = f"deleted_{user_id}_{int(datetime.utcnow().timestamp())}"
            await db.execute(
                update(User).where(User.id == user_id).values(
                    is_active=False, username=archived,
                    full_name=(user.full_name or user.username) + " (удален)",
                    updated_at=datetime.utcnow(),
                )
            )
            await db.commit()
            return {"success": True, "soft_deleted": True, "message": "Пользователь деактивирован (мягкое удаление)"}
        raise


async def change_password(db: AsyncSession, user_id: int, old_password: str, new_password: str):
    if len(new_password) < 6:
        raise ValueError("Новый пароль должен быть не менее 6 символов")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    if not verify_password(old_password, user.password_hash):
        raise ValueError("Неверный старый пароль")
    await db.execute(
        update(User).where(User.id == user_id).values(
            password_hash=hash_password(new_password), updated_at=datetime.utcnow()
        )
    )
    await db.commit()


async def admin_reset_password(db: AsyncSession, user_id: int, new_password: str):
    if len(new_password) < 6:
        raise ValueError("Пароль должен быть не менее 6 символов")
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("Пользователь не найден")
    await db.execute(
        update(User).where(User.id == user_id).values(
            password_hash=hash_password(new_password), updated_at=datetime.utcnow()
        )
    )
    await db.commit()


async def request_password_reset(db: AsyncSession, email: str) -> Optional[str]:
    user = await get_user_by_email(db, email)
    if not user:
        return None
    token = secrets.token_hex(32)
    from datetime import timedelta
    expires = datetime.utcnow() + timedelta(hours=1)
    await db.execute(
        update(User).where(User.id == user.id).values(
            password_reset_token=token, password_reset_expires=expires
        )
    )
    await db.commit()
    return token


async def reset_password_by_token(db: AsyncSession, token: str, new_password: str):
    if len(new_password) < 6:
        raise ValueError("Пароль должен быть не менее 6 символов")
    result = await db.execute(
        select(User).where(
            User.password_reset_token == token,
            User.password_reset_expires > datetime.utcnow(),
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise ValueError("Недействительный или истекший токен")
    await db.execute(
        update(User).where(User.id == user.id).values(
            password_hash=hash_password(new_password),
            password_reset_token=None,
            password_reset_expires=None,
            updated_at=datetime.utcnow(),
        )
    )
    await db.commit()


async def approve_registration(db: AsyncSession, user_id: int, data: ApproveRegistrationRequest):
    user = await db.execute(
        select(User).where(User.id == user_id, User.is_active == False)
    )
    user = user.scalar_one_or_none()
    if not user:
        raise ValueError("Заявка не найдена или уже обработана")

    deps = data.departments_access or []
    if data.operator_function and not deps:
        defaults = {
            "operator_otk": ["otk", "my-orders"],
            "operator_smd": ["production", "my-orders"],
            "operator_sborka": ["production", "my-orders"],
        }
        deps = defaults.get(data.operator_function, ["my-orders"])

    role = data.operator_function or "user"
    perms = build_default_permissions(role, deps)

    await db.execute(
        update(User).where(User.id == user_id).values(
            is_active=True, role=role, operator_function=data.operator_function,
            departments_access=deps, user_permissions=perms, updated_at=datetime.utcnow(),
        )
    )
    await db.commit()


async def reject_registration(db: AsyncSession, user_id: int):
    result = await db.execute(
        delete(User).where(User.id == user_id, User.is_active == False).returning(User.id)
    )
    if not result.scalar_one_or_none():
        raise ValueError("Заявка не найдена или уже обработана")
    await db.commit()
