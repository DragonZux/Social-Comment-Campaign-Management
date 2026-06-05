import logging
import redis.asyncio as redis
from app.core.config import settings

logger = logging.getLogger("app.queue_service")

class QueueService:
    def __init__(self):
        self.redis_client = None

    async def connect(self):
        if not self.redis_client:
            logger.info(f"Connecting to Redis queue at {settings.REDIS_URL}")
            self.redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

    async def disconnect(self):
        if self.redis_client:
            await self.redis_client.close()
            logger.info("Redis connection closed.")

    async def enqueue_job(self, job_id: str):
        await self.connect()
        await self.redis_client.rpush("campaign_jobs_queue", job_id)
        logger.debug(f"Enqueued job {job_id} to Redis")

    async def schedule_job(self, job_id: str, run_at_timestamp: float):
        await self.connect()
        await self.redis_client.zadd("campaign_jobs_scheduled", {job_id: run_at_timestamp})
        logger.debug(f"Scheduled job {job_id} for timestamp {run_at_timestamp}")

    async def dequeue_due_scheduled_jobs(self, now_timestamp: float, limit: int = 100) -> list[str]:
        await self.connect()
        job_ids = await self.redis_client.zrangebyscore(
            "campaign_jobs_scheduled",
            min=0,
            max=now_timestamp,
            start=0,
            num=limit,
        )
        if job_ids:
            await self.redis_client.zrem("campaign_jobs_scheduled", *job_ids)
        return job_ids

    async def get_queue_size(self) -> int:
        await self.connect()
        return await self.redis_client.llen("campaign_jobs_queue")

    async def remove_job_from_queue(self, job_id: str):
        await self.connect()
        # Removes all occurrences of job_id
        await self.redis_client.lrem("campaign_jobs_queue", 0, job_id)
        await self.redis_client.zrem("campaign_jobs_scheduled", job_id)

    async def clear_queue(self):
        await self.connect()
        await self.redis_client.delete("campaign_jobs_queue")
        await self.redis_client.delete("campaign_jobs_scheduled")
        logger.info("Cleared campaign jobs queue in Redis")

queue_service = QueueService()
