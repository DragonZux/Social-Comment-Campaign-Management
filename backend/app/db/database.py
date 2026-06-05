import logging
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings

logger = logging.getLogger("app.db.database")

class Database:
    client: AsyncIOMotorClient = None
    db = None

db_instance = Database()

async def connect_to_mongo():
    logger.info(f"Connecting to MongoDB at {settings.MONGODB_URL}")
    db_instance.client = AsyncIOMotorClient(settings.MONGODB_URL)
    db_instance.db = db_instance.client[settings.DATABASE_NAME]
    
    # Initialize indexes
    try:
        # User collection unique index
        await db_instance.db.users.create_index("username", unique=True)
        # Account usernames are unique inside each user's private workspace.
        try:
            await db_instance.db.accounts.drop_index("platform_1_username_1")
        except Exception:
            pass
        await db_instance.db.accounts.create_index([("owner_id", 1), ("platform", 1), ("username", 1)], unique=True)
        # Jobs indexing for quick search
        await db_instance.db.jobs.create_index([("campaign_id", 1), ("status", 1)])
        await db_instance.db.jobs.create_index("scheduled_time")
        try:
            await db_instance.db.jobs.create_index([("campaign_id", 1), ("url_id", 1)], unique=True)
        except Exception as e:
            logger.warning(f"Could not create unique jobs(campaign_id, url_id) index: {e}")
        # Target URLs unique per campaign
        await db_instance.db.target_urls.create_index([("campaign_id", 1), ("url", 1)], unique=True)
        logger.info("Successfully connected to MongoDB and verified indexes.")
    except Exception as e:
        logger.error(f"Error creating indexes: {e}")

async def close_mongo_connection():
    if db_instance.client:
        db_instance.client.close()
        logger.info("MongoDB connection closed.")

def get_db():
    return db_instance.db
