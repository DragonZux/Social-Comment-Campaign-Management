from typing import Optional

from pydantic import BaseModel


class JobOut(BaseModel):
    id: str
    campaign_id: str
    account_id: Optional[str] = None
    url_id: str
    template_id: str
    status: str
    attempt_count: int
    scheduled_time: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None
    account_username: Optional[str] = None
    target_url: Optional[str] = None
    template_content: Optional[str] = None
