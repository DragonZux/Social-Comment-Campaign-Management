from fastapi import APIRouter, Depends, HTTPException, status
from bson import ObjectId
from datetime import datetime, timedelta
from typing import List, Optional

from app.db.database import get_db
from app.schemas import (
    CampaignCreate, CampaignUpdate, CampaignOut,
    TargetURLImport, TargetURLOut, CommentTemplateImport, CommentTemplateOut,
    AssignAccountToURL,
    serialize_doc, serialize_docs
)
from app.api.routes.auth import get_current_user, write_audit_log
from app.services.queue_service import queue_service

router = APIRouter(prefix="/campaigns", tags=["Campaigns"])


def normalize_monitor_page_urls(*values) -> List[str]:
    urls = []
    for value in values:
        if value is None:
            continue
        if isinstance(value, str):
            candidates = value.splitlines()
        elif isinstance(value, list):
            candidates = value
        else:
            continue

        for item in candidates:
            if not isinstance(item, str):
                continue
            url = item.strip().strip(",")
            if not url:
                continue
            if not url.lower().startswith(("http://", "https://")):
                url = f"https://{url}"
            if url.lower().startswith("https://threads.com/"):
                url = "https://www.threads.com/" + url[len("https://threads.com/"):]
            elif url.lower().startswith("https://threads.net/"):
                url = "https://www.threads.net/" + url[len("https://threads.net/"):]
            if url not in urls:
                urls.append(url)
    return urls


def get_monitor_page_urls(campaign: dict) -> List[str]:
    return normalize_monitor_page_urls(
        campaign.get("monitor_page_urls"),
        campaign.get("monitor_page_url"),
    )


def is_valid_target_post_url(url: str, platform: str) -> bool:
    lowered = url.lower()
    if platform == "X":
        return ("x.com/" in lowered or "twitter.com/" in lowered) and "/status/" in lowered
    if platform == "Threads":
        return ("threads.net/" in lowered or "threads.com/" in lowered) and (
            "/post/" in lowered or "/t/" in lowered
        )
    return False


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


async def refresh_campaign_readiness(campaign_id: ObjectId, current_status: str):
    if current_status not in ["DRAFT", "READY"]:
        return

    db = get_db()
    campaign = await db.campaigns.find_one({"_id": campaign_id})
    if not campaign:
        return

    is_monitor = campaign.get("campaign_type") == "MONITOR"

    has_url = True
    if not is_monitor:
        has_url = await db.target_urls.count_documents({
            "campaign_id": campaign_id,
            "status": {"$in": ["PENDING", "PROCESSING", "SUCCESS", "FAILED"]},
        }) > 0

    has_monitor_config = not is_monitor or bool(get_monitor_page_urls(campaign))

    has_template = await db.comment_templates.count_documents({
        "campaign_id": campaign_id,
        "status": "ACTIVE",
    }) > 0

    next_status = "READY" if has_url and has_template and has_monitor_config else "DRAFT"
    if next_status != current_status:
        await db.campaigns.update_one({"_id": campaign_id}, {"$set": {"status": next_status}})


@router.post("", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    campaign_in: CampaignCreate,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    monitor_page_urls = normalize_monitor_page_urls(
        campaign_in.monitor_page_urls,
        campaign_in.monitor_page_url,
    )

    campaign_doc = {
        "name": campaign_in.name,
        "platform": campaign_in.platform,
        "description": campaign_in.description or "",
        "status": "DRAFT",
        "start_time": campaign_in.start_time,
        "end_time": campaign_in.end_time,
        "campaign_type": campaign_in.campaign_type or "STATIC",
        "monitor_page_url": monitor_page_urls[0] if monitor_page_urls else None,
        "monitor_page_urls": monitor_page_urls,
        "monitor_interval": campaign_in.monitor_interval or 15,
        "last_monitored_at": None,
        "repeat_enabled": bool(campaign_in.repeat_enabled),
        "repeat_interval_minutes": campaign_in.repeat_interval_minutes,
        "comment_template_cursor": 0,
        "next_run_at": None,
        "last_repeat_run_at": None,
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
    if campaign_in.campaign_type is not None:
        update_data["campaign_type"] = campaign_in.campaign_type
    if campaign_in.monitor_page_urls is not None or campaign_in.monitor_page_url is not None:
        monitor_page_urls = normalize_monitor_page_urls(
            campaign_in.monitor_page_urls,
            campaign_in.monitor_page_url,
        )
        update_data["monitor_page_urls"] = monitor_page_urls
        update_data["monitor_page_url"] = monitor_page_urls[0] if monitor_page_urls else None
    if campaign_in.monitor_interval is not None:
        update_data["monitor_interval"] = campaign_in.monitor_interval
    if campaign_in.repeat_enabled is not None:
        update_data["repeat_enabled"] = campaign_in.repeat_enabled
        if not campaign_in.repeat_enabled:
            update_data["next_run_at"] = None
    if campaign_in.repeat_interval_minutes is not None:
        update_data["repeat_interval_minutes"] = campaign_in.repeat_interval_minutes
        if campaign.get("repeat_enabled") or update_data.get("repeat_enabled"):
            update_data["next_run_at"] = datetime.utcnow() + timedelta(minutes=campaign_in.repeat_interval_minutes)
        
    if not update_data:
        return serialize_doc(campaign)
        
    await db.campaigns.update_one(
        {"_id": ObjectId(campaign_id), **campaign_scope(current_user)},
        {"$set": update_data}
    )
    
    updated_campaign = await db.campaigns.find_one({"_id": ObjectId(campaign_id), **campaign_scope(current_user)})
    
    # Auto-refresh readiness
    await refresh_campaign_readiness(ObjectId(campaign_id), updated_campaign["status"])
    
    # Reload after readiness check might have changed the status
    updated_campaign = await db.campaigns.find_one({"_id": ObjectId(campaign_id), **campaign_scope(current_user)})
    
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
        
    campaign_oid = ObjectId(campaign_id)
    # Delete associated data
    await db.campaigns.delete_one({"_id": campaign_oid, **campaign_scope(current_user)})
    await db.target_urls.delete_many({"campaign_id": campaign_oid})
    await db.comment_templates.delete_many({"campaign_id": campaign_oid})
    await db.jobs.delete_many({"campaign_id": campaign_oid})
    
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
    invalid_count = 0
    
    for url in url_import.urls:
        url = url.strip()
        if not url:
            continue
        if url.lower().startswith("https://threads.com/"):
            url = "https://www.threads.com/" + url[len("https://threads.com/"):]
        elif url.lower().startswith("https://threads.net/"):
            url = "https://www.threads.net/" + url[len("https://threads.net/"):]
        if not is_valid_target_post_url(url, campaign["platform"]):
            invalid_count += 1
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
        new_val=f"Imported:{len(inserted_urls)}, Duplicates:{duplicates_count}, Invalid:{invalid_count}"
    )
    
    await refresh_campaign_readiness(ObjectId(campaign_id), campaign["status"])
        
    return inserted_urls


@router.get("/{campaign_id}/urls", response_model=List[TargetURLOut])
async def list_campaign_urls(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    await get_campaign_for_user(campaign_id, current_user)
    pipeline = [
        {"$match": {"campaign_id": ObjectId(campaign_id)}},
        {"$lookup": {
            "from": "accounts",
            "localField": "assigned_account_id",
            "foreignField": "_id",
            "as": "assigned_account"
        }},
        {"$unwind": {"path": "$assigned_account", "preserveNullAndEmptyArrays": True}},
        {"$addFields": {
            "assigned_account_username": "$assigned_account.username"
        }},
        {"$project": {"assigned_account": 0}},
        {"$sort": {"created_at": 1}}
    ]
    cursor = db.target_urls.aggregate(pipeline)
    urls = await cursor.to_list(length=1000)
    return serialize_docs(urls)


@router.put("/{campaign_id}/urls/{url_id}/assign-account")
async def assign_account_to_url(
    campaign_id: str,
    url_id: str,
    body: AssignAccountToURL,
    current_user: dict = Depends(get_current_user)
):
    """Assign a specific account to a target URL. Pass account_id=null to unassign."""
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)

    if not ObjectId.is_valid(url_id):
        raise HTTPException(status_code=400, detail="Invalid URL ID")

    url_doc = await db.target_urls.find_one({"_id": ObjectId(url_id), "campaign_id": ObjectId(campaign_id)})
    if not url_doc:
        raise HTTPException(status_code=404, detail="Target URL not found in this campaign")

    update_data = {}
    if body.account_id:
        if not ObjectId.is_valid(body.account_id):
            raise HTTPException(status_code=400, detail="Invalid account ID")
        account = await db.accounts.find_one({
            "_id": ObjectId(body.account_id),
            "owner_id": ObjectId(current_user["id"]),
            "platform": campaign["platform"]
        })
        if not account:
            raise HTTPException(status_code=404, detail="Account not found or platform mismatch")
        update_data["assigned_account_id"] = ObjectId(body.account_id)
    else:
        update_data["assigned_account_id"] = None

    await db.target_urls.update_one({"_id": ObjectId(url_id)}, {"$set": update_data})

    return {"message": "Account assignment updated successfully"}


@router.put("/{campaign_id}/urls/assign-account-all")
async def assign_account_to_all_urls(
    campaign_id: str,
    body: AssignAccountToURL,
    current_user: dict = Depends(get_current_user)
):
    """Assign a specific account to ALL target URLs in a campaign. Pass account_id=null to unassign all."""
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)

    update_data = {}
    if body.account_id:
        if not ObjectId.is_valid(body.account_id):
            raise HTTPException(status_code=400, detail="Invalid account ID")
        account = await db.accounts.find_one({
            "_id": ObjectId(body.account_id),
            "owner_id": ObjectId(current_user["id"]),
            "platform": campaign["platform"]
        })
        if not account:
            raise HTTPException(status_code=404, detail="Account not found or platform mismatch")
        update_data["assigned_account_id"] = ObjectId(body.account_id)
    else:
        update_data["assigned_account_id"] = None

    result = await db.target_urls.update_many(
        {"campaign_id": ObjectId(campaign_id)},
        {"$set": update_data}
    )

    return {"message": f"Account assignment updated for {result.modified_count} URLs"}


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

    await refresh_campaign_readiness(ObjectId(campaign_id), campaign["status"])
    
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


@router.post("/{campaign_id}/start")
async def start_campaign(
    campaign_id: str,
    current_user: dict = Depends(get_current_user)
):
    db = get_db()
    campaign = await get_campaign_for_user(campaign_id, current_user)
        
    if campaign["status"] == "RUNNING":
        raise HTTPException(status_code=400, detail="Campaign is already RUNNING")
        
    # Check if there are active accounts for this platform
    accounts_query = {
        "platform": campaign["platform"],
        "status": "ACTIVE",
        "owner_id": campaign.get("owner_id", ObjectId(current_user["id"]))
    }

    accounts = await db.accounts.find(accounts_query).sort("_id", 1).to_list(length=100)
    from app.services.social_mock import parse_cookie_to_dict

    valid_accounts = []
    invalid_reasons = []
    for account in accounts:
        cookies = parse_cookie_to_dict(account.get("cookie"))
        username = account.get("username", "unknown")
        if campaign["platform"] == "X":
            missing = []
            if not cookies.get("auth_token"):
                missing.append("auth_token")
            if not cookies.get("ct0"):
                missing.append("ct0")
            if not missing:
                valid_accounts.append(account)
            else:
                invalid_reasons.append(f"@{username} thiếu {', '.join(missing)}")
        else:
            # Threads
            has_official_token = bool(account.get("access_token") and account.get("threads_user_id"))
            has_cookie = bool(cookies.get("sessionid") or cookies.get("session_id"))
            if has_official_token or has_cookie:
                valid_accounts.append(account)
            else:
                invalid_reasons.append(f"@{username} thiếu access_token+threads_user_id hoặc sessionid/session_id")

    accounts = valid_accounts
    if not accounts:
        if invalid_reasons:
            detail_msg = f"Không tìm thấy tài khoản {campaign['platform']} hoạt động nào có Cookie hợp lệ. Chi tiết lỗi từng tài khoản: {'; '.join(invalid_reasons)}"
        else:
            detail_msg = f"Không tìm thấy tài khoản {campaign['platform']} hoạt động nào được cấu hình."
        raise HTTPException(
            status_code=400,
            detail=detail_msg
        )
        
    campaign_oid = ObjectId(campaign_id)

    # Check if there are templates
    templates = await db.comment_templates.find({"campaign_id": campaign_oid, "status": "ACTIVE"}).sort("created_at", 1).to_list(length=100)
    if not templates:
        raise HTTPException(
            status_code=400,
            detail="No comment templates found for this campaign. Please add templates first."
        )

    # If campaign was previously COMPLETED/FAILED/STOPPED, reset everything for a fresh run
    if campaign["status"] in ["COMPLETED", "FAILED", "STOPPED"]:
        # Reset all non-SUCCESS URLs back to PENDING for re-processing
        await db.target_urls.update_many(
            {"campaign_id": campaign_oid, "status": {"$in": ["FAILED", "SKIPPED", "PROCESSING"]}},
            {"$set": {"status": "PENDING", "error_message": None, "processed_at": None}}
        )
        # Delete old failed/cancelled jobs so they can be recreated
        await db.jobs.delete_many(
            {"campaign_id": campaign_oid, "status": {"$in": ["FAILED", "CANCELLED", "SKIPPED"]}}
        )

    is_monitor = campaign.get("campaign_type") == "MONITOR"

    # Find all URLs that need processing (PENDING ones)
    pending_urls = []
    if not is_monitor:
        pending_urls = await db.target_urls.find({"campaign_id": campaign_oid, "status": "PENDING"}).sort("created_at", 1).to_list(length=1000)
        if not pending_urls:
            # Check if there are paused/pending jobs to resume
            existing_jobs = await db.jobs.find({"campaign_id": campaign_oid, "status": "PENDING"}).to_list(length=1000)
            if not existing_jobs:
                raise HTTPException(status_code=400, detail="No PENDING URLs or jobs found to execute. All URLs may have already been processed successfully.")
    else:
        if not get_monitor_page_urls(campaign):
            raise HTTPException(status_code=400, detail="Please add at least one profile/page link to monitor before starting this campaign.")
        pending_urls = await db.target_urls.find({"campaign_id": campaign_oid, "status": "PENDING"}).sort("created_at", 1).to_list(length=1000)
        
    lock_result = await db.campaigns.update_one(
        {
            "_id": campaign_oid,
            **campaign_scope(current_user),
            "status": {"$ne": "RUNNING"},
        },
        {"$set": {
            "status": "RUNNING",
            "start_time": datetime.utcnow(),
            "end_time": None,
            "last_monitored_at": None,
            "next_run_at": None
        }},
    )
    if lock_result.modified_count != 1:
        raise HTTPException(status_code=409, detail="Campaign state changed. Please refresh and try again.")
    
    jobs_to_enqueue = []
    
    # 1. Check if we have existing paused/pending jobs to resume
    resumable_jobs = await db.jobs.find({"campaign_id": campaign_oid, "status": "PENDING"}).to_list(length=1000)
    if resumable_jobs:
        for job in resumable_jobs:
            await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "QUEUED"}})
            await queue_service.enqueue_job(str(job["_id"]))
            jobs_to_enqueue.append(str(job["_id"]))
            
    # Load-Balanced Account tracking: counts active jobs for each account
    assigned_counts = {str(acc["_id"]): 0 for acc in accounts}
    active_jobs = await db.jobs.find({
        "status": {"$in": ["QUEUED", "RUNNING", "RETRYING"]}
    }).to_list(length=1000)
    for job in active_jobs:
        acc_id_str = str(job["account_id"])
        if acc_id_str in assigned_counts:
            assigned_counts[acc_id_str] += 1

    # 2. Create one job per URL, advancing comment templates sequentially across runs.
    template_cursor = int(campaign.get("comment_template_cursor") or 0) % len(templates)
    created_job_count = 0
    for target_url in pending_urls:
        existing_job = await db.jobs.find_one({
            "campaign_id": campaign_oid,
            "url_id": target_url["_id"],
            "status": {"$in": ["QUEUED", "RUNNING", "PENDING", "RETRYING", "SUCCESS"]}
        })
        if existing_job:
            continue

        template = templates[(template_cursor + created_job_count) % len(templates)]

        # Use assigned account if set, otherwise load-balance among accounts
        assigned_id = target_url.get("assigned_account_id")
        if assigned_id:
            assigned_account = next((a for a in accounts if a["_id"] == assigned_id), None)
            account = assigned_account if assigned_account else min(accounts, key=lambda a: assigned_counts[str(a["_id"])])
        else:
            account = min(accounts, key=lambda a: assigned_counts[str(a["_id"])])
            
        assigned_counts[str(account["_id"])] += 1
        
        job_doc = {
            "campaign_id": campaign_oid,
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
        created_job_count += 1

    if created_job_count:
        await db.campaigns.update_one(
            {"_id": campaign_oid},
            {"$set": {"comment_template_cursor": (template_cursor + created_job_count) % len(templates)}}
        )
        
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
        
    campaign_oid = ObjectId(campaign_id)
    # Set campaign status to PAUSED
    await db.campaigns.update_one({"_id": campaign_oid, **campaign_scope(current_user)}, {"$set": {"status": "PAUSED"}})
    
    # Find all QUEUED jobs and move them to PENDING, remove from Redis
    queued_jobs = await db.jobs.find({"campaign_id": campaign_oid, "status": {"$in": ["QUEUED", "RETRYING"]}}).to_list(length=1000)
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

    campaign_oid = ObjectId(campaign_id)
    stopped_at = datetime.utcnow()
    await db.campaigns.update_one(
        {"_id": campaign_oid, **campaign_scope(current_user)},
        {"$set": {"status": "STOPPED", "end_time": stopped_at}},
    )
    
    # Cancel all QUEUED or PENDING jobs
    affected_jobs = await db.jobs.find({
        "campaign_id": campaign_oid,
        "status": {"$in": ["QUEUED", "PENDING", "RETRYING", "RUNNING"]}
    }).to_list(length=1000)
    
    cancelled_count = 0
    for job in affected_jobs:
        job_id = str(job["_id"])
        # Remove from Redis
        await queue_service.remove_job_from_queue(job_id)
        # Update db status
        if job["status"] in ["QUEUED", "PENDING", "RETRYING", "RUNNING"]:
            await db.jobs.update_one(
                {"_id": job["_id"], "status": {"$in": ["QUEUED", "PENDING", "RETRYING", "RUNNING"]}},
                {"$set": {
                    "status": "CANCELLED",
                    "completed_at": stopped_at,
                    "error_message": "Campaign stopped by user"
                }}
            )
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
        "campaign_type": campaign.get("campaign_type", "STATIC"),
        "monitor_page_url": campaign.get("monitor_page_url"),
        "monitor_page_urls": get_monitor_page_urls(campaign),
        "monitor_interval": campaign.get("monitor_interval", 15),
        "last_monitored_at": None,
        "repeat_enabled": campaign.get("repeat_enabled", False),
        "repeat_interval_minutes": campaign.get("repeat_interval_minutes"),
        "comment_template_cursor": 0,
        "next_run_at": None,
        "last_repeat_run_at": None,
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
