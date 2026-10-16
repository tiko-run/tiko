"""Spec 027: the Planning switch and the stage type library."""

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
    assert client.get("/api/planning").json() == {"enabled": False, "types": []}


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
    assert admin.get("/api/planning").json()["enabled"] is False
