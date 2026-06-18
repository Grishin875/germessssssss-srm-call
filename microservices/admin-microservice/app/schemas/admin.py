from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime


class OperatorCreate(BaseModel):
    name: str
    role: str
    employee_id: str


class OperatorUpdate(OperatorCreate):
    pass


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "normal"
    assigned_operator_id: Optional[str] = None


class ShiftCreate(BaseModel):
    shift_date: str
    shift_type: str
    operator_id: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    department: Optional[str] = None
    comment: Optional[str] = None


class ShiftUpdate(BaseModel):
    shift_date: Optional[str] = None
    shift_type: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    operator_id: Optional[str] = None
    department: Optional[str] = None
    comment: Optional[str] = None
    status: Optional[str] = None
    actual_hours: Optional[float] = None


class ShiftCompleteRequest(BaseModel):
    actual_hours: float
    comment: Optional[str] = None


class BulkShiftsRequest(BaseModel):
    shifts: List[ShiftCreate]


class SuggestionCreate(BaseModel):
    title: str
    description: str
    category: Optional[str] = None


class ChecklistItemCreate(BaseModel):
    title: str
    category: Optional[str] = None
    sort_order: int = 0
