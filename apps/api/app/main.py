from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .legacy import LegacyBridge
from .routers import bootstrap, health, library, rooms, telemetry


def create_application() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url=settings.docs_url,
        openapi_url=settings.openapi_url,
    )
    app.state.legacy_bridge = LegacyBridge()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.parsed_cors_allow_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(bootstrap.router, prefix=settings.api_prefix)
    app.include_router(rooms.router, prefix=settings.api_prefix)
    app.include_router(library.router, prefix=settings.api_prefix)
    app.include_router(telemetry.router, prefix=settings.api_prefix)

    @app.get("/", include_in_schema=False)
    def api_index() -> dict[str, str]:
        return {
            "name": settings.app_name,
            "version": settings.app_version,
            "docs": settings.docs_url,
            "openapi": settings.openapi_url,
        }

    @app.on_event("shutdown")
    def close_legacy_bridge() -> None:
        app.state.legacy_bridge.close()

    return app


app = create_application()
