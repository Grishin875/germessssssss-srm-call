from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from app.schemas.auth import (
    LoginRequest, ChangePasswordRequest, AdminResetPasswordRequest,
    ResetPasswordRequest, RequestPasswordResetRequest,
    UserCreate, UserUpdate, UserOut, TokenResponse, ApproveRegistrationRequest,
)
from app.services import user_service
from app.models.user import User
from app.core.config import settings
from shared.core.security import create_access_token

router = APIRouter()


def _get_db(request: Request) -> AsyncSession:
    return request.state.db


def _get_user(request: Request) -> User:
    user = request.state.current_user
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return user


# ── Public ──────────────────────────────────────────────────────────────────

@router.post("/register", status_code=403)
async def register():
    raise HTTPException(status_code=403, detail="Регистрация отключена. Обратитесь к администратору.")


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request):
    db = _get_db(request)
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="Логин и пароль обязательны")
    user = await user_service.authenticate_user(db, body.username, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Аккаунт не активирован. Обратитесь к администратору.")
    token = create_access_token({"id": user.id, "username": user.username, "role": user.role}, settings.JWT_SECRET)
    return {"success": True, "token": token, "user": user}


@router.post("/request-password-reset")
async def request_password_reset(body: RequestPasswordResetRequest, request: Request):
    db = _get_db(request)
    token = await user_service.request_password_reset(db, body.email)
    resp = {"success": True, "message": "Если пользователь с таким email существует, инструкция отправлена."}
    # Токен отдаём в ответе ТОЛЬКО при явно включённом EXPOSE_RESET_TOKEN
    # (по умолчанию off) — иначе это позволяло бы захватить любой аккаунт.
    if token and settings.EXPOSE_RESET_TOKEN:
        resp["resetToken"] = token
    return resp


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, request: Request):
    db = _get_db(request)
    try:
        await user_service.reset_password_by_token(db, body.token, body.newPassword)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "message": "Пароль успешно изменён"}


# ── Authenticated ────────────────────────────────────────────────────────────

@router.get("/me", response_model=UserOut)
async def me(request: Request):
    return _get_user(request)


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, request: Request):
    db, user = _get_db(request), _get_user(request)
    try:
        await user_service.change_password(db, user.id, body.oldPassword, body.newPassword)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "message": "Пароль успешно изменён"}


@router.post("/admin/reset-password")
async def admin_reset_password(body: AdminResetPasswordRequest, request: Request):
    user = _get_user(request)
    if user.role not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    db = _get_db(request)
    try:
        await user_service.admin_reset_password(db, body.user_id, body.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "message": f"Пароль для пользователя ID={body.user_id} изменён"}


# ── Users (admin) ────────────────────────────────────────────────────────────

@router.get("/users", response_model=List[UserOut])
async def list_users(request: Request, include_inactive: str = "0"):
    # Любой авторизованный пользователь может получить СПРАВОЧНИК людей — он нужен
    # для чата (участники/ЛС), назначения руководителей заказа и @упоминаний.
    # Полное управление (create/update/delete) и карты прав остаются только у admin.
    user = _get_user(request)
    is_admin = user.role == "admin"
    db = _get_db(request)
    from sqlalchemy import select
    from app.models.user import User as UserModel
    from app.services.permissions import resolve_permissions
    q = select(UserModel)
    # Не-админ видит только активных; include_inactive работает лишь для admin.
    if not is_admin or include_inactive not in ("1", "true"):
        q = q.where(UserModel.is_active == True)
    q = q.order_by(UserModel.is_active.desc(), UserModel.created_at.desc())
    result = await db.execute(q)
    users = result.scalars().all()
    for u in users:
        deps = u.departments_access if isinstance(u.departments_access, list) else []
        if is_admin:
            u.departments_access = deps
            u.user_permissions = resolve_permissions(u.role, deps, u.user_permissions)
        else:
            # Не-админам отдаём только справочные поля (id/имя/роль/статус),
            # без карт прав и доступов к отделам.
            u.departments_access = []
            u.user_permissions = {}
    return users


@router.post("/users", response_model=UserOut, status_code=201)
async def create_user(body: UserCreate, request: Request):
    user = _get_user(request)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    db = _get_db(request)
    try:
        new_user = await user_service.create_user(db, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return new_user


@router.put("/users/{user_id}", response_model=UserOut)
async def update_user(user_id: int, body: UserUpdate, request: Request):
    user = _get_user(request)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    db = _get_db(request)
    try:
        updated = await user_service.update_user(db, user_id, body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return updated


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, request: Request):
    user = _get_user(request)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    db = _get_db(request)
    try:
        return await user_service.delete_user(db, user_id, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── Pending registrations (admin) ────────────────────────────────────────────

@router.get("/pending-registrations")
async def pending_registrations(request: Request):
    user = _get_user(request)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    db = _get_db(request)
    from sqlalchemy import select
    from app.models.user import User as UserModel
    result = await db.execute(
        select(UserModel).where(UserModel.is_active == False).order_by(UserModel.created_at.desc())
    )
    return result.scalars().all()


@router.post("/approve-registration/{user_id}")
async def approve_registration(user_id: int, body: ApproveRegistrationRequest, request: Request):
    user = _get_user(request)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    db = _get_db(request)
    try:
        await user_service.approve_registration(db, user_id, body)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True, "message": "Регистрация подтверждена"}


@router.post("/reject-registration/{user_id}")
async def reject_registration(user_id: int, request: Request):
    user = _get_user(request)
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    db = _get_db(request)
    try:
        await user_service.reject_registration(db, user_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"success": True, "message": "Регистрация отклонена"}
