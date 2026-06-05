import logging
from datetime import datetime

from bson import ObjectId

from app.api.routes.auth import get_password_hash
from app.db.database import get_db

logger = logging.getLogger("app.seed")


async def seed_data():
    db = get_db()

    users_count = await db.users.count_documents({})
    if users_count > 0:
        return

    logger.info("Database is empty. Seeding initial development data...")

    admin_hash = get_password_hash("admin123")
    operator_hash = get_password_hash("operator123")
    admin_id = ObjectId()
    operator_id = ObjectId()

    await db.users.insert_many([
        {
            "_id": admin_id,
            "username": "admin",
            "hashed_password": admin_hash,
            "created_at": datetime.utcnow()
        },
        {
            "_id": operator_id,
            "username": "operator",
            "hashed_password": operator_hash,
            "created_at": datetime.utcnow()
        }
    ])
    logger.info("Seeded users (admin/admin123, operator/operator123)")

    await db.accounts.insert_many([
        {
            "platform": "X",
            "username": "tech_guru",
            "display_name": "Tech Guru X",
            "status": "ACTIVE",
            "daily_limit": 100,
            "hourly_limit": 10,
            "daily_usage_count": 0,
            "hourly_usage_count": 0,
            "last_activity": None,
            "health_score": 100,
            "owner_id": operator_id,
            "created_at": datetime.utcnow()
        },
        {
            "platform": "X",
            "username": "crypto_news",
            "display_name": "Crypto Alerts",
            "status": "ACTIVE",
            "daily_limit": 50,
            "hourly_limit": 5,
            "daily_usage_count": 0,
            "hourly_usage_count": 0,
            "last_activity": None,
            "health_score": 95,
            "owner_id": operator_id,
            "created_at": datetime.utcnow()
        },
        {
            "platform": "Threads",
            "username": "lifestyle_vlog",
            "display_name": "Lifestyle Threads",
            "status": "ACTIVE",
            "daily_limit": 20,
            "hourly_limit": 3,
            "daily_usage_count": 0,
            "hourly_usage_count": 0,
            "last_activity": None,
            "health_score": 100,
            "owner_id": operator_id,
            "created_at": datetime.utcnow()
        }
    ])
    logger.info("Seeded initial social accounts")
