from typing import Dict, List

from pydantic import BaseModel

from app.schemas.jobs import JobOut


class DashboardMetrics(BaseModel):
    total_campaigns: int
    success_rate: float
    failed_jobs: int
    active_accounts: int
    queue_size: int
    avg_processing_time: float
    recent_jobs: List[JobOut]
    campaign_distribution: Dict[str, int]
