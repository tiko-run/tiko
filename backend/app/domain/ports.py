from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.domain.accounts import Person, PersonRecord, Role
    from app.domain.boards import BoardDoc, BoardRecord, BoardRow
    from app.domain.invites import Invite
    from app.domain.jql import JqlValue, JqlVocabulary
    from app.domain.members import BoardRole, Member, ShareRole
    from app.domain.onboarding import Onboarding
    from app.domain.planning import (
        IndexedStage,
        PlanningField,
        PlanningPerson,
        SavedView,
        StageType,
        TimeOff,
    )
    from app.domain.tasks import Task
    from app.domain.updates import Release, UpdaterStatus


class TaskProvider(Protocol):
    source_id: str
    """Stable tracker id, such as "jira"; the sync status is reported per id."""
    source_name: str
    source_note: str | None
    """Shown next to the sync status, such as a slower pace without a token."""

    @property
    def base_host(self) -> str: ...

    def resolve(self, key: str) -> Task:
        """Raises TaskNotFound when the task is missing or not visible."""
        ...

    def poll(self, keys: list[str]) -> list[Task]:
        """Missing keys come back with state="not_found"."""
        ...

    def check(self) -> str:
        """Display name of the authenticated user."""
        ...

    def search(self, jql: str, limit: int) -> tuple[list[Task], int]:
        """Up to `limit` matching tasks and the total match count; raises InvalidJql."""
        ...

    def jql_vocabulary(self) -> JqlVocabulary:
        """Fields the user can search, with their operators, and JQL functions."""
        ...

    def jql_values(self, field: str, prefix: str) -> list[JqlValue]: ...


class BoardRepo(Protocol):
    def listing(
        self, user_id: str, board_id: str | None = None, others: bool = False
    ) -> list[BoardRow]:
        """The boards this person has a role on, or one board, by last change, with their
        role and the owner. `others` adds every other board, except those of demo visitors."""
        ...

    def owned(self, user_id: str) -> int:
        """How many boards the person owns."""
        ...

    def owner(self, board_id: str) -> str | None: ...

    def create(
        self, name: str, doc: BoardDoc, owner_id: str, limit: int | None = None
    ) -> str | None:
        """Returns the new board's id; None when the owner already holds `limit` boards."""
        ...

    def create_welcome(self, user_id: str, name: str, doc: BoardDoc) -> str | None:
        """Creates the person's welcome board once, only while they own no board."""
        ...

    def get(self, board_id: str) -> BoardRecord | None: ...

    def save(self, board_id: str, version: int, doc: BoardDoc, ydoc: bytes | None = None) -> int:
        """Compare-and-set on version; raises NotFound or VersionConflict, returns new version.

        The doc and its CRDT state are written together; without a state the stored one is
        cleared, so the two never disagree.
        """
        ...

    def load(self, board_id: str) -> tuple[BoardRecord, bytes | None] | None:
        """The board with its CRDT state, for opening it live."""
        ...

    def save_live(self, board_id: str, doc: BoardDoc, ydoc: bytes) -> int:
        """Saves an open board whatever the stored version; raises NotFound, returns new version."""
        ...

    def keep_live_state(self, board_id: str, ydoc: bytes) -> None:
        """Stores the first live state of a board nobody edited: no new version; raises NotFound."""
        ...

    def rename(self, board_id: str, name: str) -> None:
        """Leaves the doc version alone so open tabs keep saving; raises NotFound."""
        ...

    def delete(self, board_id: str) -> None:
        """Raises NotFound."""
        ...

    def public_token(self, board_id: str) -> str | None: ...

    def ensure_public_token(self, board_id: str, token: str) -> str | None:
        """Stores the token unless the board has one already, and returns the stored one;
        None when the board is gone. One step, so two callers end up with the same link."""
        ...

    def clear_public_token(self, board_id: str) -> str | None:
        """Removes the board's token and returns it."""
        ...

    def by_public_token(self, token: str) -> tuple[str, int, str] | None:
        """The id, version and last change time of the board with this public link."""
        ...


class Attempts(Protocol):
    """Counts of what is limited (wrong passwords, requests of a link) by scope and key, shared
    by every process of the instance. Times are seconds of the wall clock."""

    def recent(self, scope: str, key: str, since: float) -> tuple[int, float]:
        """How many events later than `since` are counted, and the time of the oldest."""
        ...

    def add(self, scope: str, key: str, at: float, since: float) -> None:
        """Counts an event; the scope forgets what it holds from `since` or earlier."""
        ...

    def add_under(self, scope: str, key: str, limit: int, at: float, since: float) -> float | None:
        """Counts an event unless `limit` later than `since` are counted already; then nothing
        is counted and the time of the oldest comes back. One step."""
        ...

    def spend(self, scope: str, key: str, limit: int, window_s: float, at: float) -> float | None:
        """Takes one of the `limit` requests of the key's window, which opens at its first
        request and lasts `window_s`. A spent window returns the time it opened. One step."""
        ...

    def drop(self, scope: str, key: str) -> None:
        """Forgets the key's window."""
        ...


class KnownBrowsers(Protocol):
    """Browsers a person signed in from, by the hash of their cookie's token."""

    def add(self, token_hash: str, user_id: str, at: float, since: float) -> None:
        """Keeps a browser; forgets those added at `since` or earlier."""
        ...

    def owner(self, token_hash: str, since: float) -> str | None:
        """The person of a browser added later than `since`."""
        ...

    def forget(self, user_id: str) -> None:
        """Forgets every browser of a person."""
        ...


class LiveBoards(Protocol):
    """Open sockets of live boards. Every call returns at once and is safe from any thread."""

    def end_session(self, token: str) -> None:
        """Closes the sockets opened with this session."""
        ...

    def end_person(self, user_id: str, keep_token: str | None = None) -> None:
        """Closes the person's sockets, except those of the session to keep."""
        ...

    def recheck_person(self, user_id: str) -> None:
        """The person's account changed: their sockets reconnect with the new rights."""
        ...

    def recheck_board(self, board_id: str) -> None:
        """Access to the board changed: sockets whose role is no longer the same are closed."""
        ...

    def end_public(self, board_id: str | None = None) -> None:
        """The public link of the board, or of every board, stopped working: its guests'
        sockets are closed."""
        ...

    def planning_changed(self) -> None:
        """People on every open board are told to read `/api/planning` again."""
        ...

    def put(self, board_id: str, version: int, doc: BoardDoc) -> int:
        """A REST save, applied to the shared document as one update so people on the board
        see it; compare-and-set on version like `BoardRepo.save`."""
        ...


class MemberRepo(Protocol):
    def roles(
        self, board_id: str, user_id: str
    ) -> tuple[BoardRole | None, ShareRole | None] | None:
        """The person's own role and the board's "everyone" role; None when the board is gone."""
        ...

    def role(self, board_id: str, user_id: str) -> BoardRole | None: ...

    def members(self, board_id: str) -> list[Member]: ...

    def everyone(self, board_id: str) -> ShareRole | None: ...

    def set_role(self, board_id: str, user_id: str, role: BoardRole) -> None: ...

    def remove(self, board_id: str, user_id: str) -> None: ...

    def set_everyone(self, board_id: str, role: ShareRole | None) -> None: ...

    def transfer(self, board_id: str, user_id: str) -> None: ...

    def adopt_orphans(self, owner_id: str) -> None:
        """Makes this person the owner of every board without one, as after an upgrade."""
        ...


class CredentialRepo(Protocol):
    def get(self, user_id: str, provider: str) -> tuple[str, str] | None:
        """The encrypted token and the URL it was entered for."""
        ...

    def set(self, user_id: str, provider: str, token_enc: str, base_url: str) -> None: ...

    def delete(self, user_id: str, provider: str) -> None: ...

    def adopt_instance_token(self, user_id: str) -> None:
        """Moves the token and task cache from before accounts to this person, once."""
        ...


class SnapshotRepo(Protocol):
    def scoped(self, owner: str) -> SnapshotRepo:
        """The snapshots of one person."""
        ...

    def get_many(self, refs: list[str]) -> dict[str, Task]:
        """The cached tasks among these refs, by ref."""
        ...

    def put_many(self, tasks: list[Task]) -> None: ...

    def forget(self, source: str) -> None:
        """Drops the cached tasks of one tracker."""
        ...


class SecretBox(Protocol):
    def encrypt(self, plain: str) -> str:
        """Raises SecretKeyMissing when no key is configured."""
        ...

    def decrypt(self, token: str) -> str:
        """Raises SecretUnreadable when the key is missing or different."""
        ...


class SettingsRepo(Protocol):
    def get_all(self) -> dict[str, str]: ...

    def set_many(self, values: dict[str, str | None]) -> None:
        """None deletes the key."""
        ...


class PlanningTypeRepo(Protocol):
    def all(self) -> list[StageType]:
        """In the order they were added."""
        ...

    def add(self, stage_type: StageType) -> None: ...

    def update(self, stage_type: StageType) -> None: ...


class PlanningPeopleRepo(Protocol):
    def all(self) -> list[PlanningPerson]:
        """In the order they were added."""
        ...

    def add(self, person: PlanningPerson) -> None: ...

    def update(self, person: PlanningPerson) -> None:
        """Name, teams and archived; time off changes through its own methods."""
        ...

    def add_off(self, person_id: str, off: TimeOff, limit: int) -> bool:
        """False, and nothing stored, when the person already has `limit` ranges."""
        ...

    def remove_off(self, person_id: str, off_id: str) -> None: ...


class PlanningFieldRepo(Protocol):
    def all(self) -> list[PlanningField]:
        """The standard fields first, then the others in the order they were added."""
        ...

    def add(self, field: PlanningField, limit: int) -> bool:
        """False, and nothing stored, when there are `limit` fields besides the standard ones."""
        ...

    def update(self, field: PlanningField) -> None: ...


class PlanningStageRepo(Protocol):
    def for_person(self, person_id: str) -> list[IndexedStage]:
        """The person's stages on every board, from the index saved with each board."""
        ...


class PlanningViewRepo(Protocol):
    def all(self) -> list[SavedView]:
        """In the order they were saved."""
        ...

    def add(self, view: SavedView, limit: int) -> bool:
        """False, and nothing stored, at `limit` views or when the name is taken."""
        ...

    def remove(self, view_id: str) -> bool:
        """False when there was no such view."""
        ...


class DemoTasks(Protocol):
    def set_status(self, key: str, status: str) -> Task: ...


class DemoStatusRepo(Protocol):
    def get(self, user_id: str) -> dict[str, tuple[str, str]]:
        """The statuses this person changed: key to status and the time of the change."""
        ...

    def set(self, user_id: str, key: str, status: str, updated_at: str) -> None: ...


class ReleaseFeed(Protocol):
    def releases(self) -> list[Release]:
        """Recent published releases; raises DependencyUnavailable when they can't be fetched."""
        ...


class UsageCounts(Protocol):
    def people(self) -> int:
        """Active accounts: no demo visitors, no disabled people."""
        ...

    def boards(self) -> int: ...

    def boards_active(self, since: str) -> int:
        """Boards changed by someone after `since`; a board as it was made does not count."""
        ...

    def sources(self) -> set[str]:
        """Trackers the cards on this instance were read from."""
        ...


class StatsSender(Protocol):
    def send(self, body: dict) -> None:
        """Raises DependencyUnavailable when the collector cannot be reached."""
        ...


class Updater(Protocol):
    """The service that swaps the running containers for a release; DependencyUnavailable when
    it does not answer, as on an install without it."""

    def status(self) -> UpdaterStatus: ...

    def start(self, version: str, current: str) -> UpdaterStatus:
        """The updater copies the database itself once the old API has stopped writing."""
        ...


class UpdateBackups(Protocol):
    def free_and_needed(self, version: str) -> tuple[int, int]:
        """Free bytes next to the database and the bytes its copy before an update from
        `version` needs."""
        ...


class UserRepo(Protocol):
    def count(self) -> int: ...

    def add(self, person: Person, password_hash: str) -> None:
        """Raises UsernameTaken."""
        ...

    def find(self, username: str) -> tuple[Person, str] | None:
        """The person and their password hash, matching the username without regard to case."""
        ...

    def update(self, person: Person) -> None:
        """Saves name and username; raises UsernameTaken."""
        ...

    def set_password(self, user_id: str, password_hash: str) -> None: ...

    def onboarding(self, user_id: str) -> Onboarding: ...

    def set_onboarding(self, user_id: str, state: Onboarding) -> None: ...

    def get(self, user_id: str) -> Person | None: ...

    def list(self) -> list[PersonRecord]: ...

    def set_role(self, user_id: str, role: Role) -> None: ...

    def set_disabled(self, user_id: str, disabled: bool) -> None: ...

    def active_admins(self) -> int: ...

    def touch_sign_in(self, user_id: str) -> None: ...

    def touch_demo(self, user_id: str, until: str) -> bool:
        """Moves a demo visitor's expiry; False for anyone who is not a demo visitor."""
        ...

    def sign_up_demo(self, user_id: str, username: str, name: str, password_hash: str) -> bool:
        """Turns a demo visitor into a regular member in place; False when they are not a demo
        visitor any more. Raises UsernameTaken."""
        ...

    def delete_unused_members(self, before: str) -> tuple[list[str], list[str]]:
        """Deletes everyone but admins and demo visitors who last signed in before this time,
        with their boards; returns the ids of the people and of the boards that went."""
        ...

    def demo_alive(self, now: str) -> int: ...

    def delete_expired_demo(self, now: str, untouched: str) -> tuple[list[str], list[str]]:
        """Deletes demo visitors whose expiry is before `now`, or before `untouched` when they
        changed nothing, with their boards, sessions, statuses and cache in one step; returns
        the ids of the people and of the boards that went."""
        ...

    def evict_untouched_demo(self) -> tuple[list[str], list[str]]:
        """Deletes the demo visitor who changed nothing and is closest to expiry, if any."""
        ...


class SessionRepo(Protocol):
    def add(self, token_hash: str, user_id: str, expires_at: str, created_at: str) -> None: ...

    def get(self, token_hash: str) -> tuple[Person, str] | None:
        """The person and the session's expiry."""
        ...

    def delete(self, token_hash: str) -> None: ...

    def delete_for_user(self, user_id: str, keep: str | None) -> None: ...

    def delete_expired(self, now: str) -> None: ...


class InviteRepo(Protocol):
    def add(self, invite: Invite, token_hash: str, created_by: str) -> None: ...

    def find_open(self, token_hash: str, now: str) -> Invite | None:
        """Not used, not revoked and not expired."""
        ...

    def consume(self, invite_id: str, now: str) -> bool:
        """Marks it used; False when another request used it first."""
        ...

    def unconsume(self, invite_id: str) -> None: ...

    def pending(self, now: str) -> list[Invite]: ...

    def revoke(self, invite_id: str, now: str) -> bool:
        """False when no open invite has this id."""
        ...
