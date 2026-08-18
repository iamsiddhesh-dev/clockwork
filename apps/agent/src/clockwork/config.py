"""Settings loaded from .env (and real env vars in deployment)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    aws_region: str = "us-east-1"

    # Dev-time model provider switch. "bedrock" is the real target (see
    # PLAN.md's model routing table); "groq" is a temporary stand-in while
    # the Bedrock account-level hold is pending -- same Role interface,
    # same call sites, swap back by changing this one setting.
    model_provider: str = "bedrock"
    groq_api_key: str | None = None


settings = Settings()
