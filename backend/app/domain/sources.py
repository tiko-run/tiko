"""Every tracker tiko reads, described once.

A new tracker is an adapter, one `Source` here and one line where `api/deps.py` builds the
providers. Nothing else in `api/` or `domain/` asks which tracker a key belongs to.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse

from app.domain.errors import AmbiguousKey, DomainError, InvalidRef, ValidationFailed
from app.domain.ports import KnowsPrefixes, SnapshotRepo, TaskProvider
from app.domain.tasks import (
    CALDAV,
    GITHUB,
    GITHUB_KEY_RE,
    KEY_RE,
    LINEAR,
    LINEAR_KEY_RE,
    NotConnected,
    Task,
    github_key,
    github_url,
    linear_key,
    linear_url,
    parse_ref,
    valid_uid,
)


def _jira_key(key: str) -> bool:
    return bool(KEY_RE.match(key))


def _no_link(key: str, base_url: str | None) -> str:
    return ""


def _jira_link(key: str, base_url: str | None) -> str:
    return f"{base_url}/browse/{key}" if base_url else ""


@dataclass(frozen=True)
class Source:
    id: str
    # The tracker's name inside a sentence: "GitHub has no search here".
    name: str
    # Whether a key, as stored on a card, has this tracker's shape.
    valid: Callable[[str], bool] = _jira_key
    # The key in a link or a typed ref that only this tracker uses, read on any instance;
    # None for the instance's own tracker, which takes whatever no other source claims.
    own_ref: Callable[[str], str | None] | None = None
    # The page a guest may follow for a task they cannot read; `base_url` is the instance's Jira.
    guest_link: Callable[[str, str | None], str] = _no_link
    # The kind a person's credential for it is stored under, when it needs one.
    credential: str | None = None
    # For a tracker read with one personal token: the only address the token is sent to.
    token_url: str | None = None
    # Its name in usage stats; None for a tracker the stats do not count.
    usage: str | None = None
    # False when the key is an id that means nothing to people, so a preview leaves it out.
    readable_key: bool = True
    # How a search reaches it: a query in the tracker's terms, words of the title, or not at all.
    search: Literal["query", "titles"] | None = "query"
    # Whether its keys start with a project or team key a bare key like `ENG-12` may name.
    prefixes: bool = False


SOURCES: dict[str, Source] = {
    source.id: source
    for source in (
        Source(
            id="jira",
            name="Jira",
            guest_link=_jira_link,
            credential="jira",
            usage="jira_dc",
            prefixes=True,
        ),
        Source(id="demo", name="the demo tracker", usage="demo"),
        Source(
            id=CALDAV,
            name="CalDAV",
            valid=valid_uid,
            credential=CALDAV,
            readable_key=False,
            search="titles",
        ),
        Source(
            id=GITHUB,
            name="GitHub",
            valid=lambda key: bool(GITHUB_KEY_RE.match(key)),
            own_ref=github_key,
            guest_link=lambda key, _: github_url(key),
            credential=GITHUB,
            token_url="https://api.github.com",
            usage=GITHUB,
            search=None,
        ),
        Source(
            id=LINEAR,
            name="Linear",
            valid=lambda key: bool(LINEAR_KEY_RE.match(key)),
            own_ref=linear_key,
            guest_link=lambda key, _: linear_url(key),
            credential=LINEAR,
            token_url="https://api.linear.app",
            usage=LINEAR,
            search=None,
            prefixes=True,
        ),
    )
}


def valid_key(source: str | None, key: str) -> bool:
    """Whether the key has the shape its tracker uses; a missing source is the instance's."""
    found = SOURCES.get(source or "")
    return found.valid(key) if found else bool(KEY_RE.match(key))


def readable_key(source: str | None) -> bool:
    found = SOURCES.get(source or "")
    return found.readable_key if found else True


def guest_link(source: str, key: str, base_url: str | None) -> str:
    found = SOURCES.get(source)
    return found.guest_link(key, base_url) if found else ""


PREFIX_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,29}$")


def prefix_choice(prefix: str, source: str) -> tuple[str, str]:
    """A remembered choice as stored: a key prefix and a tracker whose keys have one."""
    prefix = prefix.strip().upper()
    if not PREFIX_RE.match(prefix):
        raise ValidationFailed("prefix: expected a project or team key like ENG")
    found = SOURCES.get(source)
    if found is None or not found.prefixes:
        raise ValidationFailed(f"source: {source} has no key prefixes")
    return prefix, source


def credential_kinds() -> list[str]:
    return [s.credential for s in SOURCES.values() if s.credential]


def token_source(source_id: str) -> Source:
    """A tracker a person reads with one token of their own; any other id is a mistake."""
    found = SOURCES.get(source_id)
    if found is None or found.token_url is None:
        raise ValidationFailed(f"source: {source_id} takes no token here")
    return found


def jira_not_connected(base_url: str | None, reason: DomainError) -> NotConnected:
    """Jira while the person has no usable token: cards keep their key and link to the site."""
    return NotConnected(
        "jira",
        "Jira Data Center",
        reason,
        lambda key: _jira_link(key, base_url),
        urlparse(base_url or "").hostname or "",
    )


def route_ref(
    ref: str,
    providers: dict[str, TaskProvider],
    default_source: str,
    chosen: Callable[[str], str | None] | None = None,
    source: str | None = None,
) -> tuple[str, str]:
    """The tracker and the key a typed ref or a link names: a link or key only one tracker
    uses goes to it on any instance; a bare key to the tracker that knows its prefix, or the
    one the person chose; everything else to the instance's tracker."""
    if source is not None:
        return _named(ref, source, providers, default_source)
    for found in SOURCES.values():
        if found.own_ref and found.id in providers and (key := found.own_ref(ref)):
            return found.id, key
    if default_source not in providers:
        raise InvalidRef(f"This tiko does not read {default_source}.")
    if claim := _by_prefix(ref, providers, default_source, chosen):
        return claim
    return default_source, parse_ref(ref, providers[default_source].base_host)


def _named(
    ref: str, source: str, providers: dict[str, TaskProvider], default_source: str
) -> tuple[str, str]:
    """A ref sent with the tracker it belongs to, as after the prefix dialog."""
    provider = providers.get(source)
    if provider is None:
        raise InvalidRef(f"This tiko does not read {source}.")
    found = SOURCES.get(source)
    if found and found.own_ref and (key := found.own_ref(ref)):
        return source, key
    if source == default_source:
        return source, parse_ref(ref, provider.base_host)
    identifier = ref.strip().upper()
    if isinstance(provider, KnowsPrefixes) and KEY_RE.match(identifier):
        return source, provider.key_for(identifier)
    raise InvalidRef(f"{ref} is not a {found.name if found else source} task.")


def _by_prefix(
    ref: str,
    providers: dict[str, TaskProvider],
    default_source: str,
    chosen: Callable[[str], str | None] | None,
) -> tuple[str, str] | None:
    """The tracker of a bare key like `ENG-12` when a tracker besides the instance's knows the
    prefix; None leaves it to the instance's tracker, with no question asked of any."""
    identifier = ref.strip().upper()
    if not KEY_RE.match(identifier):
        return None
    prefix = identifier.rpartition("-")[0]
    # Only the trackers a person connected can answer: without one nothing is asked.
    known = [
        p
        for sid, p in providers.items()
        if sid != default_source and isinstance(p, KnowsPrefixes) and p.has_prefix(prefix)
    ]
    if not known:
        return None
    default = providers[default_source]
    # A tracker that could not be asked may still know the prefix, so it stays a choice.
    default_knows = default.has_prefix(prefix) if isinstance(default, KnowsPrefixes) else False
    claims: dict[str, KnowsPrefixes] = {p.source_id: p for p in known}
    if default_knows is not False and isinstance(default, KnowsPrefixes):
        claims = {default_source: default, **claims}
    pick = next(iter(claims)) if len(claims) == 1 else (chosen(prefix) if chosen else None)
    if pick in claims:
        return pick, claims[pick].key_for(identifier)
    names = " and ".join(SOURCES[s].name if s in SOURCES else s for s in claims)
    refs = " or ".join(f"{s}:{p.key_for(identifier)}" for s, p in claims.items())
    raise AmbiguousKey(f"{prefix} is known to {names}: write {refs}.", prefix, list(claims))


def resolve_task(
    ref: str,
    providers: dict[str, TaskProvider],
    default_source: str,
    snapshots: SnapshotRepo,
    chosen: Callable[[str], str | None] | None = None,
    source: str | None = None,
) -> Task:
    source, key = route_ref(ref, providers, default_source, chosen, source)
    task = providers[source].resolve(key)
    snapshots.put_many([task])
    return task
