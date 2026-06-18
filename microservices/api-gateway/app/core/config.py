from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    JWT_SECRET: str  # без дефолта: сервис не стартует без заданного секрета
    SERVICE_PORT: int = 8000

    AUTH_SERVICE_URL: str = "http://auth:8001"
    WAREHOUSE_SERVICE_URL: str = "http://warehouse:8005"
    OTK_SERVICE_URL: str = "http://otk:8002"
    PRODUCTS_SERVICE_URL: str = "http://products:8003"
    ADMIN_SERVICE_URL: str = "http://admin:8004"
    SHIPMENT_SERVICE_URL: str = "http://shipment:8006"
    DOCUMENTS_SERVICE_URL: str = "http://documents:8007"
    BUSINESS_LOGIC_SERVICE_URL: str = "http://business-logic:8008"
    SHAREHOLDER_SERVICE_URL: str = "http://integration:8009"

    RATE_LIMIT_GENERAL: int = 200       # req/min
    RATE_LIMIT_AUTH: int = 10
    RATE_LIMIT_REGISTER: int = 5
    RATE_LIMIT_CRITICAL: int = 30

    # Сколько доверенных обратных прокси стоит перед gateway. 0 = брать реальный
    # IP сокета (X-Forwarded-For игнорируется, не подделать). Если перед gateway
    # стоит, например, один nginx/TLS-терминатор — поставить 1.
    TRUSTED_PROXY_COUNT: int = 0

    class Config:
        env_file = ".env"


settings = Settings()
