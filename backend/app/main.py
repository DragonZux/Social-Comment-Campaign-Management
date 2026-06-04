import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import accounts, auth, campaigns, dashboard, jobs
from app.db.database import close_mongo_connection, connect_to_mongo
from app.seed import seed_data
from app.services.queue_service import queue_service

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("app.main")

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
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3099",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3099",
    ],
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
