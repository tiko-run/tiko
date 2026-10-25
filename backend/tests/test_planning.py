"""Spec 027: the Planning switch, the stage type library and the people directory."""

from datetime import date

from fastapi.testclient import TestClient

from app.config import Settings
from app.domain import planning_sample as sample
from app.domain.planning import PlanningPerson, TimeOff
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
    assert client.get("/api/planning").json() == {
        "enabled": False,
        "types": [],
        "people": [],
        "fields": [],
        "views": [],
        "daysOff": [],
    }


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


def test_workday_skips_weekends() -> None:
    saturday = date(2026, 10, 24)
    assert sample.workday(saturday, 0) == date(2026, 10, 26)
    assert sample.workday(saturday, -1) == date(2026, 10, 23)
    assert sample.workday(date(2026, 10, 23), 1) == date(2026, 10, 26)


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


def test_the_time_off_limit_holds_at_the_store(store) -> None:
    mod, db = store
    people = mod.PlanningPeopleRepo(db)
    people.add(PlanningPerson(id="p1", name="Anna", source="manual"))
    week = {"start": "2026-10-05", "end": "2026-10-09"}
    assert people.add_off("p1", TimeOff(id="o1", **week), limit=2)
    assert people.add_off("p1", TimeOff(id="o2", **week), limit=2)
    # A request that read one range before the second landed still stops at the limit.
    assert not people.add_off("p1", TimeOff(id="o3", **week), limit=2)
    assert [o.id for o in people.all()[0].off] == ["o1", "o2"]


def test_renaming_a_person_keeps_their_time_off(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    anna = client.post("/api/planning/people", json={"name": "Anna"}).json()
    client.post(
        f"/api/planning/people/{anna['id']}/off", json={"start": "2026-10-05", "end": "2026-10-09"}
    )
    renamed = client.patch(f"/api/planning/people/{anna['id']}", json={"name": "Anna K"}).json()
    assert len(renamed["off"]) == 1
    assert len(client.get("/api/planning").json()["people"][0]["off"]) == 1


def test_the_standard_fields_are_there_from_the_start(client: TestClient) -> None:
    fields = client.patch("/api/planning", json={"enabled": True}).json()["fields"]
    assert [(f["id"], f["name"], f["standard"]) for f in fields] == [
        ("priority", "Priority", True),
        ("size", "Size", True),
        ("team", "Team", True),
    ]


def test_a_member_adds_renames_and_archives_a_field(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    ann = member(client)
    quarter = ann.post("/api/planning/fields", json={"name": " Quarter "}).json()
    assert quarter == {"id": quarter["id"], "name": "Quarter", "standard": False, "archived": False}
    path = f"/api/planning/fields/{quarter['id']}"
    assert ann.patch(path, json={"name": "Qtr"}).json()["name"] == "Qtr"
    assert ann.patch(path, json={"archived": True}).json()["archived"] is True
    names = [f["name"] for f in client.get("/api/planning").json()["fields"]]
    assert names == ["Priority", "Size", "Team", "Qtr"]
    # An archived name is free again.
    assert ann.post("/api/planning/fields", json={"name": "Qtr"}).status_code == 200


def test_field_rules(client: TestClient, monkeypatch) -> None:
    fields = "/api/planning/fields"
    assert client.post(fields, json={"name": "Quarter"}).status_code == 422
    client.patch("/api/planning", json={"enabled": True})
    assert client.post(fields, json={"name": "priority"}).status_code == 422
    assert client.post(fields, json={"name": ""}).status_code == 422
    assert client.post(fields, json={"name": "x" * 41}).status_code == 422
    assert client.post(fields, json={"name": "Quarter", "kind": "number"}).status_code == 422
    assert client.patch(f"{fields}/nope", json={"name": "Quarter"}).status_code == 404
    # Standard fields can be renamed, never archived.
    assert client.patch(f"{fields}/team", json={"archived": True}).status_code == 422
    assert client.patch(f"{fields}/team", json={"name": "Squad"}).json()["name"] == "Squad"
    monkeypatch.setattr("app.domain.planning.MAX_FIELDS", 1)
    assert client.post(fields, json={"name": "Quarter"}).status_code == 200
    assert client.post(fields, json={"name": "Budget"}).status_code == 422


def test_a_member_saves_and_removes_a_view(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    ann = member(client)
    filters = {"team": ["Web"], "f7": ["Q4"]}
    view = ann.post("/api/planning/views", json={"name": " Web in Q4 ", "filters": filters}).json()
    assert view == {"id": view["id"], "name": "Web in Q4", "filters": filters}
    assert client.get("/api/planning").json()["views"] == [view]
    assert ann.delete(f"/api/planning/views/{view['id']}").status_code == 204
    assert client.get("/api/planning").json()["views"] == []


def test_view_rules(client: TestClient, monkeypatch) -> None:
    views = "/api/planning/views"
    web = {"name": "Web", "filters": {"team": ["Web"]}}
    assert client.post(views, json=web).status_code == 422
    client.patch("/api/planning", json={"enabled": True})
    assert client.post(views, json=web).status_code == 200
    assert client.post(views, json=web | {"name": "web"}).status_code == 422
    assert client.post(views, json=web | {"name": ""}).status_code == 422
    assert client.post(views, json=web | {"filters": {"team": []}}).status_code == 422
    assert client.post(views, json=web | {"filters": {"team": [""]}}).status_code == 422
    many = {"team": [str(i) for i in range(21)]}
    assert client.post(views, json=web | {"name": "Many", "filters": many}).status_code == 422
    assert client.delete(f"{views}/nope").status_code == 404
    monkeypatch.setattr("app.domain.planning.MAX_VIEWS", 2)
    assert client.post(views, json=web | {"name": "Core"}).status_code == 200
    assert client.post(views, json=web | {"name": "Ops"}).status_code == 422


def test_the_view_name_holds_at_the_store(store) -> None:
    from app.domain.planning import SavedView

    mod, db = store
    views = mod.PlanningViewRepo(db)
    assert views.add(SavedView(id="v1", name="Web", filters={"team": ["Web"]}), limit=5)
    assert not views.add(SavedView(id="v2", name="WEB", filters={"team": ["Web"]}), limit=5)
    assert views.add(SavedView(id="v3", name="Straße", filters={}), limit=5)
    assert not views.add(SavedView(id="v4", name="STRASSE", filters={}), limit=5)


def test_a_member_sets_the_days_off(client: TestClient, monkeypatch) -> None:
    path = "/api/planning/days-off"
    assert client.put(path, json={"dates": ["2026-11-04"]}).status_code == 422
    client.patch("/api/planning", json={"enabled": True})
    ann = member(client)
    dates = ["2026-12-31", "2026-11-04", "2026-11-04"]
    assert ann.put(path, json={"dates": dates}).json() == {"dates": ["2026-11-04", "2026-12-31"]}
    assert client.get("/api/planning").json()["daysOff"] == ["2026-11-04", "2026-12-31"]
    assert ann.put(path, json={"dates": []}).json() == {"dates": []}
    assert client.put(path, json={"dates": ["2026-11-31"]}).status_code == 422
    assert client.put(path, json={"dates": ["2026-11-04"] * 401}).status_code == 422


def plan_board(client: TestClient, name: str, rows: list[dict]) -> str:
    board_id = client.post("/api/boards", json={"name": name}).json()["id"]
    content = {"start": "2026-10-01", "end": "2026-12-31", "rows": rows}
    node = {
        "id": "g",
        "type": "module",
        "position": {"x": 0, "y": 0},
        "data": {"kind": "gantt", "content": content},
    }
    doc = {"nodes": [node], "edges": []}
    version = client.get(f"/api/boards/{board_id}").json()["version"]
    saved = client.put(f"/api/boards/{board_id}", json={"version": version, "doc": doc})
    assert saved.is_success, saved.text
    return board_id


def staged(row_id: str, title: str, person: str, start: str, end: str, **extra) -> dict:
    stage = {"id": f"s-{row_id}", "type": "t1", "start": start, "end": end, "people": [person]}
    return {"id": row_id, "title": title, "start": start, "end": end, "stages": [stage]} | extra


def test_a_workload_counts_stages_across_boards(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    ivan = client.post("/api/planning/people", json={"name": "Ivan"}).json()["id"]
    client.post(
        f"/api/planning/people/{ivan}/off", json={"start": "2026-11-02", "end": "2026-11-06"}
    )
    payments = plan_board(
        client, "Payments", [staged("r1", "Payment API", ivan, "2026-10-19", "2026-10-30")]
    )
    ann = member(client)
    plan_board(ann, "Design", [staged("r2", "Checkout UI", ivan, "2026-10-26", "2026-11-06")])
    path = f"/api/planning/people/{ivan}/workload?from=2026-10-14&weeks=4"

    mine = client.get(path).json()
    assert [w["start"] for w in mine["weeks"]] == [
        "2026-10-12",
        "2026-10-19",
        "2026-10-26",
        "2026-11-02",
    ]
    assert [w["stages"] for w in mine["weeks"]] == [0, 1, 2, 1]
    assert [w["overlap"] for w in mine["weeks"]] == [False, False, True, False]
    assert [w["off"] for w in mine["weeks"]] == [False, False, False, True]
    assert [s["boardName"] for s in mine["stages"]] == ["Payments", "Design"]

    # Ann cannot open the admin's board: that stage keeps only its dates.
    theirs = ann.get(path).json()["stages"]
    assert theirs[0] == {
        "board": None,
        "boardName": None,
        "row": None,
        "type": None,
        "start": "2026-10-19",
        "end": "2026-10-30",
    }
    assert theirs[1]["row"] == "Checkout UI"

    # Saving the board rewrites its part of the index.
    board = client.get(f"/api/boards/{payments}").json()
    board["doc"]["nodes"][0]["data"]["content"]["rows"] = []
    client.put(
        f"/api/boards/{payments}",
        json={"version": board["version"], "doc": board["doc"]},
    )
    assert [w["stages"] for w in client.get(path).json()["weeks"]] == [0, 0, 1, 1]
    client.delete(f"/api/boards/{payments}")
    assert len(client.get(path).json()["stages"]) == 1


def test_a_parent_rows_hidden_stages_do_not_count(client: TestClient) -> None:
    client.patch("/api/planning", json={"enabled": True})
    ivan = client.post("/api/planning/people", json={"name": "Ivan"}).json()["id"]
    plan_board(
        client,
        "Plan",
        [
            staged("p", "Checkout", ivan, "2026-10-05", "2026-10-09"),
            staged("c", "Checkout UI", ivan, "2026-10-05", "2026-10-09", parent="p"),
        ],
    )
    weeks = client.get(f"/api/planning/people/{ivan}/workload?from=2026-10-05&weeks=1").json()
    assert weeks["weeks"][0] == {"start": "2026-10-05", "stages": 1, "overlap": False, "off": False}


def test_workload_rules(client: TestClient) -> None:
    assert client.get("/api/planning/people/p1/workload").status_code == 422
    client.patch("/api/planning", json={"enabled": True})
    assert client.get("/api/planning/people/nobody/workload").status_code == 404
    ivan = client.post("/api/planning/people", json={"name": "Ivan"}).json()["id"]
    path = f"/api/planning/people/{ivan}/workload"
    assert len(client.get(path).json()["weeks"]) == 12
    assert client.get(f"{path}?weeks=27").status_code == 422
    assert TestClient(client.app).get(path).status_code == 401
