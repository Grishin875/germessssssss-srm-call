import time
from collections import defaultdict
from fastapi import Request, HTTPException

from app.core.config import settings


class InMemoryRateLimiter:
    def __init__(self):
        self._buckets: dict = defaultdict(list)

    def check(self, key: str, limit: int, window: int = 60):
        now = time.time()
        bucket = self._buckets[key]
        self._buckets[key] = [t for t in bucket if now - t < window]
        if len(self._buckets[key]) >= limit:
            raise HTTPException(status_code=429, detail="Слишком много запросов. Попробуйте позже.")
        self._buckets[key].append(now)


limiter = InMemoryRateLimiter()


def get_client_ip(request: Request) -> str:
    # X-Forwarded-For подделывается клиентом (можно слать любой и получать свежий
    # бакет → обход rate-limit). Доверяем XFF только при заданном числе доверенных
    # прокси: берём N-й элемент с конца — IP, записанный крайним доверенным прокси;
    # всё левее мог подставить клиент. По умолчанию (0) — реальный IP сокета.
    n = settings.TRUSTED_PROXY_COUNT
    if n > 0:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            parts = [p.strip() for p in forwarded.split(",") if p.strip()]
            if len(parts) >= n:
                return parts[-n]
    return request.client.host if request.client else "unknown"
