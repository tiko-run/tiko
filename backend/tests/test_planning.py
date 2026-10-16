"""Spec 027: the Planning switch, the stage type library and the people directory."""

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in

LONG = "long-enough-password"


def member(client: TestClient) -> TestClient:
    url = client.post("/api/invites", json={"role": "member"}).json()["url"]
    ann = TestClient(client.app)
    ann.post(
        f"/api/invites/{url.split('=', 1)[1]}/accept",
        json={"username": "ann", "name": "Ann", "password": LONG},
    )
    return ann


def test_off_by_default(client: TestClient) -> None:
    assert client.get("/api/planning").json() == {"enabled": False, "types": [], "people": []}


def test_first_enable_seeds_the_default_types(client: TestClient) -> None:
    view = client.patch("/api/planning", json={"enabled": True}).json()
    assert view["enabled"] is True
    names = [t["name"] for t in view["types"]]
    assert names == ["Discovery", "Design", "Build", "Review", "On hold"]
    client.patch("/api/planning", json={"enabled": False})
    again = client.patch("/api/planning", json={"enabled": True}).json()
    assert [t["id"] for t in again["types"]] == [t["id"] for t in view["types"]]


def test_off_keeps_the_types_hidden(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    client.patch("/api/planning", json={"enabled": False})
    assert client.get("/api/planning").json()["types"] == []


def test_only_an_admin_switches(client: TestClient) -> None:
    ann = member(client)
    assert ann.patch("/api/planning", json={"enabled": True}).status_code == 403
    client.patch("/api/planning", json={"enabled": True})
    assert ann.get("/api/planning").json()["enabled"] is True


def test_a_member_adds_renames_and_archives_a_type(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    ann = member(client)
    added = ann.post("/api/planning/types", json={"name": " Testing ", "hue": 200})
    assert added.status_code == 200
    body = added.json()
    assert body["name"] == "Testing" and body["hue"] == 200 and body["archived"] is False
    renamed = ann.patch(f"/api/planning/types/{body['id']}", json={"name": "QA", "hue": 340})
    assert renamed.json()["name"] == "QA" and renamed.json()["hue"] == 340
    archived = ann.patch(f"/api/planning/types/{body['id']}", json={"archived": True}).json()
    assert archived["archived"] is True
    names = [t["name"] for t in client.get("/api/planning").json()["types"]]
    assert names[-1] == "QA"


def test_type_rules(client: TestClient) -> None:
    assert client.post("/api/planning/types", json={"name": "QA", "hue": 200}).status_code == 422
    client.patch("/api/planning", json={"enabled": True})
    assert client.post("/api/planning/types", json={"name": "build", "hue": 200}).status_code == 422
    assert client.post("/api/planning/types", json={"name": "QA", "hue": 13}).status_code == 422
    assert client.post("/api/planning/types", json={"name": "", "hue": 200}).status_code == 422
    assert client.post("/api/planning/types", json={"name": "x" * 41, "hue": 25}).status_code == 422
    assert client.patch("/api/planning/types/nope", json={"name": "QA"}).status_code == 404


def test_an_archived_name_can_be_used_again(client: TestClient) -> None:
    types = client.patch("/api/planning", json={"enabled": True}).json()["types"]
    review = next(t for t in types if t["name"] == "Review")
    client.patch(f"/api/planning/types/{review['id']}", json={"archived": True})
    assert client.post("/api/planning/types", json={"name": "Review", "hue": 60}).status_code == 200


def test_signed_out_is_refused() -> None:
    app = create_app(Settings(db_path=":memory:"))
    signed_in(app)
    assert TestClient(app).get("/api/planning").status_code == 401


def test_no_planning_on_a_demo_instance() -> None:
    admin = signed_in(create_app(Settings(db_path=":memory:", tiko_demo=True)))
    assert admin.patch("/api/planning", json={"enabled": True}).status_code == 403
    assert admin.post("/api/planning/people", json={"name": "Ivan"}).status_code == 403
    assert admin.get("/api/planning").json()["enabled"] is False


def test_a_member_adds_renames_and_archives_a_person(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    ann = member(client)
    added = ann.post("/api/planning/people", json={"name": " Petra ", "teams": ["Web", "web"]})
    assert added.status_code == 200
    petra = added.json()
    assert petra == {
        "id": petra["id"],
        "name": "Petra",
        "teams": ["Web"],
        "source": "manual",
        "archived": False,
        "off": [],
    }
    oleg = ann.post("/api/planning/people", json={"name": "Oleg", "source": "tracker"}).json()
    assert oleg["source"] == "tracker" and oleg["teams"] == []
    changed = ann.patch(
        f"/api/planning/people/{petra['id']}", json={"name": "Petra K", "teams": ["Core"]}
    ).json()
    assert changed["name"] == "Petra K" and changed["teams"] == ["Core"]
    ann.patch(f"/api/planning/people/{petra['id']}", json={"archived": True})
    people = client.get("/api/planning").json()["people"]
    assert [(p["name"], p["archived"]) for p in people] == [("Petra K", True), ("Oleg", False)]


def test_person_rules(client: TestClient) -> None:
    assert client.post("/api/planning/people", json={"name": "Ivan"}).status_code == 422
    client.patch("/api/planning", json={"enabled": True})
    people = "/api/planning/people"
    assert client.post(people, json={"name": ""}).status_code == 422
    assert client.post(people, json={"name": "x" * 81}).status_code == 422
    assert client.post(people, json={"name": "Ivan", "teams": ["t"] * 11}).status_code == 422
    assert client.post(people, json={"name": "Ivan", "teams": ["x" * 41]}).status_code == 422
    assert client.post(people, json={"name": "Ivan", "source": "chat"}).status_code == 422
    assert client.post(people, json={"name": "Ivan", "role": "lead"}).status_code == 422
    assert client.patch(f"{people}/nope", json={"name": "Ivan"}).status_code == 404


def test_off_keeps_the_people_hidden(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    client.post("/api/planning/people", json={"name": "Ivan"})
    client.patch("/api/planning", json={"enabled": False})
    assert client.get("/api/planning").json()["people"] == []
    client.patch("/api/planning", json={"enabled": True})
    assert [p["name"] for p in client.get("/api/planning").json()["people"]] == ["Ivan"]


def test_every_write_tells_open_boards(client: TestClient, monkeypatch) -> None:
    told: list[None] = []
    service = client.app.state.planning
    monkeypatch.setattr(service, "_on_change", lambda: told.append(None))
    client.patch("/api/planning", json={"enabled": True})
    person = client.post("/api/planning/people", json={"name": "Ivan"}).json()
    client.patch(f"/api/planning/people/{person['id']}", json={"archived": True})
    stage_type = client.post("/api/planning/types", json={"name": "QA", "hue": 200}).json()
    client.patch(f"/api/planning/types/{stage_type['id']}", json={"hue": 60})
    client.post("/api/planning/people", json={"name": ""})
    path = f"/api/planning/people/{person['id']}/off"
    off = client.post(path, json={"start": "2026-10-05", "end": "2026-10-09"}).json()["off"][0]
    client.delete(f"{path}/{off['id']}")
    assert len(told) == 7


def test_a_member_adds_and_removes_time_off(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    ann = member(client)
    anna = ann.post("/api/planning/people", json={"name": "Anna"}).json()
    path = f"/api/planning/people/{anna['id']}/off"
    ann.post(path, json={"start": "2026-11-02", "end": "2026-11-06"})
    added = ann.post(path, json={"start": "2026-10-05", "end": "2026-10-09"})
    assert added.status_code == 200
    off = added.json()["off"]
    assert [(o["start"], o["end"]) for o in off] == [
        ("2026-10-05", "2026-10-09"),
        ("2026-11-02", "2026-11-06"),
    ]
    assert set(off[0]) == {"id", "start", "end"}
    left = ann.delete(f"{path}/{off[0]['id']}").json()["off"]
    assert [o["id"] for o in left] == [off[1]["id"]]
    stored = client.get("/api/planning").json()["people"][0]["off"]
    assert stored == left


def test_time_off_rules(client: TestClient, monkeypatch) -> None:
    client.patch("/api/planning", json={"enabled": True})
    anna = client.post("/api/planning/people", json={"name": "Anna"}).json()
    path = f"/api/planning/people/{anna['id']}/off"
    week = {"start": "2026-10-05", "end": "2026-10-09"}
    assert client.post(path, json={"start": "2026-10-09", "end": "2026-10-05"}).status_code == 422
    assert client.post(path, json={"start": "Oct 5", "end": "2026-10-09"}).status_code == 422
    assert client.post(path, json={**week, "reason": "sick"}).status_code == 422
    assert client.post("/api/planning/people/nope/off", json=week).status_code == 404
    assert client.delete(f"{path}/nope").status_code == 404
    assert client.post(path, json={"start": "2026-10-05", "end": "2026-10-05"}).status_code == 200
    monkeypatch.setattr("app.domain.planning.MAX_OFF", 1)
    assert client.post(path, json=week).status_code == 422
    client.patch("/api/planning", json={"enabled": False})
    assert client.post(path, json=week).status_code == 422


def test_renaming_a_person_keeps_their_time_off(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    anna = client.post("/api/planning/people", json={"name": "Anna"}).json()
    client.post(
        f"/api/planning/people/{anna['id']}/off", json={"start": "2026-10-05", "end": "2026-10-09"}
    )
    renamed = client.patch(f"/api/planning/people/{anna['id']}", json={"name": "Anna K"}).json()
    assert len(renamed["off"]) == 1
    assert len(client.get("/api/planning").json()["people"][0]["off"]) == 1


def test_no_time_off_on_a_demo_instance() -> None:
    admin = signed_in(create_app(Settings(db_path=":memory:", tiko_demo=True)))
    week = {"start": "2026-10-05", "end": "2026-10-09"}
    assert admin.post("/api/planning/people/p1/off", json=week).status_code == 403
    assert admin.delete("/api/planning/people/p1/off/o1").status_code == 403
