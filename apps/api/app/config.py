from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Regatta API"
    app_version: str = "3.0.0"
    api_prefix: str = "/api/v1"
    docs_url: str = "/api/docs"
    openapi_url: str = "/api/openapi.json"
    cors_allow_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    model_config = SettingsConfigDict(
        env_prefix="FASTAPI_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def parsed_cors_allow_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
