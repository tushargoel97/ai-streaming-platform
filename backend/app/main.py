from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine
from app.api.router import api_router
from app.api.websocket.chat import router as ws_chat_router
from app.api.websocket.player import router as ws_player_router
from app.tenant.middleware import TenantMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup — safety checks
    if settings.app_env == "production":
        if settings.jwt_secret_key == "change-me-in-production-use-a-strong-random-secret":
            raise RuntimeError("JWT_SECRET_KEY must be changed in production")
        if settings.admin_password == "admin123":
            raise RuntimeError("ADMIN_PASSWORD must be changed in production")
    yield
    # Shutdown
    await engine.dispose()


def create_app() -> FastAPI:
    application = FastAPI(
        title=settings.app_name,
        lifespan=lifespan,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
    )

    cors_origins = (
        ["*"] if settings.debug
        else [o.strip() for o in settings.frontend_url.split(",") if o.strip()]
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=not settings.debug,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(api_router, prefix="/api/v1")
    application.include_router(ws_chat_router)
    application.include_router(ws_player_router)

    application.add_middleware(TenantMiddleware)

    return application


app = create_app()
