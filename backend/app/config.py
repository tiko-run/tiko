from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
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
    # Asks GitHub for new releases every 30 minutes to show "update available".
    update_check: bool = True
    # The updater service of compose.release.yml, set there; empty: no one-click update.
    updater_url: str = ""
    # Set by the platforms themselves, so About can say how to update there.
    railway_environment_name: str | None = None
    render: bool = False
    # Lets a monitoring system read /metrics with `Authorization: Bearer <token>`, no account.
    tiko_metrics_token: SecretStr | None = None
    # A second listener for /metrics, on a thread of its own, that answers the token while the
    # server is too busy to. Empty: none.
    tiko_metrics_port: int | None = Field(default=None, ge=1, le=65535)
    # API processes, one core each; the web container needs the same number to pick the process
    # of a board. Metrics of process N are on TIKO_METRICS_PORT + N.
    tiko_workers: int = Field(default=1, ge=1, le=64)
    # Set by the starter for each process, never by hand: which of them this is, and the
    # directory of the sockets they talk to each other through.
    tiko_worker: int = Field(default=0, ge=0)
    tiko_workers_dir: str | None = None
    # A directory shared with the proxy: each process also listens on <port>.sock in it.
    tiko_socket_dir: str | None = None
    # Anyone starts without an account as a demo visitor, on the demo tasks, until they sign up.
    tiko_demo: bool = False
    # Demo visitors the instance keeps at once. Empty: 500.
    tiko_demo_limit: int | None = Field(default=None, ge=1)
    # Boards a person may own, admins aside. Empty: no limit.
    tiko_board_limit: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _metrics_ports_fit(self) -> Self:
        # Each process has a metrics port of its own, counted up from the first.
        if self.tiko_metrics_port and self.tiko_metrics_port + self.tiko_workers - 1 > 65535:
            raise ValueError("TIKO_METRICS_PORT leaves no port for every one of TIKO_WORKERS")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
