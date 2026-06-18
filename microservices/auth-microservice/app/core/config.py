from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/crm_production"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_SECRET: str  # без дефолта: сервис не стартует без заданного секрета
    SERVICE_PORT: int = 8001
    # Возвращать токен сброса пароля прямо в HTTP-ответе. ОПАСНО: любой, кто
    # знает email, сможет сбросить пароль (в т.ч. админский). По умолчанию ВЫКЛ.
    # Включать осознанно и только для окружений без почтового сервера. Сброс
    # админом всегда доступен через POST /api/auth/admin/reset-password.
    EXPOSE_RESET_TOKEN: bool = False

    class Config:
        env_file = ".env"


settings = Settings()
