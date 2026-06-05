from typing import Optional

from pydantic import BaseModel, Field


class AccountCreate(BaseModel):
    platform: str = Field(..., pattern="^(X|Threads)$")
    username: str = Field(..., min_length=1)
    display_name: Optional[str] = None
    cookie: Optional[str] = None
    access_token: Optional[str] = None
    threads_user_id: Optional[str] = None
    proxy: Optional[str] = None
    daily_limit: int = Field(default=50, ge=1)
    hourly_limit: int = Field(default=5, ge=1)


class AccountUpdate(BaseModel):
    display_name: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(ACTIVE|PAUSED|LIMITED|DISABLED|ERROR)$")
    cookie: Optional[str] = None
    access_token: Optional[str] = None
    threads_user_id: Optional[str] = None
    proxy: Optional[str] = None
    daily_limit: Optional[int] = Field(None, ge=1)
    hourly_limit: Optional[int] = Field(None, ge=1)
    health_score: Optional[int] = Field(None, ge=0, le=100)


class AccountOut(BaseModel):
    id: str
    platform: str
    username: str
    display_name: Optional[str] = None
    cookie: Optional[str] = None
    access_token: Optional[str] = None
    threads_user_id: Optional[str] = None
    proxy: Optional[str] = None
    status: str
    daily_limit: int
    hourly_limit: int
    daily_usage_count: int
    hourly_usage_count: int
    last_activity: Optional[str] = None
    health_score: int
    created_at: str
