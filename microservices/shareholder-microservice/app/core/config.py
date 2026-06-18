from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/crm_production"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_SECRET: str  # без дефолта: сервис не стартует без заданного секрета
    SERVICE_PORT: int = 8009

    # Webhook secrets для верификации входящих запросов
    ONEC_WEBHOOK_SECRET: str = ""
    BITRIX_WEBHOOK_SECRET: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
