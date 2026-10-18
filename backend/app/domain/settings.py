import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field, SecretStr, field_validator

from app.domain.errors import JiraNotConfigured, SecretUnreadable, ValidationFailed
from app.domain.ports import CredentialRepo, SecretBox, SettingsRepo

Provider = Literal["demo", "jira"]
TokenState = Literal["none", "set", "unreadable"]
JiraKind = Literal["dc", "cloud"]

DEFAULT_INTERVAL_S = 30
# A kind guessed while the site was unreachable is asked again after this long.
KIND_RETRY_S = 60
# A person's GitHub token is stored for this address and is only ever sent there.
GITHUB_API_URL = "https://api.github.com"


def normalize_base_url(value: str) -> str:
    url = value.strip().rstrip("/")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("expected an http(s) URL like https://jira.example.com")
    return url


def origin(url: str) -> tuple[str, str, int | None]:
    parsed = urlparse(url)
    return parsed.scheme, (parsed.hostname or "").lower(), parsed.port


def _clean(token: SecretStr | None) -> str | None:
    """Blank means "keep the stored token"; pasted tokens often carry a newline."""
    plain = token.get_secret_value().strip() if token else ""
    return plain or None


def _pack(token: str, email: str | None) -> str:
    return json.dumps({"email": email, "token": token}) if email else token


def _unpack(plain: str) -> tuple[str, str | None]:
    """A Jira Cloud secret holds the e-mail too; a bare token is stored as is."""
    if plain.startswith("{"):
        try:
            body = json.loads(plain)
            return str(body["token"]), body.get("email") or None
        except (ValueError, KeyError, TypeError):
            pass
    return plain, None


class JiraIn(BaseModel):
    base_url: str = Field(max_length=500)
    token: SecretStr | None = None
    email: str | None = Field(default=None, max_length=320)

    @field_validator("base_url")
    @classmethod
    def _url(cls, value: str) -> str:
        return normalize_base_url(value)


class SettingsIn(BaseModel):
    provider: Provider | None = None
    refresh_interval_s: int | None = Field(default=None, ge=30, le=300)
    jira: JiraIn | None = None
    public_links: bool | None = None


class JiraView(BaseModel):
    base_url: str | None
    token_state: TokenState
    kind: JiraKind | None = None


LockedField = Literal["provider", "jira_base_url"]


class SettingsView(BaseModel):
    provider: Provider
    refresh_interval_s: int
    secret_key_configured: bool
    jira: JiraView
    # Whether board owners may make a public link.
    public_links: bool
    # Fields set in the environment, which the API does not change.
    locked: list[LockedField] = Field(default_factory=list)


@dataclass(frozen=True)
class JiraCredentials:
    base_url: str
    token: SecretStr
    # Jira Cloud signs in with the account's e-mail next to its API token.
    email: str | None = None
    kind: JiraKind = "dc"


class SettingsService:
    """Instance settings (provider, Jira URL, refresh interval) and each person's own token.

    A token is stored with the URL it was entered for and is only ever sent there: when the
    admin moves the instance to another Jira, every token waits to be entered again.
    """

    def __init__(
        self,
        repo: SettingsRepo,
        credentials: CredentialRepo,
        box: SecretBox,
        secret_key_configured: bool,
        on_token: Callable[[str], None] = lambda _: None,
        on_change: Callable[[], None] = lambda: None,
        on_public_off: Callable[[], None] = lambda: None,
        on_token_change: Callable[[str, str], None] = lambda _user, _source: None,
        env: dict[LockedField, str] | None = None,
        find_kind: Callable[[str], tuple[JiraKind, bool]] = lambda _url: ("dc", True),
    ) -> None:
        self._env = env or {}
        # Asks the site which Jira it is: (kind, whether the site answered).
        self._find_kind = find_kind
        self._guessed: dict[str, tuple[JiraKind, float]] = {}
        self._repo = repo
        self._credentials = credentials
        self._box = box
        self._secret_key_configured = secret_key_configured
        # Lets the log formatter mask the token wherever it might appear.
        self._on_token = on_token
        self._on_change = on_change
        # Guests already on a board must go when public links are switched off.
        self._on_public_off = on_public_off
        # What the old token read must not outlive it in the person's task cache.
        self._on_token_change = on_token_change

    def _secret(
        self, user_id: str, base_url: str | None, kind: str = "jira"
    ) -> tuple[TokenState, SecretStr | None, str | None]:
        stored = self._credentials.get(user_id, kind)
        if stored is None:
            return "none", None, None
        encrypted, token_url = stored
        if base_url is None or origin(token_url) != origin(base_url):
            return "unreadable", None, None
        try:
            token, email = _unpack(self._box.decrypt(encrypted))
        except SecretUnreadable:
            return "unreadable", None, None
        self._on_token(token)
        return "set", SecretStr(token), email

    def _token(
        self, user_id: str, base_url: str | None, kind: str = "jira"
    ) -> tuple[TokenState, SecretStr | None]:
        state, token, _ = self._secret(user_id, base_url, kind)
        return state, token

    def jira_kind(self, base_url: str | None = None) -> JiraKind | None:
        """The kind of the instance's Jira, or of another URL an admin is testing."""
        stored_url = self.base_url()
        url = base_url or stored_url
        if url is None:
            return None
        values = self._values()
        if url == stored_url and values.get("jira_kind_url") == url:
            known = values.get("jira_kind")
            if known in ("dc", "cloud"):
                return "cloud" if known == "cloud" else "dc"
        guessed = self._guessed.get(url)
        if guessed and guessed[1] > time.monotonic():
            return guessed[0]
        kind, sure = self._find_kind(url)
        if sure and url == stored_url:
            self._repo.set_many({"jira_kind": kind, "jira_kind_url": url})
        elif not sure:
            self._guessed[url] = (kind, time.monotonic() + KIND_RETRY_S)
        return kind

    def email(self, user_id: str) -> str | None:
        """The person's own Jira Cloud e-mail, stored with their token."""
        return self._secret(user_id, self.base_url())[2]

    def _values(self) -> dict[str, str]:
        return {**self._repo.get_all(), **self._env}

    def refresh_interval_s(self) -> int:
        return int(self._values().get("refresh_interval_s", DEFAULT_INTERVAL_S))

    def provider(self) -> Provider:
        return "jira" if self._values().get("provider") == "jira" else "demo"

    def base_url(self) -> str | None:
        return self._values().get("jira_base_url")

    def public_links(self) -> bool:
        return self._values().get("public_links") != "0"

    def token_state(self, user_id: str) -> TokenState:
        return self._token(user_id, self.base_url())[0]

    def view(self, user_id: str) -> SettingsView:
        values = self._values()
        return SettingsView(
            provider="jira" if values.get("provider") == "jira" else "demo",
            refresh_interval_s=int(values.get("refresh_interval_s", DEFAULT_INTERVAL_S)),
            secret_key_configured=self._secret_key_configured,
            jira=JiraView(
                base_url=values.get("jira_base_url"),
                token_state=self.token_state(user_id),
                kind=self.jira_kind(),
            ),
            public_links=values.get("public_links") != "0",
            locked=sorted(self._env),
        )

    def update(self, change: SettingsIn, user_id: str) -> SettingsView:
        """Instance settings; a token in the change becomes this person's own."""
        current = self._values()
        changes_locked = (
            "provider" in self._env
            and change.provider is not None
            and change.provider != current["provider"]
        ) or (
            "jira_base_url" in self._env
            and change.jira is not None
            and change.jira.base_url != current["jira_base_url"]
        )
        if changes_locked:
            raise ValidationFailed("This is set by the server in the environment.")
        values: dict[str, str | None] = {}
        if change.provider is not None:
            values["provider"] = change.provider
        if change.refresh_interval_s is not None:
            values["refresh_interval_s"] = str(change.refresh_interval_s)
        if change.jira is not None:
            values["jira_base_url"] = change.jira.base_url
        if change.public_links is not None:
            values["public_links"] = "1" if change.public_links else "0"
        self._repo.set_many(values)
        if change.jira is not None and (plain := _clean(change.jira.token)) is not None:
            self.set_token(user_id, SecretStr(plain), change.jira.email)
        if change.public_links is False:
            self._on_public_off()
        self._on_change()
        return self.view(user_id)

    def set_token(self, user_id: str, token: SecretStr, email: str | None = None) -> TokenState:
        plain = _clean(token)
        url = self.base_url()
        if plain is None:
            raise ValidationFailed("token: enter your personal access token")
        if url is None:
            raise JiraNotConfigured("An admin sets the Jira URL in Settings first.")
        email = self._cloud_email(user_id, url, email)
        self._credentials.set(user_id, "jira", self._box.encrypt(_pack(plain, email)), url)
        self._on_token_change(user_id, "jira")
        self._on_token(plain)
        self._on_change()
        return self.token_state(user_id)

    def remove_token(self, user_id: str) -> None:
        self._credentials.delete(user_id, "jira")
        self._on_token_change(user_id, "jira")
        self._on_change()

    def github_token_state(self, user_id: str) -> TokenState:
        return self._token(user_id, GITHUB_API_URL, "github")[0]

    def github_token(self, user_id: str) -> SecretStr | None:
        """The person's own GitHub token, or None when they have none that can be read."""
        return self._token(user_id, GITHUB_API_URL, "github")[1]

    def set_github_token(self, user_id: str, token: SecretStr) -> TokenState:
        plain = _clean(token)
        if plain is None:
            raise ValidationFailed("token: enter your personal access token")
        self._credentials.set(user_id, "github", self._box.encrypt(plain), GITHUB_API_URL)
        self._on_token_change(user_id, "github")
        self._on_token(plain)
        self._on_change()
        return self.github_token_state(user_id)

    def remove_github_token(self, user_id: str) -> None:
        self._credentials.delete(user_id, "github")
        self._on_token_change(user_id, "github")
        self._on_change()

    def _cloud_email(self, user_id: str, url: str, email: str | None) -> str | None:
        """The e-mail to sign in to Jira Cloud with: the one given, else the stored one."""
        if self.jira_kind(url) != "cloud":
            return None
        given = (email or "").strip()
        found = given or self._secret(user_id, url)[2]
        if not found:
            raise ValidationFailed("email: enter the e-mail of your Atlassian account")
        return found

    def jira_credentials(
        self,
        user_id: str,
        base_url: str | None = None,
        token: SecretStr | None = None,
        email: str | None = None,
    ) -> JiraCredentials:
        """This person's credentials, each overridable (used to test before saving)."""
        stored_url = self.base_url()
        try:
            url = normalize_base_url(base_url) if base_url else stored_url
        except ValueError as exc:
            raise ValidationFailed(str(exc)) from exc
        plain = _clean(token)
        stored_email: str | None = None
        if plain is not None:
            self._on_token(plain)
            secret: SecretStr | None = SecretStr(plain)
            if url and (not stored_url or origin(url) == origin(stored_url)):
                stored_email = self._secret(user_id, url)[2]
        else:
            if url and stored_url and origin(url) != origin(stored_url):
                raise JiraNotConfigured("Enter the token for this Jira URL.")
            state, secret, stored_email = self._secret(user_id, url)
            if state == "unreadable":
                raise JiraNotConfigured(
                    "Your stored token does not work here any more. Enter it again in Settings."
                )
        if not url:
            raise JiraNotConfigured("An admin sets the Jira URL in Settings first.")
        if secret is None:
            raise JiraNotConfigured("Connect your Jira token in Settings → My tracker.")
        kind = self.jira_kind(url) or "dc"
        if kind == "dc":
            return JiraCredentials(base_url=url, token=secret)
        # Basic auth carries the e-mail and token in every request, readable on plain HTTP.
        if urlparse(url).scheme != "https":
            raise ValidationFailed("base_url: Jira Cloud needs an https:// address")
        cloud_email = (email or "").strip() or stored_email
        if not cloud_email and plain is not None:
            raise ValidationFailed("email: enter the e-mail of your Atlassian account")
        if not cloud_email:
            raise JiraNotConfigured("Connect your Jira token in Settings → My tracker.")
        return JiraCredentials(base_url=url, token=secret, email=cloud_email, kind="cloud")
