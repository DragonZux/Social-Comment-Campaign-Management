import asyncio
import logging
import re
import random
from datetime import datetime, timedelta
import redis.asyncio as redis
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from app.core.config import settings
from app.services.social_mock import (
    SocialAuthError,
    SocialCheckpointError,
    mock_post_comment,
    parse_cookie_to_dict,
)

# Configure logging for worker
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - worker - %(levelname)s - %(message)s"
)
logger = logging.getLogger("worker")

IMMEDIATE_QUEUE = "campaign_jobs_queue"
SCHEDULED_QUEUE = "campaign_jobs_scheduled"

def spin_spintax(text: str) -> str:
    """
    Parses and spins spintax format like {hello|hi|hey} into a random choice.
    Supports nested spintax.
    """
    pattern = re.compile(r'{([^{}]+)}')
    while True:
        match = pattern.search(text)
        if not match:
            break
        options = match.group(1).split('|')
        text = text.replace(match.group(0), random.choice(options), 1)
    return text

class Worker:
    def __init__(self):
        self.redis_client = None
        self.mongo_client = None
        self.db = None
        self.running = True
        self.last_monitor_check = 0.0

    async def connect(self):
        logger.info(f"Connecting to MongoDB at {settings.MONGODB_URL}")
        self.mongo_client = AsyncIOMotorClient(settings.MONGODB_URL)
        self.db = self.mongo_client[settings.DATABASE_NAME]

        logger.info(f"Connecting to Redis at {settings.REDIS_URL}")
        self.redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

    async def check_and_reset_limits(self, account: dict) -> dict:
        """
        Check if the account's usage count needs to be reset based on the time elapsed
        since last activity. Returns updated account dict.
        """
        now = datetime.utcnow()
        last_act = account.get("last_activity")
        
        update_fields = {}
        
        if last_act:
            if isinstance(last_act, str):
                try:
                    last_act = datetime.fromisoformat(last_act)
                except ValueError:
                    last_act = now
            
            # Reset hourly count if the hour has changed
            if last_act.hour != now.hour or (now - last_act) > timedelta(hours=1):
                update_fields["hourly_usage_count"] = 0
                account["hourly_usage_count"] = 0
                
            # Reset daily count if the day has changed
            if last_act.day != now.day or (now - last_act) > timedelta(days=1):
                update_fields["daily_usage_count"] = 0
                account["daily_usage_count"] = 0
                
        if update_fields:
            # If account status was LIMITED due to rate limits, reset it to ACTIVE
            if account["status"] == "LIMITED":
                update_fields["status"] = "ACTIVE"
                account["status"] = "ACTIVE"
                
            await self.db.accounts.update_one(
                {"_id": account["_id"]},
                {"$set": update_fields}
            )
            logger.info(f"Reset usage limits for account @{account['username']}")
            
        return account

    async def handle_retry(self, job_id_str: str, job: dict, error_msg: str):
        attempt = job.get("attempt_count", 0) + 1
        db = self.db
        
        # Retry Delays:
        # Retry 1 -> 1 min (60s)
        # Retry 2 -> 5 mins (300s)
        # Retry 3 -> 15 mins (900s)
        delays = [60, 300, 900]
        
        if attempt <= 3:
            delay = delays[attempt - 1]
            run_at = datetime.utcnow() + timedelta(seconds=delay)
            logger.info(f"Scheduling job {job_id_str} for retry #{attempt} in {delay}s due to error: {error_msg}")
            
            # Update job status in database
            await db.jobs.update_one(
                {"_id": ObjectId(job_id_str)},
                {"$set": {
                    "status": "RETRYING",
                    "attempt_count": attempt,
                    "scheduled_time": run_at,
                    "error_message": f"Retry #{attempt}: {error_msg}"
                }}
            )
            await self.redis_client.zadd(SCHEDULED_QUEUE, {job_id_str: run_at.timestamp()})
        else:
            # Max retries exceeded
            logger.error(f"Job {job_id_str} failed after max retries. Error: {error_msg}")
            
            await db.jobs.update_one(
                {"_id": ObjectId(job_id_str)},
                {"$set": {
                    "status": "FAILED",
                    "completed_at": datetime.utcnow(),
                    "error_message": f"Failed after 3 attempts: {error_msg}"
                }}
            )
            
            # Update target URL to FAILED
            await db.target_urls.update_one(
                {"_id": job["url_id"]},
                {"$set": {
                    "status": "FAILED",
                    "processed_at": datetime.utcnow(),
                    "error_message": error_msg
                }}
            )
            
            # Reduce account health score by 5 points (min 0)
            account_id = job.get("account_id")
            if account_id:
                account = await db.accounts.find_one({"_id": account_id})
                if account:
                    new_score = max(0, account.get("health_score", 100) - 5)
                    # If health score drops below 50, mark account as ERROR/warning status
                    status_val = account["status"]
                    if new_score < 50 and status_val == "ACTIVE":
                        status_val = "ERROR"
                    await db.accounts.update_one(
                        {"_id": account_id},
                        {"$set": {"health_score": new_score, "status": status_val}}
                    )

    async def postpone_for_rate_limit(self, job_id_str: str, job: dict, account: dict):
        now = datetime.utcnow()
        hourly_limited = account["hourly_usage_count"] >= account["hourly_limit"]
        daily_limited = account["daily_usage_count"] >= account["daily_limit"]

        if daily_limited:
            run_at = (now + timedelta(days=1)).replace(hour=0, minute=0, second=5, microsecond=0)
        elif hourly_limited:
            run_at = (now + timedelta(hours=1)).replace(minute=0, second=5, microsecond=0)
        else:
            run_at = now + timedelta(minutes=5)

        message = f"Rate limit reached for @{account['username']}. Rescheduled for {run_at.isoformat()} UTC."
        await self.db.accounts.update_one({"_id": account["_id"]}, {"$set": {"status": "LIMITED"}})
        await self.db.jobs.update_one(
            {"_id": ObjectId(job_id_str)},
            {"$set": {
                "status": "RETRYING",
                "scheduled_time": run_at,
                "error_message": message
            }}
        )
        await self.redis_client.zadd(SCHEDULED_QUEUE, {job_id_str: run_at.timestamp()})
        logger.warning(message)

    async def enqueue_due_scheduled_jobs(self):
        now_ts = datetime.utcnow().timestamp()
        job_ids = await self.redis_client.zrangebyscore(SCHEDULED_QUEUE, 0, now_ts, start=0, num=100)
        due_from_db = await self.db.jobs.find({
            "status": "RETRYING",
            "scheduled_time": {"$lte": datetime.utcnow()}
        }, {"_id": 1}).to_list(length=100)
        db_job_ids = [str(job["_id"]) for job in due_from_db]
        job_ids = list(dict.fromkeys([*job_ids, *db_job_ids]))
        if not job_ids:
            return

        await self.redis_client.zrem(SCHEDULED_QUEUE, *job_ids)
        for job_id_str in job_ids:
            if not ObjectId.is_valid(job_id_str):
                continue

            job = await self.db.jobs.find_one({"_id": ObjectId(job_id_str)})
            if not job or job.get("status") != "RETRYING":
                continue

            campaign = await self.db.campaigns.find_one({"_id": job["campaign_id"]})
            if not campaign:
                await self.db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "CANCELLED"}})
                continue
            if campaign["status"] == "PAUSED":
                await self.db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "PENDING"}})
                continue
            if campaign["status"] != "RUNNING":
                await self.db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": "CANCELLED"}})
                continue

            await self.db.jobs.update_one(
                {"_id": job["_id"], "status": "RETRYING"},
                {"$set": {"status": "QUEUED"}}
            )
            await self.redis_client.rpush(IMMEDIATE_QUEUE, job_id_str)
            logger.info(f"Moved due scheduled job {job_id_str} back to the immediate queue")

    async def handle_permanent_account_error(self, job_id_str: str, job: dict, account: dict, error_msg: str):
        """Fail unrecoverable account/session errors without retrying the same bad cookie."""
        db = self.db
        now = datetime.utcnow()
        logger.error(f"Job {job_id_str} failed with permanent account error: {error_msg}")

        await db.jobs.update_one(
            {"_id": ObjectId(job_id_str)},
            {"$set": {
                "status": "FAILED",
                "completed_at": now,
                "error_message": error_msg
            }}
        )

        await db.target_urls.update_one(
            {"_id": job["url_id"]},
            {"$set": {
                "status": "FAILED",
                "processed_at": now,
                "error_message": error_msg
            }}
        )

        await db.accounts.update_one(
            {"_id": account["_id"]},
            {"$set": {
                "status": "ERROR",
                "health_score": max(0, account.get("health_score", 100) - 20)
            }}
        )

    async def check_campaign_completion(self, campaign_id):
        # Count remaining running/queued/pending jobs in this campaign
        remaining = await self.db.jobs.count_documents({
            "campaign_id": campaign_id,
            "status": {"$in": ["PENDING", "QUEUED", "RUNNING", "RETRYING"]}
        })
        
        if remaining == 0:
            logger.info(f"All jobs for campaign {campaign_id} completed. Finalizing campaign status...")
            failed = await self.db.jobs.count_documents({
                "campaign_id": campaign_id,
                "status": "FAILED"
            })
            next_status = "FAILED" if failed else "COMPLETED"
            await self.db.campaigns.update_one(
                {"_id": campaign_id, "status": "RUNNING"},
                {"$set": {
                    "status": next_status,
                    "end_time": datetime.utcnow()
                }}
            )

    async def process_job(self, job_id_str: str):
        if not ObjectId.is_valid(job_id_str):
            logger.error(f"Invalid job ID received from queue: {job_id_str}")
            return

        db = self.db
        job = await db.jobs.find_one({"_id": ObjectId(job_id_str)})
        
        if not job:
            logger.error(f"Job {job_id_str} not found in database.")
            return
            
        # If campaign is paused or stopped, job might be set to PENDING/CANCELLED. Skip processing.
        if job["status"] not in ["QUEUED", "RUNNING"]:
            logger.warning(f"Skipping job {job_id_str} since it is in status {job['status']}")
            return

        campaign_id = job["campaign_id"]
        # Double check campaign status
        campaign = await db.campaigns.find_one({"_id": campaign_id})
        if not campaign or campaign["status"] != "RUNNING":
            logger.warning(f"Skipping job {job_id_str} since campaign status is {campaign.get('status') if campaign else 'DELETED'}")
            # Reset job status to PENDING or CANCELLED
            new_status = "PENDING" if campaign and campaign["status"] == "PAUSED" else "CANCELLED"
            await db.jobs.update_one({"_id": job["_id"]}, {"$set": {"status": new_status}})
            return

        account_id = job["account_id"]
        account = await db.accounts.find_one({"_id": account_id})
        if not account:
            await self.handle_retry(job_id_str, job, "Social account not found.")
            await self.check_campaign_completion(campaign_id)
            return
            
        # Check limit resets (hourly/daily)
        account = await self.check_and_reset_limits(account)
        
        # Verify account status
        if account["status"] not in ["ACTIVE", "LIMITED"]:
            # If account is disabled/error, retry or fail the job
            await self.handle_retry(job_id_str, job, f"Account @{account['username']} is {account['status']}")
            await self.check_campaign_completion(campaign_id)
            return

        # Check rate limits
        if account["hourly_usage_count"] >= account["hourly_limit"] or account["daily_usage_count"] >= account["daily_limit"]:
            logger.warning(f"Account @{account['username']} hit rate limits. Hourly: {account['hourly_usage_count']}/{account['hourly_limit']}, Daily: {account['daily_usage_count']}/{account['daily_limit']}")
            
            await self.postpone_for_rate_limit(job_id_str, job, account)
            await self.check_campaign_completion(campaign_id)
            return

        # Start execution
        await db.jobs.update_one(
            {"_id": ObjectId(job_id_str)},
            {"$set": {
                "status": "RUNNING",
                "started_at": datetime.utcnow()
            }}
        )

        url_doc = await db.target_urls.find_one({"_id": job["url_id"]})
        template_doc = await db.comment_templates.find_one({"_id": job["template_id"]})

        if not url_doc or not template_doc:
            error_details = f"Missing Target URL (found: {url_doc is not None}) or Comment Template (found: {template_doc is not None})"
            await self.handle_retry(job_id_str, job, error_details)
            await self.check_campaign_completion(campaign_id)
            return

        cookies = parse_cookie_to_dict(account.get("cookie"))
        if campaign["platform"] == "X":
            missing = [key for key in ["auth_token", "ct0"] if not cookies.get(key)]
        elif campaign["platform"] == "Threads":
            has_official_token = bool(account.get("access_token") and account.get("threads_user_id"))
            has_cookie = bool(cookies.get("sessionid") or cookies.get("session_id"))
            missing = [] if has_official_token or has_cookie else ["official access_token + threads_user_id or sessionid/session_id"]
        else:
            missing = [f"unsupported platform {campaign['platform']}"]

        if missing:
            await self.handle_retry(
                job_id_str,
                job,
                f"Account @{account['username']} is missing required cookie keys: {', '.join(missing)}"
            )
            await self.check_campaign_completion(campaign_id)
            return

        try:
            # Spin the comment text if it contains spintax (e.g. {Hello|Hi} world!)
            comment_text = spin_spintax(template_doc["content"])

            # Execute real cookie-based API call
            result = await mock_post_comment(
                platform=campaign["platform"],
                username=account["username"],
                target_url=url_doc["url"],
                comment_content=comment_text,
                cookie=account.get("cookie"),
                proxy=account.get("proxy"),
                access_token=account.get("access_token"),
                threads_user_id=account.get("threads_user_id"),
            )

            latest_campaign = await db.campaigns.find_one({"_id": campaign_id})
            latest_job = await db.jobs.find_one({"_id": ObjectId(job_id_str)})
            if not latest_campaign or latest_campaign["status"] != "RUNNING" or latest_job.get("status") == "CANCELLED":
                now = datetime.utcnow()
                await db.jobs.update_one(
                    {"_id": ObjectId(job_id_str), "status": {"$ne": "SUCCESS"}},
                    {"$set": {
                        "status": "CANCELLED",
                        "completed_at": now,
                        "error_message": "Campaign stopped before the worker could finalize the job."
                    }}
                )
                await db.target_urls.update_one(
                    {"_id": url_doc["_id"], "status": {"$ne": "SUCCESS"}},
                    {"$set": {
                        "status": "SKIPPED",
                        "processed_at": now,
                        "error_message": "Campaign stopped by user"
                    }}
                )
                await self.check_campaign_completion(campaign_id)
                return
            
            # Success!
            now = datetime.utcnow()
            await db.jobs.update_one(
                {"_id": ObjectId(job_id_str)},
                {"$set": {
                    "status": "SUCCESS",
                    "completed_at": now,
                    "error_message": None,
                    "real_api": result.get("real_api", False)
                }}
            )
            
            # Update target URL to SUCCESS
            await db.target_urls.update_one(
                {"_id": url_doc["_id"]},
                {"$set": {
                    "status": "SUCCESS",
                    "processed_at": now,
                    "error_message": None
                }}
            )
            
            # Update account usage counters and activity time
            await db.accounts.update_one(
                {"_id": account["_id"]},
                {
                    "$inc": {"hourly_usage_count": 1, "daily_usage_count": 1},
                    "$set": {"last_activity": now}
                }
            )
            logger.info(f"Job {job_id_str} processed successfully!")
            
        except (SocialAuthError, SocialCheckpointError) as e:
            await self.handle_permanent_account_error(job_id_str, job, account, str(e))
        except Exception as e:
            # Handle transient service errors with retry/backoff.
            await self.handle_retry(job_id_str, job, str(e))
            
        # Check if campaign has finished
        await self.check_campaign_completion(campaign_id)

    async def monitor_campaign_fetch_and_enqueue(self, campaign):
        db = self.db
        campaign_id = campaign["_id"]
        platform = campaign["platform"]
        page_url = campaign.get("monitor_page_url")
        if not page_url:
            return

        # Fetch active accounts
        accounts_query = {
            "platform": platform,
            "status": "ACTIVE",
            "owner_id": campaign["owner_id"]
        }
        accounts = await db.accounts.find(accounts_query).to_list(length=100)
        
        # Filter valid accounts (with cookies)
        from app.services.social_mock import parse_cookie_to_dict
        valid_accounts = []
        for account in accounts:
            cookies = parse_cookie_to_dict(account.get("cookie"))
            if platform == "X":
                valid = bool(cookies.get("auth_token") and cookies.get("ct0"))
            else:
                valid = bool(
                    account.get("access_token") and account.get("threads_user_id")
                ) or bool(cookies.get("sessionid") or cookies.get("session_id"))
            if valid:
                valid_accounts.append(account)

        if not valid_accounts:
            logger.error(f"Cannot monitor campaign '{campaign['name']}': No active accounts with valid cookies.")
            return

        # Get all existing target URLs for this campaign
        existing_urls_cursor = db.target_urls.find({"campaign_id": campaign_id}, {"url": 1})
        existing_urls = [doc["url"] for doc in await existing_urls_cursor.to_list(length=1000)]
        
        # Use first valid account for scraping
        test_account = valid_accounts[0]
        
        # Call simulation/scraping helper to fetch the single latest post
        from app.services.social_mock import mock_fetch_latest_post
        latest_post = await mock_fetch_latest_post(
            platform, 
            page_url, 
            existing_urls, 
            cookie_str=test_account.get("cookie"), 
            proxy=test_account.get("proxy")
        )
        
        if latest_post in existing_urls:
            logger.info(f"Latest post is already processed for monitored campaign '{campaign['name']}'")
            return
            
        logger.info(f"Found new latest post for monitored campaign '{campaign['name']}': {latest_post}. Processing...")
        
        # Fetch templates
        templates = await db.comment_templates.find({"campaign_id": campaign_id, "status": "ACTIVE"}).to_list(length=100)
        if not templates:
            logger.error(f"Cannot process new posts for campaign '{campaign['name']}': No active comment templates.")
            return
            
        total_existing_count = len(existing_urls)
        
        # 1. Insert into target_urls
        url_doc = {
            "campaign_id": campaign_id,
            "url": latest_post,
            "platform": platform,
            "status": "PROCESSING",
            "processed_at": None,
            "error_message": None,
            "created_at": datetime.utcnow()
        }
        result_url = await db.target_urls.insert_one(url_doc)
        url_id = result_url.inserted_id
        
        # 2. Select account and template (round-robin style)
        account = valid_accounts[total_existing_count % len(valid_accounts)]
        template = templates[total_existing_count % len(templates)]
        
        # 3. Create job
        job_doc = {
            "campaign_id": campaign_id,
            "account_id": account["_id"],
            "url_id": url_id,
            "template_id": template["_id"],
            "status": "QUEUED",
            "attempt_count": 0,
            "scheduled_time": datetime.utcnow(),
            "started_at": None,
            "completed_at": None,
            "error_message": None,
            "created_at": datetime.utcnow()
        }
        result_job = await db.jobs.insert_one(job_doc)
        job_id_str = str(result_job.inserted_id)
        
        # 4. Enqueue to Redis
        await self.redis_client.rpush(IMMEDIATE_QUEUE, job_id_str)
        logger.info(f"Enqueued job {job_id_str} for monitored new post: {latest_post}")

    async def check_monitored_campaigns(self):
        db = self.db
        now = datetime.utcnow()
        cursor = db.campaigns.find({
            "campaign_type": "MONITOR",
            "status": "RUNNING"
        })
        async for campaign in cursor:
            campaign_id = campaign["_id"]
            interval_mins = campaign.get("monitor_interval", 15)
            last_monitored = campaign.get("last_monitored_at")
            
            should_check = False
            if not last_monitored:
                should_check = True
            else:
                if isinstance(last_monitored, str):
                    try:
                        last_monitored = datetime.fromisoformat(last_monitored)
                    except ValueError:
                        last_monitored = now
                if now - last_monitored >= timedelta(minutes=interval_mins):
                    should_check = True
            
            if should_check:
                logger.info(f"Checking monitored page for campaign '{campaign['name']}' ({campaign_id})")
                try:
                    await self.monitor_campaign_fetch_and_enqueue(campaign)
                except Exception as e:
                    logger.error(f"Error monitoring campaign {campaign_id}: {e}")
                
                # Update last_monitored_at
                await db.campaigns.update_one(
                    {"_id": campaign_id},
                    {"$set": {"last_monitored_at": datetime.utcnow()}}
                )

    async def run(self):
        await self.connect()
        logger.info("Worker listening for campaign jobs...")
        
        while self.running:
            try:
                # Run monitoring check every 10 seconds
                now_ts = datetime.utcnow().timestamp()
                if now_ts - self.last_monitor_check >= 10:
                    self.last_monitor_check = now_ts
                    await self.check_monitored_campaigns()

                await self.enqueue_due_scheduled_jobs()
                # BLPOP block for 5 seconds waiting for next job ID
                # Returns (queue_name, item)
                res = await self.redis_client.blpop(IMMEDIATE_QUEUE, timeout=5)
                if res:
                    queue_name, job_id_str = res
                    logger.info(f"Dequeued job {job_id_str} from {queue_name}")
                    await self.process_job(job_id_str)
            except Exception as e:
                logger.error(f"Exception in worker execution loop: {e}")
                await asyncio.sleep(2)

        # Close connections
        if self.mongo_client:
            self.mongo_client.close()
        if self.redis_client:
            await self.redis_client.close()

if __name__ == "__main__":
    worker = Worker()
    try:
        asyncio.run(worker.run())
    except KeyboardInterrupt:
        logger.info("Worker stopped by keyboard interrupt.")
