from typing import Optional, Any

from pydantic import BaseModel, Field, model_validator


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
    has_cookie: bool = False
    has_access_token: bool = False
    has_threads_user_id: bool = False
    has_proxy: bool = False
    status: str
    daily_limit: int
    hourly_limit: int
    daily_usage_count: int
    hourly_usage_count: int
    last_activity: Optional[str] = None
    health_score: int
    error_message: Optional[str] = None
    created_at: str

    @model_validator(mode="before")
    @classmethod
    def populate_computed_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            cookie_val = data.get("cookie")
            data["has_cookie"] = bool(cookie_val and len(str(cookie_val).strip()) > 0)
            
            token_val = data.get("access_token")
            data["has_access_token"] = bool(token_val and len(str(token_val).strip()) > 0)
            
            uid_val = data.get("threads_user_id")
            data["has_threads_user_id"] = bool(uid_val and len(str(uid_val).strip()) > 0)
            
            proxy_val = data.get("proxy")
            data["has_proxy"] = bool(proxy_val and len(str(proxy_val).strip()) > 0)
        return data
