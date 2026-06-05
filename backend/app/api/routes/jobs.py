from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime
from typing import List, Optional

from app.db.database import get_db
from app.schemas import JobOut, serialize_doc, serialize_docs
from app.api.routes.auth import get_current_user, write_audit_log
from app.services.queue_service import queue_service

router = APIRouter(prefix="/jobs", tags=["Jobs"])


async def allowed_campaign_ids(current_user: dict):
    db = get_db()
    campaigns = await db.campaigns.find(
        {"owner_id": ObjectId(current_user["id"])},
        {"_id": 1}
    ).to_list(length=1000)
    return [campaign["_id"] for campaign in campaigns]

@router.get("", response_model=List[JobOut])
async def list_jobs(
    campaign_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    match_query = {}
    
    if campaign_id:
        if not ObjectId.is_valid(campaign_id):
            raise HTTPException(status_code=400, detail="Invalid campaign ID")
        match_query["campaign_id"] = ObjectId(campaign_id)
        
    if status:
        match_query["status"] = status

    allowed_ids = await allowed_campaign_ids(current_user)
    if campaign_id:
        campaign_object_id = ObjectId(campaign_id)
        if campaign_object_id not in allowed_ids:
            raise HTTPException(status_code=404, detail="Campaign not found")
    else:
        match_query["campaign_id"] = {"$in": allowed_ids}
        
    pipeline = [
        {"$match": match_query},
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
            "platform": "$url.platform",
            "status": 1,
            "attempt_count": 1,
            "scheduled_time": 1,
            "started_at": 1,
            "completed_at": 1,
            "error_message": 1,
            "real_api": 1,
            "account_username": "$account.username",
            "target_url": "$url.url",
            "template_content": "$template.content"
        }},
        {"$sort": {"scheduled_time": -1}}
    ]
    
    cursor = db.jobs.aggregate(pipeline)
    jobs = await cursor.to_list(length=1000)
    
    # Standard serialization
    return serialize_docs(jobs)

@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: str,
    current_user: dict = Depends(get_current_user)
):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID")
        
    db = get_db()
    
    pipeline = [
        {"$match": {"_id": ObjectId(job_id)}},
        {"$lookup": {
            "from": "campaigns",
            "localField": "campaign_id",
            "foreignField": "_id",
            "as": "campaign"
        }},
        {"$unwind": {"path": "$campaign", "preserveNullAndEmptyArrays": True}},
        {"$match": {"campaign.owner_id": ObjectId(current_user["id"])}},
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
            "platform": "$url.platform",
            "status": 1,
            "attempt_count": 1,
            "scheduled_time": 1,
            "started_at": 1,
            "completed_at": 1,
            "error_message": 1,
            "real_api": 1,
            "account_username": "$account.username",
            "target_url": "$url.url",
            "template_content": "$template.content"
        }}
    ]
    
    cursor = db.jobs.aggregate(pipeline)
    results = await cursor.to_list(length=1)
    if not results:
        raise HTTPException(status_code=404, detail="Job not found")
        
    return serialize_doc(results[0])

@router.post("/{job_id}/retry")
async def retry_job(
    job_id: str,
    current_user: dict = Depends(get_current_user)
):
    if not ObjectId.is_valid(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID")
        
    db = get_db()
    job = await db.jobs.find_one({"_id": ObjectId(job_id)})
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    campaign = await db.campaigns.find_one({
        "_id": job["campaign_id"],
        "owner_id": ObjectId(current_user["id"])
    })
    if not campaign:
        raise HTTPException(status_code=404, detail="Job not found")
        
    if job["status"] not in ["FAILED", "CANCELLED"]:
        raise HTTPException(status_code=400, detail="Only FAILED or CANCELLED jobs can be retried")
        
    # Reset job
    await db.jobs.update_one(
        {"_id": ObjectId(job_id)},
        {"$set": {
            "status": "QUEUED",
            "scheduled_time": datetime.utcnow(),
            "started_at": None,
            "completed_at": None,
            "error_message": None
        }}
    )
    
    # Update target URL to PROCESSING
    await db.target_urls.update_one({"_id": job["url_id"]}, {"$set": {"status": "PROCESSING", "error_message": None}})
    
    # Enqueue to Redis
    await queue_service.enqueue_job(job_id)
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "RETRY_JOB", "JOB", job_id
    )
    
    return {"message": "Job enqueued for retry successfully"}

@router.post("/retry-failed-campaign/{campaign_id}")
async def retry_all_failed_campaign_jobs(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    if not ObjectId.is_valid(campaign_id):
        raise HTTPException(status_code=400, detail="Invalid campaign ID")
        
    db = get_db()
    campaign_query = {
        "_id": ObjectId(campaign_id),
        "owner_id": ObjectId(current_user["id"])
    }

    campaign = await db.campaigns.find_one(campaign_query)
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
        
    failed_jobs = await db.jobs.find({"campaign_id": ObjectId(campaign_id), "status": "FAILED"}).to_list(length=1000)
    if not failed_jobs:
        return {"message": "No failed jobs found for this campaign"}
        
    retried_count = 0
    for job in failed_jobs:
        job_id = str(job["_id"])
        await db.jobs.update_one(
            {"_id": job["_id"]},
            {"$set": {
                "status": "QUEUED",
                "scheduled_time": datetime.utcnow(),
                "started_at": None,
                "completed_at": None,
                "error_message": None
            }}
        )
        await db.target_urls.update_one({"_id": job["url_id"]}, {"$set": {"status": "PROCESSING", "error_message": None}})
        await queue_service.enqueue_job(job_id)
        retried_count += 1
        
    await write_audit_log(
        current_user["id"], current_user["username"],
        "RETRY_ALL_FAILED", "CAMPAIGN", campaign_id,
        new_val=f"Retried {retried_count} jobs"
    )
    
    return {"message": f"Successfully enqueued {retried_count} failed jobs for retry"}
