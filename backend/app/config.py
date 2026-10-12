from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # A variable left empty, as .env.example has them, means its default.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    app_name: str = "tiko"
    app_env: str = "local"
    log_level: str = "info"
    db_path: str = "data/app.db"
    tiko_secret_key: SecretStr | None = None
    tiko_password: SecretStr | None = None
    # Holds the generated password when TIKO_PASSWORD is empty.
    password_file: str = "data/password"
    # Set at deploy time, these win over Settings → Task source and lock it there.
    tiko_tracker: Literal["demo", "jira"] | None = None
    jira_base_url: str | None = None
    jira_tls_verify: bool = True
    jira_ca_bundle: str | None = None
    # Optional and read-only: raises GitHub's request limit for public issues from 60 to 5000
    # an hour. It is shared by everyone, so private repositories are never read with it.
    github_token: SecretStr | None = None
    # Asks GitHub for the latest release every 6 hours to show "update available".
    update_check: bool = True
    # Anyone starts without an account as a demo visitor, on the demo tasks, until they sign up.
    tiko_demo: bool = False
    # Demo visitors the instance keeps at once. Empty: 500.
    tiko_demo_limit: int | None = Field(default=None, ge=1)
    # Boards a person may own, admins aside. Empty: no limit.
    tiko_board_limit: int | None = Field(default=None, ge=1)


@lru_cache
def get_settings() -> Settings:
    return Settings()
