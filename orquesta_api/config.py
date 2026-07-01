"""Application settings loaded from environment / .env file."""

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central config for orquesta_api; all fields can be overridden via env vars."""

    database_url: str = "sqlite+aiosqlite:///./orquesta_api.db"
    run_executor: str = "local"
    workspaces_dir: str = "./workspaces"
    orq_lite_image: str = "orq-lite:latest"
    orq_lite_bin: str = "orq-lite"
    flows_path: str = "./flows.json"
    team_path: str = "./team.json"
    auth_token: SecretStr = SecretStr("")
    github_webhook_secret: str = ""
    opencode_server_url: str = ""
    creds_mounts: str = "~/.claude,~/.codex,~/.gemini"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
