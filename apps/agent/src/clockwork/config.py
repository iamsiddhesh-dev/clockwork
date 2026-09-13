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

    # Browser origins allowed to call this API, comma-separated. Defaults to
    # the local dev server; a deployment sets it to the frontend's real URL.
    # A trailing slash is tolerated here because the browser never sends one
    # and a copy-pasted "https://clockwork.vercel.app/" would otherwise match
    # nothing and look exactly like CORS being broken.
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Optional pattern for origins that change per deploy -- Vercel preview
    # URLs, for instance. Unset means exact origins only.
    allowed_origin_regex: str | None = None

    # Shared secret for POST /tasks/tick, the endpoint an external schedule
    # calls because a serverless deployment has no process to run a timer in.
    # Unset means the endpoint refuses everything rather than running open.
    cron_secret: str | None = None


def parse_origins(raw: str | None) -> list[str]:
    """`"https://a.app/, http://localhost:3000"` -> exact origins, no slashes.

    Kept separate from Settings so it can be tested without constructing one.
    """
    if not raw:
        return []
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


settings = Settings()
