from fastapi import APIRouter, Depends
from bson import ObjectId
from datetime import datetime
from typing import Dict, Any, List

from app.db.database import get_db
from app.schemas import DashboardMetrics, AuditLogOut, serialize_docs
from app.api.routes.auth import get_current_user, require_roles
from app.services.queue_service import queue_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/metrics", response_model=DashboardMetrics)
async def get_dashboard_metrics(
    current_user: dict = Depends(require_roles(["ADMIN", "OPERATOR", "VIEWER"]))
):
    db = get_db()
    
    # 1. Total Campaigns
    total_campaigns = await db.campaigns.count_documents({})
    
    # 2. Campaign Distribution by status
    campaign_distribution = {}
    cursor_dist = db.campaigns.aggregate([
        {"$group": {"_id": "$status", "count": {"$sum": 1}}}
    ])
    async for item in cursor_dist:
        campaign_distribution[item["_id"]] = item["count"]
        
    # Standardize statuses
    for status_name in ["DRAFT", "READY", "RUNNING", "PAUSED", "COMPLETED", "FAILED", "ARCHIVED"]:
        if status_name not in campaign_distribution:
            campaign_distribution[status_name] = 0
            
    # 3. Active accounts count
    active_accounts = await db.accounts.count_documents({"status": "ACTIVE"})
    
    # 4. Jobs counts
    total_success_jobs = await db.jobs.count_documents({"status": "SUCCESS"})
    total_failed_jobs = await db.jobs.count_documents({"status": "FAILED"})
    total_jobs = await db.jobs.count_documents({})
    
    success_rate = 0.0
    if total_jobs > 0:
        # success rate of finished jobs
        finished_jobs = total_success_jobs + total_failed_jobs
        if finished_jobs > 0:
            success_rate = round((total_success_jobs / finished_jobs) * 100, 2)
            
    # 5. Queue Size from Redis
    queue_size = await queue_service.get_queue_size()
    
    # 6. Average processing time
    # completed_at - started_at for SUCCESS jobs
    avg_processing_time = 0.0
    pipeline = [
        {"$match": {"status": "SUCCESS", "started_at": {"$ne": None}, "completed_at": {"$ne": None}}},
        {"$project": {
            "duration": {"$divide": [{"$subtract": ["$completed_at", "$started_at"]}, 1000]} # duration in seconds
        }},
        {"$group": {
            "_id": None,
            "avg_duration": {"$avg": "$duration"}
        }}
    ]
    cursor_avg = db.jobs.aggregate(pipeline)
    avg_results = await cursor_avg.to_list(length=1)
    if avg_results:
        avg_processing_time = round(avg_results[0]["avg_duration"], 2)
        
    # 7. Recent jobs (last 10 jobs)
    recent_jobs_pipeline = [
        {"$sort": {"created_at": -1}},
        {"$limit": 10},
        {"$lookup": {
            "from": "accounts",
            "localField": "account_id",
            "foreignField": "_id",
            "as": "account"
        }},
        {"$lookup": {
            "from": "target_urls",
            "localField": "url_id",
            "foreignField": "_id",
            "as": "url"
        }},
        {"$lookup": {
            "from": "comment_templates",
            "localField": "template_id",
            "foreignField": "_id",
            "as": "template"
        }},
        {"$unwind": {"path": "$account", "preserveNullAndEmptyArrays": True}},
        {"$unwind": {"path": "$url", "preserveNullAndEmptyArrays": True}},
        {"$unwind": {"path": "$template", "preserveNullAndEmptyArrays": True}},
        {"$project": {
            "_id": 1,
            "campaign_id": 1,
            "account_id": 1,
            "url_id": 1,
            "template_id": 1,
            "status": 1,
            "attempt_count": 1,
            "scheduled_time": 1,
            "started_at": 1,
            "completed_at": 1,
            "error_message": 1,
            "account_username": "$account.username",
            "target_url": "$url.url",
            "template_content": "$template.content"
        }}
    ]
    cursor_recent = db.jobs.aggregate(recent_jobs_pipeline)
    recent_jobs = await cursor_recent.to_list(length=10)
    
    return {
        "total_campaigns": total_campaigns,
        "success_rate": success_rate,
        "failed_jobs": total_failed_jobs,
        "active_accounts": active_accounts,
        "queue_size": queue_size,
        "avg_processing_time": avg_processing_time,
        "recent_jobs": serialize_docs(recent_jobs),
        "campaign_distribution": campaign_distribution
    }

@router.get("/audit", response_model=List[AuditLogOut])
async def get_audit_logs(
    current_user: dict = Depends(require_roles(["ADMIN", "OPERATOR", "VIEWER"]))
):
    db = get_db()
    cursor = db.audit_logs.find({}).sort("created_at", -1).limit(100)
    logs = await cursor.to_list(length=100)
    return serialize_docs(logs)
