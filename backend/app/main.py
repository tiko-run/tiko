import asyncio
import logging
import platform
import random
import ssl
import time
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path

import anyio.to_thread
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from sentry_sdk.transport import Transport

from app.adapters import password_file
from app.adapters.errors import sentry as error_reports
from app.adapters.live.rooms import LiveRooms
from app.adapters.live.workers import Workers
from app.adapters.releases.github import GitHubReleaseFeed
from app.adapters.secrets.fernet import FernetSecretBox, NullSecretBox
from app.adapters.stats.http import HttpStatsSender
from app.adapters.storage.lock import FileLock
from app.adapters.storage.sqlite import (
    Database,
    SqliteAttempts,
    SqliteBoardRepo,
    SqliteCredentialRepo,
    SqliteDemoStatusRepo,
    SqliteInviteRepo,
    SqliteMemberRepo,
    SqlitePlanningFieldRepo,
    SqlitePlanningPeopleRepo,
    SqlitePlanningStageRepo,
    SqlitePlanningTypeRepo,
    SqlitePlanningViewRepo,
    SqliteSessionRepo,
    SqliteSettingsRepo,
    SqliteSnapshotRepo,
    SqliteUsageCounts,
    SqliteUserRepo,
)
from app.adapters.storage.update_backups import SqliteUpdateBackups
from app.adapters.tasks.demo import DemoTaskProvider
from app.adapters.tasks.github import GitHubReaders
from app.adapters.tasks.jira_dc import JiraDcProvider
from app.adapters.updater.http import HttpUpdater, ensure_token
from app.api.errors import register_error_handlers
from app.api.gate import PasswordGate
from app.api.routes import router
from app.config import DEFAULT_DB_PATH, Settings, get_settings
from app.domain import demo, usage
from app.domain.accounts import Accounts
from app.domain.errors import NotFound
from app.domain.invites import Invites
from app.domain.members import Members
from app.domain.planning import Planning
from app.domain.ports import ReleaseFeed, StatsSender, Updater
from app.domain.public import PublicLinks
from app.domain.refresh import RefreshService
from app.domain.sessions import Sessions, iso
from app.domain.settings import LockedField, SettingsService, normalize_base_url
from app.domain.updates import OneClickUpdate, UpdateService
from app.domain.upgrade import adopt_orphans, bootstrap_admin
from app.domain.usage import Deploy, Privacy
from app.observability import (
    DEMO_LIMIT,
    DEMO_VISITORS,
    LIVE_OUTBOX,
    LIVE_ROOMS,
    LIVE_SOCKETS,
    THREADS_BUSY,
    RequestContextMiddleware,
    metrics_response,
    register_secret,
    serve_metrics,
    setup_logging,
    watch_loop,
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


def _deploy(settings: Settings, hosting: str | None) -> Deploy:
    if settings.tiko_demo:
        return "demo"
    if settings.tiko_deploy:
        return settings.tiko_deploy
    return hosting if hosting in ("railway", "render") else "compose"


def _arch() -> str:
    machine = platform.machine().lower()
    return {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(
        machine, "other"
    )


async def ping_daily(privacy: Privacy, sleep=asyncio.sleep) -> None:
    await sleep(usage.FIRST_PING_S)
    while True:
        try:
            await anyio.to_thread.run_sync(privacy.send_ping)
        except Exception:
            # Usage stats never make noise in the log of the instance they describe.
            log.debug("usage ping failed", exc_info=True)
        await sleep(usage.PING_EVERY_S + random.uniform(0, usage.PING_JITTER_S))


def create_app(
    settings: Settings | None = None,
    jira_transport: httpx.BaseTransport | None = None,
    github_transport: httpx.BaseTransport | None = None,
    release_feed: ReleaseFeed | None = None,
    updater: Updater | None = None,
    stats_sender: StatsSender | None = None,
    error_transport: type[Transport] | None = None,
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
        # One process cleans up for all of them.
        cleaner = (
            asyncio.create_task(clean_demo(app.state.visitors))
            if app.state.visitors and settings.tiko_worker == 0
            else None
        )
        watcher = asyncio.create_task(watch_loop(live_gauges))
        # One ping per instance, not per process.
        pinger = (
            asyncio.create_task(ping_daily(app.state.privacy))
            if settings.tiko_worker == 0
            else None
        )
        if workers:
            await workers.listen()
        # Each process counts its own, so each has a port: Prometheus reads them all.
        port = settings.tiko_metrics_port and settings.tiko_metrics_port + settings.tiko_worker
        if port and not metrics_token:
            log.warning(
                "TIKO_METRICS_PORT is set without TIKO_METRICS_TOKEN: the port stays closed"
            )
        listener = (
            serve_metrics(port, metrics_token, demo_gauges) if port and metrics_token else None
        )
        yield
        if listener:
            await anyio.to_thread.run_sync(listener.shutdown)
            listener.server_close()
        watcher.cancel()
        if pinger:
            pinger.cancel()
        if cleaner:
            cleaner.cancel()
        if workers:
            await workers.close()
        # Open boards are saved and their sockets told to come back.
        await rooms.shutdown()

    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    db = Database(settings.db_path)
    users = SqliteUserRepo(db)
    member_repo = SqliteMemberRepo(db)
    app.state.boards = SqliteBoardRepo(db)
    rooms = LiveRooms(app.state.boards, member_repo)
    workers = (
        Workers(rooms, settings.tiko_worker, settings.tiko_workers, settings.tiko_workers_dir)
        if settings.tiko_workers > 1 and settings.tiko_workers_dir
        else None
    )
    app.state.live = workers or rooms
    attempts = SqliteAttempts(db)
    app.state.sessions = Sessions(
        SqliteSessionRepo(db),
        app.state.live,
        touch_demo=partial(demo.touch, users) if settings.tiko_demo else None,
    )
    if workers:
        # The other processes keep sessions for 30 s too.
        workers.heard("end_session", app.state.sessions.uncache)
        workers.heard("end_person", app.state.sessions.uncache_person)
        workers.heard("recheck_person", app.state.sessions.uncache_person)
    app.state.accounts = Accounts(users, app.state.sessions, attempts)
    # None unless the instance takes demo visitors; routes and dependencies read the switch here.
    app.state.visitors = (
        demo.DemoVisitors(
            users,
            app.state.sessions,
            app.state.live,
            settings.tiko_demo_limit or demo.MAX_ALIVE,
            attempts,
            None if settings.db_path == ":memory:" else FileLock(f"{settings.db_path}.demo-lock"),
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
    metrics_token = (
        settings.tiko_metrics_token.get_secret_value().strip()
        if settings.tiko_metrics_token
        else ""
    )
    if metrics_token:
        register_secret(metrics_token)
    app.add_middleware(PasswordGate, sessions=app.state.sessions, metrics_token=metrics_token)
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    app.state.snapshots = SqliteSnapshotRepo(db)
    box = FernetSecretBox(key) if key else NullSecretBox()
    app.state.refresher = RefreshService()

    def tracker_changed() -> None:
        app.state.refresher.reset()
        if workers:
            workers.tell("tracker_changed")

    if workers:
        workers.heard("tracker_changed", app.state.refresher.reset)
    service = SettingsService(
        SqliteSettingsRepo(db),
        credentials,
        box,
        secret_key_configured=bool(key),
        on_token=register_secret,
        on_change=tracker_changed,
        on_public_off=app.state.live.end_public,
        on_github_token=lambda user_id: app.state.snapshots.scoped(user_id).forget("github"),
        env=_tracker_env(settings),
    )
    app.state.settings = service
    app.state.planning = Planning(
        SqliteSettingsRepo(db),
        SqlitePlanningTypeRepo(db),
        SqlitePlanningPeopleRepo(db),
        SqlitePlanningFieldRepo(db),
        SqlitePlanningViewRepo(db),
        SqlitePlanningStageRepo(db),
        on_change=app.state.live.planning_changed,
    )
    app.state.public_links = PublicLinks(
        app.state.boards, service.public_links, app.state.live, attempts=attempts
    )
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
    # The updater sees the install folder, so it finds the database and the token only at the
    # default path; a demo instance is updated by its operator, never from the page.
    if (
        updater is None
        and settings.updater_url
        and not settings.tiko_demo
        and Path(settings.db_path) == Path(DEFAULT_DB_PATH)
    ):
        token = ensure_token(Path(db.path).parent / "updater-token")
        updater = HttpUpdater(settings.updater_url, token, httpx.Client(timeout=5.0))
    hosting = (
        "railway" if settings.railway_environment_name else "render" if settings.render else None
    )
    app.state.one_click = OneClickUpdate(
        app.state.updates, updater, SqliteUpdateBackups(db.path), VERSION, hosting
    )
    if stats_sender is None:
        stats_sender = HttpStatsSender(settings.tiko_stats_url, httpx.Client(timeout=5.0))
    deploy = _deploy(settings, hosting)
    app.state.privacy = Privacy(
        SqliteSettingsRepo(db),
        SqliteUsageCounts(db),
        stats_sender,
        VERSION,
        deploy,
        _arch(),
        updater=updater is not None,
        usage_env=settings.tiko_usage_stats,
        errors_env=settings.tiko_error_reports,
        errors_dsn=settings.tiko_error_reports_dsn,
    )
    # Turned off in the environment, the SDK is not even started.
    app.state.error_tunnel = None
    if settings.tiko_error_reports_dsn and settings.tiko_error_reports is not False:
        app.state.error_tunnel = error_reports.SentryTunnel(
            settings.tiko_error_reports_dsn, httpx.Client(timeout=5.0)
        )
        error_reports.start(
            settings.tiko_error_reports_dsn,
            app.state.privacy.errors_enabled,
            VERSION,
            deploy,
            transport=error_transport,
        )
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
    async def metrics(request: Request) -> Response:
        # The numbers tell how busy the instance is: for its admins and its monitoring only.
        person = getattr(request.state, "person", None)
        if not (getattr(request.state, "scraper", False) or (person and person.role == "admin")):
            raise NotFound("not found")
        live_gauges()
        await anyio.to_thread.run_sync(demo_gauges)
        # Rendering reads /proc and walks every metric: off the loop, where sockets are served.
        return await anyio.to_thread.run_sync(metrics_response)

    def live_gauges() -> None:
        # On the loop, where the rooms live.
        open_rooms, people, guests, fullest = rooms.stats()
        LIVE_ROOMS.set(open_rooms)
        LIVE_SOCKETS.labels("person").set(people)
        LIVE_SOCKETS.labels("guest").set(guests)
        LIVE_OUTBOX.set(fullest)
        THREADS_BUSY.set(anyio.to_thread.current_default_thread_limiter().borrowed_tokens)

    def demo_gauges() -> None:
        # Reads the database: for a worker thread or the thread of the metrics port.
        visitors = app.state.visitors
        if visitors is not None:
            DEMO_VISITORS.set(users.demo_alive(iso(time.time())))
            DEMO_LIMIT.set(visitors.max_alive)

    return app
