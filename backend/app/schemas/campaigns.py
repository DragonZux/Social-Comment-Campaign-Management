from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class CampaignCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    platform: str = Field(..., pattern="^(X|Threads)$")
    description: Optional[str] = ""
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(DRAFT|READY|RUNNING|PAUSED|COMPLETED|FAILED|ARCHIVED)$")
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class CampaignOut(BaseModel):
    id: str
    name: str
    platform: str
    description: str
    status: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    created_by: str
    created_at: str


class TargetURLCreate(BaseModel):
    url: str


class TargetURLImport(BaseModel):
    urls: List[str]


class TargetURLOut(BaseModel):
    id: str
    campaign_id: str
    url: str
    platform: str
    status: str
    processed_at: Optional[str] = None
    error_message: Optional[str] = None


class CommentTemplateCreate(BaseModel):
    content: str = Field(..., min_length=1)
    category: Optional[str] = "General"
    language: Optional[str] = "vi"
    priority: Optional[str] = Field(default="MEDIUM", pattern="^(HIGH|MEDIUM|LOW)$")


class CommentTemplateImport(BaseModel):
    templates: List[str]


class CommentTemplateOut(BaseModel):
    id: str
    campaign_id: str
    content: str
    category: str
    language: str
    priority: str
    status: str
