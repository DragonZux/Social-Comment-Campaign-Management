import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from passlib.hash import bcrypt

from app.config import settings
from app.database import connect_to_mongo, close_mongo_connection, get_db
from app.routes import auth, accounts, campaigns, jobs, dashboard
from app.services.queue_service import queue_service

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("app.main")

async def seed_data():
    db = get_db()
    
    # 1. Check if we need to seed users
    users_count = await db.users.count_documents({})
    if users_count == 0:
        logger.info("Database is empty. Seeding initial development data...")
        
        # Seed users
        admin_hash = bcrypt.hash("admin123")
        operator_hash = bcrypt.hash("operator123")
        
        await db.users.insert_many([
            {
                "username": "admin",
                "hashed_password": admin_hash,
                "role": "ADMIN",
                "created_at": datetime.utcnow()
            },
            {
                "username": "operator",
                "hashed_password": operator_hash,
                "role": "OPERATOR",
                "created_at": datetime.utcnow()
            }
        ])
        logger.info("Seeded users (admin/admin123, operator/operator123)")
        
        # Seed accounts
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
                "created_at": datetime.utcnow()
            }
        ])
        logger.info("Seeded initial social accounts")

# We import datetime inside main for seeding
from datetime import datetime

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    await connect_to_mongo()
    await queue_service.connect()
    await seed_data()
    yield
    # Shutdown logic
    await close_mongo_connection()
    await queue_service.disconnect()

app = FastAPI(
    title="Social Comment Campaign Management System API",
    description="Backend service for managing automated comment campaigns on X/Threads",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json"
)

# Set CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # In production, configure to Next.js domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routes
app.include_router(auth.router, prefix="/api")
app.include_router(accounts.router, prefix="/api")
app.include_router(campaigns.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "Social Comment Campaign Management API",
        "documentation": "/docs"
    }
