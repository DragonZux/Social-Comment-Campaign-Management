from pydantic_settings import BaseSettings
from pydantic import ConfigDict

class Settings(BaseSettings):
    MONGODB_URL: str = "mongodb://localhost:27017"
    DATABASE_NAME: str = "social_campaign_db"
    REDIS_URL: str = "redis://localhost:6379/0"
    
    JWT_SECRET: str = "supersecretkeyforcampaignmanagementsystem123456!"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours for development ease

    model_config = ConfigDict(env_file=".env", extra="ignore")

settings = Settings()
