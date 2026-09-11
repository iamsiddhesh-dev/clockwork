"""Settings loaded from .env (and real env vars in deployment)."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolved absolutely, not as the relative ".env" pydantic-settings
# defaults to: a relative path is read against the *current working
# directory*, so the app booted fine from apps/agent and died with three
# "field required" errors when uvicorn was launched from the repo root.
# The file lives next to the package regardless of where the process
# started, so say that. Real environment variables still win over it,
# which is what deployment uses.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    groq_api_key: str | None = None


settings = Settings()
