from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.v1.endpoints.auth import router as auth_router
from shared.core.database import make_engine, make_session_factory, Base
from shared.core.security import decode_token
from app.services.user_service import get_user_by_id
from app.models.user import User  # noqa: register with Base.metadata

engine = make_engine(settings.DATABASE_URL)
session_factory = make_session_factory(engine)

PUBLIC_PATHS = {"/api/auth/login", "/api/auth/register", "/api/auth/request-password-reset", "/api/auth/reset-password", "/health", "/docs", "/openapi.json"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="Auth Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://crmb3.ru", "http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def db_and_auth_middleware(request: Request, call_next) -> Response:
    async with session_factory() as session:
        request.state.db = session
        request.state.current_user = None

        path = request.url.path
        if path not in PUBLIC_PATHS:
            auth_header = request.headers.get("Authorization", "")
            token = auth_header.replace("Bearer ", "") if auth_header.startswith("Bearer ") else ""
            if token:
                payload = decode_token(token, settings.JWT_SECRET)
                if payload:
                    user = await get_user_by_id(session, payload.get("id"))
                    if user and user.is_active:
                        request.state.current_user = user

        try:
            response = await call_next(request)
            await session.commit()
        except Exception:
            await session.rollback()
            raise
    return response


app.include_router(auth_router, prefix="/api/auth", tags=["auth"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "auth"}
