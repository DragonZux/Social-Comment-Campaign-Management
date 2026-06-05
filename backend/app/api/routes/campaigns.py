from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime
from typing import List, Optional
import random

from app.db.database import get_db
from app.schemas import (
    CampaignCreate, CampaignUpdate, CampaignOut,
    TargetURLImport, TargetURLOut, CommentTemplateImport, CommentTemplateOut,
    serialize_doc, serialize_docs
)
from app.api.routes.auth import get_current_user, write_audit_log
from app.services.queue_service import queue_service

router = APIRouter(prefix="/campaigns", tags=["Campaigns"])


def campaign_scope(current_user: dict) -> dict:
    return {"owner_id": ObjectId(current_user["id"])}


async def get_campaign_for_user(campaign_id: str, current_user: dict):
    if not ObjectId.is_valid(campaign_id):
        raise HTTPException(status_code=400, detail="Invalid campaign ID")

    db = get_db()
    campaign = await db.campaigns.find_one({"_id": ObjectId(campaign_id), **campaign_scope(current_user)})
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return campaign

@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    campaign_in: CampaignCreate,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign_doc = {
        "name": campaign_in.name,
        "platform": campaign_in.platform,
        "description": campaign_in.description or "",
        "status": "DRAFT",
        "start_time": campaign_in.start_time,
        "end_time": campaign_in.end_time,
        "created_by": current_user["username"],
        "owner_id": ObjectId(current_user["id"]),
        "created_at": datetime.utcnow()
    }
    result = await db.campaigns.insert_one(campaign_doc)
    campaign_doc["_id"] = result.inserted_id
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "CREATE", "CAMPAIGN", str(result.inserted_id),
        new_val=campaign_in.name
    )
    
    return serialize_doc(campaign_doc)

@router.get("", response_model=List[CampaignOut])
async def list_campaigns(
    platform: str = None,
    status: str = None,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    query = {}
    query.update(campaign_scope(current_user))
    if platform:
        query["platform"] = platform
    if status:
        query["status"] = status
        
    cursor = db.campaigns.find(query).sort("created_at", -1)
    campaigns = await cursor.to_list(length=100)
    return serialize_docs(campaigns)

@router.get("/{campaign_id}", response_model=CampaignOut)
async def get_campaign(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    campaign = await get_campaign_for_user(campaign_id, current_user)
    return serialize_doc(campaign)

@router.patch("/{campaign_id}", response_model=CampaignOut)
async def update_campaign(
    campaign_id: str,
    campaign_in: CampaignUpdate,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    update_data = {}
    if campaign_in.name is not None:
        update_data["name"] = campaign_in.name
    if campaign_in.description is not None:
        update_data["description"] = campaign_in.description
    if campaign_in.status is not None:
        update_data["status"] = campaign_in.status
    if campaign_in.start_time is not None:
        update_data["start_time"] = campaign_in.start_time
    if campaign_in.end_time is not None:
        update_data["end_time"] = campaign_in.end_time
        
    if not update_data:
        return serialize_doc(campaign)
        
    await db.campaigns.update_one(
        {"_id": ObjectId(campaign_id)},
        {"$set": update_data}
    )
    
    updated_campaign = await db.campaigns.find_one({"_id": ObjectId(campaign_id)})
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "UPDATE", "CAMPAIGN", campaign_id,
        old_val=campaign["status"],
        new_val=updated_campaign["status"]
    )
    
    return serialize_doc(updated_campaign)

@router.delete("/{campaign_id}")
async def delete_campaign(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    # Delete associated data
    await db.campaigns.delete_one({"_id": ObjectId(campaign_id)})
    await db.target_urls.delete_many({"campaign_id": ObjectId(campaign_id)})
    await db.comment_templates.delete_many({"campaign_id": ObjectId(campaign_id)})
    await db.jobs.delete_many({"campaign_id": ObjectId(campaign_id)})
    
    await write_audit_log(
        current_user["id"], current_user["username"],
        "DELETE", "CAMPAIGN", campaign_id,
        old_val=campaign["name"]
    )
    
    return {"message": "Campaign and all associated data deleted successfully"}

# --- TARGET URLS IMPORT & LIST ---
@router.post("/{campaign_id}/urls/import", response_model=List[TargetURLOut])
async def import_urls(
    campaign_id: str,
    url_import: TargetURLImport,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    inserted_urls = []
    duplicates_count = 0
    
    for url in url_import.urls:
        url = url.strip()
        if not url:
            continue
        # Deduplicate
        existing = await db.target_urls.find_one({"campaign_id": ObjectId(campaign_id), "url": url})
        if existing:
            duplicates_count += 1
            continue
            
        url_doc = {
            "campaign_id": ObjectId(campaign_id),
            "url": url,
            "platform": campaign["platform"],
            "status": "PENDING",
            "processed_at": None,
            "error_message": None,
            "created_at": datetime.utcnow()
        }
        result = await db.target_urls.insert_one(url_doc)
        url_doc["_id"] = result.inserted_id
        inserted_urls.append(serialize_doc(url_doc))
        
    await write_audit_log(
        current_user["id"], current_user["username"],
        "IMPORT_URLS", "CAMPAIGN", campaign_id,
        new_val=f"Imported:{len(inserted_urls)}, Duplicates:{duplicates_count}"
    )
    
    # Refresh campaign status to READY if it was DRAFT and has urls
    if campaign["status"] == "DRAFT" and len(inserted_urls) > 0:
        await db.campaigns.update_one({"_id": ObjectId(campaign_id)}, {"$set": {"status": "READY"}})
        
    return inserted_urls

@router.get("/{campaign_id}/urls", response_model=List[TargetURLOut])
async def list_campaign_urls(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    await get_campaign_for_user(campaign_id, current_user)
    cursor = db.target_urls.find({"campaign_id": ObjectId(campaign_id)}).sort("created_at", 1)
    urls = await cursor.to_list(length=1000)
    return serialize_docs(urls)

# --- COMMENT TEMPLATES IMPORT & LIST ---
@router.post("/{campaign_id}/templates", response_model=List[CommentTemplateOut])
async def import_templates(
    campaign_id: str,
    template_import: CommentTemplateImport,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    inserted_templates = []
    for content in template_import.templates:
        content = content.strip()
        if not content:
            continue
            
        template_doc = {
            "campaign_id": ObjectId(campaign_id),
            "content": content,
            "category": "General",
            "language": "vi",
            "priority": "MEDIUM",
            "status": "ACTIVE",
            "created_at": datetime.utcnow()
        }
        result = await db.comment_templates.insert_one(template_doc)
        template_doc["_id"] = result.inserted_id
        inserted_templates.append(serialize_doc(template_doc))
        
    await write_audit_log(
        current_user["id"], current_user["username"],
        "IMPORT_TEMPLATES", "CAMPAIGN", campaign_id,
        new_val=f"Imported:{len(inserted_templates)}"
    )
    
    return inserted_templates

@router.get("/{campaign_id}/templates", response_model=List[CommentTemplateOut])
async def list_campaign_templates(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    await get_campaign_for_user(campaign_id, current_user)
    cursor = db.comment_templates.find({"campaign_id": ObjectId(campaign_id)}).sort("created_at", 1)
    templates = await cursor.to_list(length=1000)
    return serialize_docs(templates)

# --- CAMPAIGN ORCHESTRATION: START, PAUSE, STOP, DUPLICATE ---
@router.post("/{campaign_id}/start")
async def start_campaign(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    if campaign["status"] in ["RUNNING", "COMPLETED"]:
        raise HTTPException(status_code=400, detail=f"Campaign is already {campaign['status']}")
        
    # Check if there are active accounts for this platform
    accounts_query = {
        "platform": campaign["platform"],
        "status": "ACTIVE",
        "owner_id": campaign.get("owner_id", ObjectId(current_user["id"]))
    }

    accounts = await db.accounts.find(accounts_query).to_list(length=100)
    from app.services.social_mock import parse_cookie_to_dict

    valid_accounts = []
    invalid_accounts = []
    for account in accounts:
        cookies = parse_cookie_to_dict(account.get("cookie"))
        if campaign["platform"] == "X":
            valid = bool(cookies.get("auth_token") and cookies.get("ct0"))
            required_msg = "auth_token và ct0"
        else:
            valid = bool(
                account.get("access_token") and account.get("threads_user_id")
            ) or bool(cookies.get("sessionid") or cookies.get("session_id"))
            required_msg = "official access_token + threads_user_id hoac sessionid/session_id"

        if valid:
            valid_accounts.append(account)
        else:
            invalid_accounts.append(account.get("username", "unknown"))

    accounts = valid_accounts
    if not accounts:
        raise HTTPException(
            status_code=400,
            detail=f"No ACTIVE {campaign['platform']} accounts with valid cookies found. Required cookie keys: {required_msg}."
        )
        
    # Check if there are templates
    templates = await db.comment_templates.find({"campaign_id": ObjectId(campaign_id)}).to_list(length=100)
    if not templates:
        raise HTTPException(
            status_code=400,
            detail="No comment templates found for this campaign. Please add templates first."
        )
        
    # Find pending URLs
    pending_urls = await db.target_urls.find({"campaign_id": ObjectId(campaign_id), "status": "PENDING"}).to_list(length=1000)
    if not pending_urls:
        # If there are failed URLs, we might want to restart them, but let's assume they only run PENDING ones, or check if they have any jobs
        existing_jobs = await db.jobs.find({"campaign_id": ObjectId(campaign_id), "status": "PENDING"}).to_list(length=1000)
        if not existing_jobs:
            raise HTTPException(status_code=400, detail="No PENDING URLs or jobs found to execute.")
        
    # Update Campaign status to RUNNING
    await db.campaigns.update_one({"_id": ObjectId(campaign_id)}, {"$set": {"status": "RUNNING", "start_time": datetime.utcnow()}})
    
    jobs_to_create = []
    jobs_to_enqueue = []
    
    # 1. Check if we have existing paused/pending jobs to resume
    resumable_jobs = await db.jobs.find({"campaign_id": ObjectId(campaign_id), "status": "PENDING"}).to_list(length=1000)
    if resumable_jobs:
        for job in resumable_jobs:
            await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "QUEUED"}})
            await queue_service.enqueue_job(str(job["_id"]))
            jobs_to_enqueue.append(str(job["_id"]))
            
    # 2. Otherwise generate new jobs from pending URLs
    else:
        for i, target_url in enumerate(pending_urls):
            # Select account and template (round robin or random)
            account = accounts[i % len(accounts)]
            template = templates[i % len(templates)]
            
            job_doc = {
                "campaign_id": ObjectId(campaign_id),
                "account_id": account["_id"],
                "url_id": target_url["_id"],
                "template_id": template["_id"],
                "status": "QUEUED",
                "attempt_count": 0,
                "scheduled_time": datetime.utcnow(),
                "started_at": None,
                "completed_at": None,
                "error_message": None,
                "created_at": datetime.utcnow()
            }
            
            result = await db.jobs.insert_one(job_doc)
            job_id_str = str(result.inserted_id)
            
            # Update target URL to PROCESSING
            await db.target_urls.update_one({"_id": target_url["_id"]}, {"$set": {"status": "PROCESSING"}})
            
            # Enqueue to Redis
            await queue_service.enqueue_job(job_id_str)
            jobs_to_enqueue.append(job_id_str)
            
    await write_audit_log(
        current_user["id"], current_user["username"],
        "START", "CAMPAIGN", campaign_id,
        new_val=f"Enqueued {len(jobs_to_enqueue)} jobs"
    )
    
    return {"message": "Campaign started successfully", "jobs_enqueued": len(jobs_to_enqueue)}

@router.post("/{campaign_id}/pause")
async def pause_campaign(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    if campaign["status"] != "RUNNING":
        raise HTTPException(status_code=400, detail="Only RUNNING campaigns can be paused")
        
    # Set campaign status to PAUSED
    await db.campaigns.update_one({"_id": ObjectId(campaign_id)}, {"$set": {"status": "PAUSED"}})
    
    # Find all QUEUED jobs and move them to PENDING, remove from Redis
    queued_jobs = await db.jobs.find({"campaign_id": ObjectId(campaign_id), "status": "QUEUED"}).to_list(length=1000)
    for job in queued_jobs:
        job_id = str(job["_id"])
        # Remove from Redis queue
        await queue_service.remove_job_from_queue(job_id)
        # Update db status
        await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "PENDING"}})
        # Revert target URL to PENDING
        await db.target_urls.update_one({"_id": job["url_id"]}, {"$set": {"status": "PENDING"}})
        
    await write_audit_log(
        current_user["id"], current_user["username"],
        "PAUSE", "CAMPAIGN", campaign_id,
        new_val=f"Paused and reverted {len(queued_jobs)} jobs to pending"
    )
    
    return {"message": "Campaign paused successfully", "jobs_paused": len(queued_jobs)}

@router.post("/{campaign_id}/stop")
async def stop_campaign(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    # Set campaign status to COMPLETED (or stopped, but completed is standard)
    await db.campaigns.update_one({"_id": ObjectId(campaign_id)}, {"$set": {"status": "COMPLETED", "end_time": datetime.utcnow()}})
    
    # Cancel all QUEUED or PENDING jobs
    affected_jobs = await db.jobs.find({
        "campaign_id": ObjectId(campaign_id),
        "status": {"$in": ["QUEUED", "PENDING", "RUNNING"]}
    }).to_list(length=1000)
    
    cancelled_count = 0
    for job in affected_jobs:
        job_id = str(job["_id"])
        # Remove from Redis
        await queue_service.remove_job_from_queue(job_id)
        # Update db status
        if job["status"] in ["QUEUED", "PENDING"]:
            await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "CANCELLED"}})
            await db.target_urls.update_one({"_id": job["url_id"]}, {"$set": {"status": "SKIPPED", "error_message": "Campaign stopped by user"}})
            cancelled_count += 1
            
    await write_audit_log(
        current_user["id"], current_user["username"],
        "STOP", "CAMPAIGN", campaign_id,
        new_val=f"Stopped campaign, cancelled {cancelled_count} jobs"
    )
    
    return {"message": "Campaign stopped successfully", "jobs_cancelled": cancelled_count}

@router.post("/{campaign_id}/duplicate")
async def duplicate_campaign(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    # Duplicate Campaign
    dup_campaign_doc = {
        "name": f"Copy of {campaign['name']}",
        "platform": campaign["platform"],
        "description": campaign["description"],
        "status": "DRAFT",
        "start_time": None,
        "end_time": None,
        "created_by": current_user["username"],
        "owner_id": ObjectId(current_user["id"]),
        "created_at": datetime.utcnow()
    }
    result = await db.campaigns.insert_one(dup_campaign_doc)
    new_campaign_id = result.inserted_id
    
    # Duplicate URLs (reset status to PENDING)
    cursor_urls = db.target_urls.find({"campaign_id": ObjectId(campaign_id)})
    async for url in cursor_urls:
        url_doc = {
            "campaign_id": new_campaign_id,
            "url": url["url"],
            "platform": url["platform"],
            "status": "PENDING",
            "processed_at": None,
            "error_message": None,
            "created_at": datetime.utcnow()
        }
        await db.target_urls.insert_one(url_doc)
        
    # Duplicate Templates
    cursor_tpl = db.comment_templates.find({"campaign_id": ObjectId(campaign_id)})
    async for tpl in cursor_tpl:
        tpl_doc = {
            "campaign_id": new_campaign_id,
            "content": tpl["content"],
            "category": tpl.get("category", "General"),
            "language": tpl.get("language", "vi"),
            "priority": tpl.get("priority", "MEDIUM"),
            "status": tpl.get("status", "ACTIVE"),
            "created_at": datetime.utcnow()
        }
        await db.comment_templates.insert_one(tpl_doc)
        
    await write_audit_log(
        current_user["id"], current_user["username"],
        "DUPLICATE", "CAMPAIGN", campaign_id,
        new_val=f"New Campaign ID: {new_campaign_id}"
    )
    
    return {"message": "Campaign duplicated successfully", "new_campaign_id": str(new_campaign_id)}
