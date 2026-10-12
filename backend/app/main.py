import asyncio
import logging
import ssl
import time
from contextlib import asynccontextmanager
from functools import partial

import anyio.to_thread
import httpx
from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse

from app.adapters import password_file
from app.adapters.live.rooms import LiveRooms
from app.adapters.releases.github import GitHubReleaseFeed
from app.adapters.secrets.fernet import FernetSecretBox, NullSecretBox
from app.adapters.storage.sqlite import (
    Database,
    SqliteBoardRepo,
    SqliteCredentialRepo,
    SqliteDemoStatusRepo,
    SqliteInviteRepo,
    SqliteMemberRepo,
    SqliteSessionRepo,
    SqliteSettingsRepo,
    SqliteSnapshotRepo,
    SqliteUserRepo,
)
from app.adapters.tasks.demo import DemoTaskProvider
from app.adapters.tasks.github import GitHubReaders
from app.adapters.tasks.jira_dc import JiraDcProvider
from app.api.errors import register_error_handlers
from app.api.gate import PasswordGate
from app.api.routes import router
from app.config import Settings, get_settings
from app.domain import demo
from app.domain.accounts import Accounts
from app.domain.invites import Invites
from app.domain.members import Members
from app.domain.ports import ReleaseFeed
from app.domain.public import PublicLinks
from app.domain.refresh import RefreshService
from app.domain.sessions import Sessions
from app.domain.settings import LockedField, SettingsService, normalize_base_url
from app.domain.updates import UpdateService
from app.domain.upgrade import adopt_orphans, bootstrap_admin
from app.observability import (
    RequestContextMiddleware,
    metrics_response,
    register_secret,
    setup_logging,
)
from app.version import VERSION

log = logging.getLogger(__name__)

# The Fernet key is a plain SHA-256 of this string, so a short one is easy to brute-force.
MIN_SECRET_KEY_LENGTH = 32


def _jira_client(settings: Settings, transport: httpx.BaseTransport | None) -> httpx.Client:
    verify: ssl.SSLContext | bool = settings.jira_tls_verify
    if settings.jira_ca_bundle:
        verify = ssl.create_default_context(cafile=settings.jira_ca_bundle)
    return httpx.Client(
        verify=verify, timeout=httpx.Timeout(15.0, connect=5.0), transport=transport
    )


def _password(settings: Settings) -> str:
    """The first admin's password: TIKO_PASSWORD, or one generated into the password file."""
    if settings.tiko_password and settings.tiko_password.get_secret_value():
        password = settings.tiko_password.get_secret_value()
    else:
        password, created = password_file.load_or_create(settings.password_file)
        if created:
            # Printed once on purpose: without ENV this is the only way the owner learns it.
            log.warning("tiko password: %s (saved to %s)", password, settings.password_file)
        else:
            log.info("tiko password is in %s", settings.password_file)
    register_secret(password)
    return password


def _tracker_env(settings: Settings) -> dict[LockedField, str]:
    env: dict[LockedField, str] = {}
    if settings.tiko_tracker:
        env["provider"] = settings.tiko_tracker
    if settings.jira_base_url:
        # A typo here should stop the start, not surface later as failing cards.
        env["jira_base_url"] = normalize_base_url(settings.jira_base_url)
    return env


def create_app(
    settings: Settings | None = None,
    jira_transport: httpx.BaseTransport | None = None,
    github_transport: httpx.BaseTransport | None = None,
    release_feed: ReleaseFeed | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    setup_logging(settings.log_level)

    key = settings.tiko_secret_key.get_secret_value() if settings.tiko_secret_key else ""
    if key and len(key) < MIN_SECRET_KEY_LENGTH:
        log.warning("TIKO_SECRET_KEY is short; use openssl rand -base64 32")

    async def clean_demo(visitors: demo.DemoVisitors) -> None:
        while True:
            try:
                gone = await anyio.to_thread.run_sync(visitors.cleanup, time.time())
                if gone:
                    log.info("demo cleanup: %d visitors deleted", gone)
            except Exception:
                log.exception("demo cleanup failed")
            await asyncio.sleep(demo.CLEANUP_EVERY_S)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        cleaner = (
            asyncio.create_task(clean_demo(app.state.visitors)) if app.state.visitors else None
        )
        yield
        if cleaner:
            cleaner.cancel()
        # Open boards are saved and their sockets told to come back.
        await app.state.live.shutdown()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    db = Database(settings.db_path)
    users = SqliteUserRepo(db)
    member_repo = SqliteMemberRepo(db)
    app.state.boards = SqliteBoardRepo(db)
    app.state.live = LiveRooms(app.state.boards, member_repo)
    app.state.sessions = Sessions(
        SqliteSessionRepo(db),
        app.state.live,
        touch_demo=partial(demo.touch, users) if settings.tiko_demo else None,
    )
    app.state.accounts = Accounts(users, app.state.sessions)
    # None unless the instance takes demo visitors; routes and dependencies read the switch here.
    app.state.visitors = (
        demo.DemoVisitors(
            users, app.state.sessions, app.state.live, settings.tiko_demo_limit or demo.MAX_ALIVE
        )
        if settings.tiko_demo
        else None
    )
    app.state.board_limit = settings.tiko_board_limit
    app.state.invites = Invites(SqliteInviteRepo(db), app.state.accounts, app.state.sessions)
    created = bootstrap_admin(app.state.accounts, users, lambda: _password(settings))
    env_password = settings.tiko_password and settings.tiko_password.get_secret_value()
    if not created and env_password:
        log.info("TIKO_PASSWORD is not used once people exist; each signs in with their own")
    credentials = SqliteCredentialRepo(db)
    adopt_orphans(users, member_repo, credentials)
    app.state.members = Members(member_repo, users, app.state.live)
    # Added before the request context, so it runs inside it and 401s are logged and counted.
    app.add_middleware(PasswordGate, sessions=app.state.sessions)
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    app.state.snapshots = SqliteSnapshotRepo(db)
    box = FernetSecretBox(key) if key else NullSecretBox()
    app.state.refresher = RefreshService()
    service = SettingsService(
        SqliteSettingsRepo(db),
        credentials,
        box,
        secret_key_configured=bool(key),
        on_token=register_secret,
        on_change=app.state.refresher.reset,
        on_public_off=app.state.live.end_public,
        on_github_token=lambda user_id: app.state.snapshots.scoped(user_id).forget("github"),
        env=_tracker_env(settings),
    )
    app.state.settings = service
    app.state.public_links = PublicLinks(app.state.boards, service.public_links, app.state.live)
    app.state.demo = DemoTaskProvider(SqliteDemoStatusRepo(db) if settings.tiko_demo else None)
    client = _jira_client(settings, jira_transport)
    # Built per request from the signed-in person's own token.
    app.state.jira = lambda creds: JiraDcProvider(lambda: creds, client)
    app.state.check_jira = lambda creds: JiraDcProvider(lambda: creds, client).check()
    github_token = settings.github_token.get_secret_value().strip() if settings.github_token else ""
    if github_token:
        register_secret(github_token)
    # A renamed repository answers with a redirect to its new name.
    github_client = httpx.Client(
        timeout=httpx.Timeout(15.0, connect=5.0), transport=github_transport, follow_redirects=True
    )
    app.state.github_readers = GitHubReaders(github_client, github_token or None)
    # The reader of public repositories: guests and people without a token of their own.
    app.state.github = app.state.github_readers.shared
    if release_feed is None and settings.update_check:
        release_feed = GitHubReleaseFeed("tiko-run/tiko", httpx.Client(timeout=5.0))
    app.state.updates = UpdateService(VERSION, release_feed if settings.update_check else None)
    app.include_router(router)

    @app.get("/health", include_in_schema=False)
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/ready", include_in_schema=False)
    def ready() -> JSONResponse:
        checks = {"db": db.ping()}
        status = 200 if all(checks.values()) else 503
        return JSONResponse({"ready": status == 200, "checks": checks}, status_code=status)

    @app.get("/metrics", include_in_schema=False)
    def metrics() -> Response:
        return metrics_response()

    return app
