"""Spec 026: each person's tour and getting started progress."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in

LONG = "long-enough-password"


def test_a_new_person_has_seen_nothing(client: TestClient) -> None:
    assert client.get("/api/me/onboarding").json() == {
        "tour_seen": False,
        "done": {},
        "hidden": False,
    }


def test_progress_is_kept_and_an_item_keeps_its_first_time(client: TestClient) -> None:
    first = client.patch("/api/me/onboarding", json={"tour_seen": True, "done": ["add_card"]})
    assert first.status_code == 200
    when = first.json()["done"]["add_card"]
    again = client.patch("/api/me/onboarding", json={"done": ["add_card", "focus"]}).json()
    assert again["tour_seen"] is True
    assert again["done"]["add_card"] == when
    assert set(again["done"]) == {"add_card", "focus"}
    assert client.get("/api/me/onboarding").json() == again


def test_hidden_and_shown_again(client: TestClient) -> None:
    assert client.patch("/api/me/onboarding", json={"hidden": True}).json()["hidden"] is True
    assert client.patch("/api/me/onboarding", json={"hidden": False}).json()["hidden"] is False


def test_unknown_item_is_refused(client: TestClient) -> None:
    assert client.patch("/api/me/onboarding", json={"done": ["fly"]}).status_code == 422


def test_each_person_has_their_own(client: TestClient) -> None:
    app = client.app
    url = client.post("/api/invites", json={"role": "member"}).json()["url"]
    ann = TestClient(app)
    ann.post(
        f"/api/invites/{url.split('=', 1)[1]}/accept",
        json={"username": "ann", "name": "Ann", "password": LONG},
    )
    client.patch("/api/me/onboarding", json={"tour_seen": True})
    assert ann.get("/api/me/onboarding").json()["tour_seen"] is False


def test_signed_out_is_refused() -> None:
    app = create_app(Settings(db_path=":memory:"))
    signed_in(app)
    assert TestClient(app).get("/api/me/onboarding").status_code == 401
