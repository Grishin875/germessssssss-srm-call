import httpx
from fastapi import Request, Response, HTTPException
from app.core.config import settings
from app.core.rate_limiter import limiter, get_client_ip

# Route table: prefix → (target_base_url, rate_limit_per_min)
ROUTES = {
    "/api/auth/login":          (settings.AUTH_SERVICE_URL,      settings.RATE_LIMIT_AUTH),
    "/api/auth/register":       (settings.AUTH_SERVICE_URL,      settings.RATE_LIMIT_REGISTER),
    "/api/auth":                (settings.AUTH_SERVICE_URL,      settings.RATE_LIMIT_GENERAL),
    "/api/warehouse":           (settings.WAREHOUSE_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/production-stock":    (settings.WAREHOUSE_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/otk":                 (settings.OTK_SERVICE_URL,       settings.RATE_LIMIT_GENERAL),
    "/api/sc":                  (settings.OTK_SERVICE_URL,       settings.RATE_LIMIT_GENERAL),
    "/api/catalog":             (settings.PRODUCTS_SERVICE_URL,  settings.RATE_LIMIT_GENERAL),
    "/api/recipes":             (settings.PRODUCTS_SERVICE_URL,  settings.RATE_LIMIT_GENERAL),
    "/api/recipe-cases":         (settings.PRODUCTS_SERVICE_URL,  settings.RATE_LIMIT_GENERAL),
    "/api/recipe-stages":        (settings.PRODUCTS_SERVICE_URL,  settings.RATE_LIMIT_GENERAL),
    "/api/finished-goods":       (settings.PRODUCTS_SERVICE_URL,  settings.RATE_LIMIT_GENERAL),
    "/api/planning":            (settings.PRODUCTS_SERVICE_URL,  settings.RATE_LIMIT_GENERAL),
    "/api/stage-types":         (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/system-roles":        (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/order-statuses":      (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/status-transitions":  (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/priorities":          (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/notifications":       (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/audit-log":           (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/sla-rules":           (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/webhooks":            (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/notification-subscriptions": (settings.ADMIN_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/users":               (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/operators":           (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/activity":            (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/suggestions":         (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/tasks":               (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/shift-checklist":     (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/shifts":              (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/shift-schedules":     (settings.ADMIN_SERVICE_URL,     settings.RATE_LIMIT_GENERAL),
    "/api/custom-fields":       (settings.BUSINESS_LOGIC_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/route-templates":     (settings.BUSINESS_LOGIC_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/orders":              (settings.BUSINESS_LOGIC_SERVICE_URL, settings.RATE_LIMIT_CRITICAL),
    "/api/my-stages":            (settings.BUSINESS_LOGIC_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/my-orders":            (settings.BUSINESS_LOGIC_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/production":           (settings.BUSINESS_LOGIC_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/line-templates":      (settings.BUSINESS_LOGIC_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/firmware":            (settings.DOCUMENTS_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/smd":                 (settings.DOCUMENTS_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/documents":           (settings.DOCUMENTS_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
    "/api/shipment":            (settings.SHIPMENT_SERVICE_URL,  settings.RATE_LIMIT_GENERAL),
    "/api/integration":         (settings.SHAREHOLDER_SERVICE_URL, settings.RATE_LIMIT_GENERAL),
}

# Paths that don't require JWT
PUBLIC_PREFIXES = {"/api/auth/login", "/api/auth/register", "/api/auth/request-password-reset", "/api/auth/reset-password"}


def _match_route(path: str):
    # Longest prefix match
    best = None
    for prefix, target in ROUTES.items():
        if path.startswith(prefix):
            if best is None or len(prefix) > len(best[0]):
                best = (prefix, *target)
    return best  # (prefix, target_url, rate_limit) or None


async def proxy(request: Request) -> Response:
    path = request.url.path
    ip = get_client_ip(request)

    # General rate limit
    limiter.check(f"general:{ip}", settings.RATE_LIMIT_GENERAL)

    match = _match_route(path)
    if not match:
        raise HTTPException(status_code=404, detail="Маршрут не найден")

    _, target_url, route_limit = match
    limiter.check(f"route:{path}:{ip}", route_limit)

    # Build upstream URL
    qs = str(request.url.query)
    upstream = f"{target_url}{path}" + (f"?{qs}" if qs else "")

    # Forward headers (strip hop-by-hop)
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "transfer-encoding", "connection")
    }

    body = await request.body()

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=upstream,
                headers=headers,
                content=body,
            )
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail=f"Сервис недоступен: {target_url}")

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=dict(resp.headers),
        media_type=resp.headers.get("content-type"),
    )
