"""Application settings loaded from environment / .env file."""

from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central config for orquesta_api; all fields can be overridden via env vars."""

    env: str = "development"
    database_url: str = "sqlite+aiosqlite:///./orquesta_api.db"
    run_executor: str = "local"
    workspaces_dir: str = "./workspaces"
    orq_lite_image: str = "orq-lite:latest"
    orq_lite_bin: str = "orq-lite"
    flows_path: str = "./flows.json"
    team_path: str = "./team.json"
    auth_token: SecretStr = SecretStr("")
    github_webhook_secret: str = ""
    anthropic_api_key: SecretStr = SecretStr("")
    chat_model: str = "claude-sonnet-5"
    creds_mounts: str = "~/.claude,~/.codex,~/.gemini"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide settings, constructed once."""
    return Settings()


settings = get_settings()
