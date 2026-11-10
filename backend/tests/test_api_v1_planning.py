"""Planning through API v1 (spec 047, slice api-planning)."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key, with_key
from tests.test_planning import member, plan_board, staged


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:"))


@pytest.fixture
def admin(app) -> TestClient:
    return signed_in(app)


def add_person(client: TestClient, name: str, **body) -> str:
    response = client.post("/api/planning/people", json={"name": name, **body})
    assert response.status_code == 200, response.json()
    return response.json()["id"]


def type_id(client: TestClient, name: str) -> str:
    types = client.get("/api/planning").json()["types"]
    return next(t["id"] for t in types if t["name"] == name)


def test_planning_off_says_only_that(app, admin):
    admin.patch("/api/planning", json={"enabled": False})
    key = with_key(app, make_key(admin)["token"])
    assert key.get("/api/v1/planning").json() == {"enabled": False}
    response = key.get("/api/v1/planning/people/nobody/workload")
    assert (response.status_code, response.json()["error"]["code"]) == (404, "not_found")


def test_a_key_for_all_boards_reads_the_whole_plan_from_today_on(app, admin):
    today = date.today()
    ivan = add_person(admin, "Ivan", teams=["Web"])
    for start, end in ((today - timedelta(days=30), today - timedelta(days=20)), (today, today)):
        admin.post(
            f"/api/planning/people/{ivan}/off",
            json={"start": start.isoformat(), "end": end.isoformat()},
        )
    past, coming = today - timedelta(days=3), today + timedelta(days=3)
    admin.put("/api/planning/days-off", json={"dates": [past.isoformat(), coming.isoformat()]})
    key = with_key(app, make_key(admin)["token"])
    body = key.get("/api/v1/planning").json()
    assert body["enabled"] is True
    assert "views" not in body
    person = next(p for p in body["people"] if p["id"] == ivan)
    assert (person["name"], person["teams"], person["archived"]) == ("Ivan", ["Web"], False)
    assert person["off"] == [{"start": today.isoformat(), "end": today.isoformat()}]
    assert body["days_off"] == [coming.isoformat()]
    assert {"Discovery", "Build"} <= {t["name"] for t in body["types"]}
    assert {f["name"] for f in body["fields"]} >= {"Priority", "Size", "Team"}


def test_a_key_for_chosen_boards_reads_only_what_they_draw(app, admin):
    build = type_id(admin, "Build")
    ivan, olga, pete = (add_person(admin, n) for n in ("Ivan", "Olga", "Pete"))
    rows = [
        {
            "id": "r1",
            "title": "API",
            "start": "2026-10-05",
            "end": "2026-10-09",
            "stages": [
                {
                    "id": "s",
                    "type": build,
                    "start": "2026-10-05",
                    "end": "2026-10-09",
                    "people": [ivan],
                },
            ],
        }
    ]
    chosen = plan_board(admin, "Chosen", rows)
    plan_board(admin, "Other", [staged("r2", "UI", olga, "2026-10-05", "2026-10-09")])
    key = with_key(app, make_key(admin, boards=[chosen])["token"])
    body = key.get("/api/v1/planning").json()
    assert [p["name"] for p in body["people"]] == ["Ivan"]
    assert [t["name"] for t in body["types"]] == ["Build"]
    assert body["fields"] == []
    for person in (olga, pete):
        response = key.get(f"/api/v1/planning/people/{person}/workload")
        assert response.status_code == 404
    assert key.get(f"/api/v1/planning/people/{ivan}/workload").status_code == 200


def test_workload_hides_and_for_chosen_boards_drops_what_the_key_does_not_reach(app, admin):
    ivan = add_person(admin, "Ivan")
    build = type_id(admin, "Build")
    rows = lambda row, start, end: [  # noqa: E731
        {
            "id": row,
            "title": row,
            "start": start,
            "end": end,
            "stages": [{"id": "s", "type": build, "start": start, "end": end, "people": [ivan]}],
        }
    ]
    mine = plan_board(admin, "Mine", rows("Payment API", "2026-10-19", "2026-10-30"))
    ann = member(admin)
    theirs = plan_board(ann, "Theirs", rows("Checkout UI", "2026-10-26", "2026-11-06"))
    path = f"/api/v1/planning/people/{ivan}/workload?from=2026-10-14&weeks=4"

    everything = with_key(app, make_key(admin)["token"]).get(path).json()
    assert everything["person"] == {"id": ivan, "name": "Ivan"}
    assert [w["stages"] for w in everything["weeks"]] == [0, 1, 2, 1]
    seen, hidden = everything["stages"]
    assert (seen["board_name"], seen["type"]) == ("Mine", {"id": build, "name": "Build"})
    # A key acts as a member: the admin's key does not reach a board shared with nobody.
    assert hidden == {
        "board": None,
        "board_name": None,
        "row": None,
        "type": None,
        "start": "2026-10-26",
        "end": "2026-11-06",
    }

    chosen = with_key(app, make_key(admin, boards=[mine, theirs])["token"]).get(path).json()
    # Theirs is chosen but the admin has no role there: it is not counted.
    assert [w["stages"] for w in chosen["weeks"]] == [0, 1, 1, 0]
    assert [s["board_name"] for s in chosen["stages"]] == ["Mine"]
