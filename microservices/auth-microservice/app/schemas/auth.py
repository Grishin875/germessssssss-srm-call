from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr
from datetime import datetime


class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    oldPassword: str
    newPassword: str


class AdminResetPasswordRequest(BaseModel):
    user_id: int
    new_password: str


class ResetPasswordRequest(BaseModel):
    token: str
    newPassword: str


class RequestPasswordResetRequest(BaseModel):
    email: str


class UserCreate(BaseModel):
    username: str
    password: str
    full_name: Optional[str] = None
    role: str = "user"
    departments_access: List[str] = []
    user_permissions: Optional[Dict[str, Any]] = None


class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    departments_access: Optional[List[str]] = None
    password: Optional[str] = None
    employee_id: Optional[str] = None
    user_permissions: Optional[Dict[str, Any]] = None


class ApproveRegistrationRequest(BaseModel):
    operator_function: Optional[str] = None
    departments_access: Optional[List[str]] = None
    employee_id: Optional[str] = None


class UserOut(BaseModel):
    id: int
    username: str
    full_name: Optional[str]
    role: str
    photo_url: Optional[str]
    departments_access: List[str] = []
    user_permissions: Dict[str, Any] = {}
    is_active: bool
    last_login: Optional[datetime]
    created_at: Optional[datetime]
    email: Optional[str] = None
    phone: Optional[str] = None
    employee_id: Optional[str] = None

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    success: bool
    token: str
    user: UserOut
