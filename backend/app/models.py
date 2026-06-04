from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# MongoDB document serialization helper
def serialize_doc(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if doc is None:
        return None
    new_doc = {}
    for k, v in doc.items():
        if k == "_id":
            new_doc["id"] = str(v)
        elif isinstance(v, datetime):
            new_doc[k] = v.isoformat()
        elif isinstance(v, dict):
            new_doc[k] = serialize_doc(v)
        elif isinstance(v, list):
            new_doc[k] = [serialize_doc(item) if isinstance(item, dict) else str(item) if k.endswith("_id") or k == "ids" else item for item in v]
        elif k.endswith("_id") or k == "user_id":
            new_doc[k] = str(v)
        else:
            new_doc[k] = v
    return new_doc

def serialize_docs(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [serialize_doc(d) for d in docs]

# --- USER SCHEMAS ---
class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)
    role: str = Field(default="OPERATOR", pattern="^(ADMIN|OPERATOR|VIEWER)$")

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    username: str

# --- SOCIAL ACCOUNT SCHEMAS ---
class AccountCreate(BaseModel):
    platform: str = Field(..., pattern="^(X|Threads)$")
    username: str = Field(..., min_length=1)
    display_name: Optional[str] = None
    daily_limit: int = Field(default=50, ge=1)
    hourly_limit: int = Field(default=5, ge=1)

class AccountUpdate(BaseModel):
    display_name: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(ACTIVE|PAUSED|LIMITED|DISABLED|ERROR)$")
    daily_limit: Optional[int] = Field(None, ge=1)
    hourly_limit: Optional[int] = Field(None, ge=1)
    health_score: Optional[int] = Field(None, ge=0, le=100)

class AccountOut(BaseModel):
    id: str
    platform: str
    username: str
    display_name: Optional[str] = None
    status: str
    daily_limit: int
    hourly_limit: int
    daily_usage_count: int
    hourly_usage_count: int
    last_activity: Optional[str] = None
    health_score: int
    created_at: str

# --- CAMPAIGN SCHEMAS ---
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

# --- TARGET URL SCHEMAS ---
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

# --- COMMENT TEMPLATE SCHEMAS ---
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

# --- JOB SCHEMAS ---
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
    
    # Extra fields for details
    account_username: Optional[str] = None
    target_url: Optional[str] = None
    template_content: Optional[str] = None

# --- AUDIT LOG SCHEMA ---
class AuditLogOut(BaseModel):
    id: str
    user_id: Optional[str] = None
    username: Optional[str] = None
    action: str
    resource_type: str
    resource_id: Optional[str] = None
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    created_at: str

# --- DASHBOARD METRICS SCHEMA ---
class DashboardMetrics(BaseModel):
    total_campaigns: int
    success_rate: float
    failed_jobs: int
    active_accounts: int
    queue_size: int
    avg_processing_time: float
    recent_jobs: List[JobOut]
    campaign_distribution: Dict[str, int]
