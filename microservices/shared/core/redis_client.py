import redis.asyncio as aioredis
from typing import Optional


_redis: Optional[aioredis.Redis] = None


async def get_redis(url: str) -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(url, decode_responses=True)
    return _redis


async def close_redis():
    global _redis
    if _redis:
        await _redis.close()
        _redis = None
