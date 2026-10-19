import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.accounts import (
    BROWSER_TTL_S,
    INSTANCE_FAILURES,
    PER_ADDRESS_FAILURES,
    PER_BROWSER_FAILURES,
    PER_USERNAME_FAILURES,
    Accounts,
)
from app.domain.attempts import BROWSERS_PER_PERSON
from app.domain.errors import InvalidCredentials, TooManyAttempts
from app.domain.sessions import Sessions
from app.main import create_app
from tests.conftest import PASSWORD

NOW = 1_800_000_000.0
LONG = "long-enough-password"


@pytest.fixture
def accounts(store) -> Accounts:
    mod, db = store
    accounts = Accounts(
        mod.UserRepo(db), Sessions(mod.SessionRepo(db)), browsers=mod.KnownBrowsers(db)
    )
    accounts.create("alice", "Alice", LONG, "member")
    accounts.create("bob", "Bob", LONG, "member")
    return accounts


def fail(accounts: Accounts, times: int, username: str = "alice", address: str = "", **kw):
    for i in range(times):
        with pytest.raises(InvalidCredentials):
            accounts.sign_in(username, "nope", NOW + i * 0.01, address=address, **kw)


def test_a_first_sign_in_gives_the_browser_a_token_and_a_known_one_keeps_it(accounts):
    _, browser = accounts.sign_in("alice", LONG, NOW)
    assert browser
    _, again = accounts.sign_in("alice", LONG, NOW + 1, browser=browser)
    assert again is None


def test_a_known_browser_signs_in_while_others_fill_the_username_limit(accounts):
    _, browser = accounts.sign_in("alice", LONG, NOW)
    fail(accounts, PER_USERNAME_FAILURES, address="198.51.100.1")
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, NOW + 1)
    assert accounts.sign_in("alice", LONG, NOW + 1, browser=browser)


def test_a_known_browser_signs_in_while_others_fill_the_instance_limit(accounts):
    _, browser = accounts.sign_in("alice", LONG, NOW)
    for n in range(INSTANCE_FAILURES):
        with pytest.raises(InvalidCredentials):
            accounts.sign_in(f"guess{n}", "nope", NOW + n * 0.01, address=f"198.51.100.{n}")
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("bob", LONG, NOW + 1)
    assert accounts.sign_in("alice", LONG, NOW + 1, browser=browser)


def test_a_browser_known_for_someone_else_is_not_known_here(accounts):
    _, browser = accounts.sign_in("bob", LONG, NOW)
    fail(accounts, PER_USERNAME_FAILURES)
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, NOW + 1, browser=browser)


def test_wrong_passwords_from_a_known_browser_make_it_unknown(accounts):
    _, browser = accounts.sign_in("alice", LONG, NOW)
    fail(accounts, PER_USERNAME_FAILURES, address="198.51.100.1")
    fail(accounts, PER_BROWSER_FAILURES, browser=browser)
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, NOW + 1, browser=browser)


def test_a_password_change_forgets_the_browsers(accounts):
    _, browser = accounts.sign_in("alice", LONG, NOW)
    person = accounts.people()[0]
    accounts.set_password(person.id, "another-long-password")
    fail(accounts, PER_USERNAME_FAILURES)
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", "another-long-password", NOW + 1, browser=browser)


def test_disabling_a_person_forgets_their_browsers(accounts):
    _, browser = accounts.sign_in("alice", LONG, NOW)
    alice = next(p for p in accounts.people() if p.username == "alice")
    accounts.change(alice.id, None, True)
    accounts.change(alice.id, None, False)
    fail(accounts, PER_USERNAME_FAILURES)
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, NOW + 1, browser=browser)


def test_a_browser_is_known_for_a_year(accounts):
    _, browser = accounts.sign_in("alice", LONG, NOW)
    later = NOW + BROWSER_TTL_S
    for i in range(PER_USERNAME_FAILURES):
        with pytest.raises(InvalidCredentials):
            accounts.sign_in("alice", "nope", later + i * 0.01)
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, later + 1, browser=browser)


def test_only_the_newest_browsers_of_a_person_stay_known(accounts):
    _, first = accounts.sign_in("alice", LONG, NOW)
    for i in range(BROWSERS_PER_PERSON):
        accounts.sign_in("alice", LONG, NOW + 1 + i)
    fail(accounts, PER_USERNAME_FAILURES)
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, NOW + 100, browser=first)


def test_wrong_passwords_from_one_address_hold_up_that_address_only(accounts):
    for n in range(PER_ADDRESS_FAILURES):
        username = "alice" if n % 2 else "bob"
        with pytest.raises(InvalidCredentials):
            accounts.sign_in(username, "nope", NOW + n * 0.01, address="198.51.100.7")
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, NOW + 1, address="198.51.100.7")
    assert accounts.sign_in("alice", LONG, NOW + 1, address="198.51.100.8")


def test_an_ipv6_address_is_counted_by_its_64(accounts):
    for n in range(PER_ADDRESS_FAILURES):
        with pytest.raises(InvalidCredentials):
            accounts.sign_in(f"guess{n}", "nope", NOW + n * 0.01, address=f"2001:db8::{n + 1}")
    with pytest.raises(TooManyAttempts):
        accounts.sign_in("alice", LONG, NOW + 1, address="2001:db8::ffff")


def test_the_api_sets_the_browser_cookie_once():
    client = TestClient(create_app(Settings(db_path=":memory:")))
    body = {"username": "admin", "password": PASSWORD}
    first = client.post("/api/auth/login", json=body)
    assert first.status_code == 204
    cookie = first.headers.get_list("set-cookie")
    assert any(c.startswith("tiko_device=") and "HttpOnly" in c for c in cookie)
    client.post("/api/auth/logout")
    again = client.post("/api/auth/login", json=body)
    assert again.status_code == 204
    assert not any(c.startswith("tiko_device=") for c in again.headers.get_list("set-cookie"))
