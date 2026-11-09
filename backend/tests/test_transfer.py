"""Spec 044: a board carried between instances in a `.tiko` file."""

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_files import picture, upload


@pytest.fixture
def client():
    return signed_in(create_app(Settings(db_path=":memory:")))


def make_board(client: TestClient, doc: dict, name: str = "My map") -> str:
    board_id = client.post("/api/boards", json={"name": name}).json()["id"]
    saved = client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc})
    assert saved.status_code == 200, saved.text
    return board_id


def export(client: TestClient, board_id: str) -> bytes:
    response = client.get(f"/api/boards/{board_id}/export")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/vnd.tiko.board+zip"
    return response.content


def import_file(client: TestClient, data: bytes):
    return client.post(
        "/api/boards/import", content=data, headers={"content-type": "application/zip"}
    )


def entries(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {name: zf.read(name) for name in zf.namelist()}


def pack(items: dict[str, bytes | str | dict | list]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as zf:
        for name, value in items.items():
            zf.writestr(name, value if isinstance(value, bytes | str) else json.dumps(value))
    return out.getvalue()


def node(node_id: str, kind: str, data: dict, **extra) -> dict:
    return {"id": node_id, "type": kind, "position": {"x": 0, "y": 0}, "data": data, **extra}


def gantt(stages_type: str, person: str, field: str) -> dict:
    return node(
        "g",
        "module",
        {
            "kind": "gantt",
            "content": {
                "start": "2026-11-02",
                "end": "2026-12-28",
                "columns": [field],
                "filters": {"person": [person]},
                "rows": [
                    {
                        "id": "r1",
                        "title": "Launch",
                        "start": "2026-11-02",
                        "end": "2026-11-06",
                        "values": {field: "High"},
                        "stages": [
                            {
                                "id": "s1",
                                "type": stages_type,
                                "start": "2026-11-02",
                                "end": "2026-11-06",
                                "people": [person],
                            }
                        ],
                    }
                ],
            },
        },
    )


def manifest(**extra) -> dict:
    return {"format": 1, "app": "2026.11.0", "name": "From elsewhere", **extra}


def test_a_board_goes_round_trip_with_everything_it_holds(client):
    board_id = make_board(client, {"nodes": []})
    shot = upload(client, board_id, picture(600, 400)).json()
    doc = {
        "nodes": [
            node("f", "frame", {"title": "Ideas", "color": "blue"}, width=400, height=300),
            node(
                "s",
                "sticky",
                {"text": "Ship it", "rotation": 15, "reaction:someone": ["like"]},
                parentId="f",
            ),
            node("t", "text", {"text": "Notes", "size": "large"}),
            node("c", "task_card", {"key": "DEMO-1"}),
            node(
                "i",
                "image",
                {"file": shot["id"], "w": 600, "h": 400, "color": shot["color"]},
            ),
        ],
        "edges": [{"id": "e", "source": "s", "target": "c"}],
        "viewport": {"x": 10, "y": 20, "zoom": 0.5},
    }
    client.put(f"/api/boards/{board_id}", json={"version": 2, "doc": doc})
    client.post(f"/api/boards/{board_id}/refresh")

    data = export(client, board_id)
    files = entries(data)
    assert json.loads(files["manifest.json"])["files"] == {shot["id"]: "image/png"}
    assert f"files/{shot['id']}" in files

    response = import_file(client, data)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["board"]["name"] == "My map"
    assert body["board"]["my_role"] == "owner"
    assert body["moved"] == {
        "frames": 1,
        "stickies": 1,
        "texts": 1,
        "cards": 1,
        "pictures": 1,
        "arrows": 1,
    }
    assert body["notes"] == []

    copy = client.get(f"/api/boards/{body['board']['id']}").json()
    nodes = {n["id"]: n for n in copy["doc"]["nodes"]}
    assert nodes["s"]["data"] == {"text": "Ship it", "color": "yellow", "rotation": 15}
    assert nodes["s"]["parentId"] == "f"
    # The card names its tracker, so another instance does not take it for its own.
    assert nodes["c"]["data"]["source"] == "demo"
    assert copy["doc"]["viewport"] == {"x": 10, "y": 20, "zoom": 0.5}
    assert copy["tasks"]["demo:DEMO-1"]["summary"]
    picture_url = f"/api/boards/{copy['id']}/files/{nodes['i']['data']['file']}"
    assert client.get(picture_url).status_code == 200


def test_a_card_from_a_tracker_this_instance_lacks_keeps_what_the_file_says(client):
    task = {
        "source": "jira",
        "key": "OPS-7",
        "summary": "Rotate the certificates",
        "status_name": "In Progress",
        "status_category": "indeterminate",
        "url": "https://jira.example.com/browse/OPS-7",
        "fetched_at": "2026-11-01T10:00:00+00:00",
    }
    data = pack(
        {
            "manifest.json": manifest(),
            "board.json": {"nodes": [node("c", "task_card", {"key": "OPS-7", "source": "jira"})]},
            "tasks.json": [task],
        }
    )
    board_id = import_file(client, data).json()["board"]["id"]
    refreshed = client.post(f"/api/boards/{board_id}/refresh").json()["tasks"]["jira:OPS-7"]
    assert refreshed["state"] == "not_connected"
    assert refreshed["summary"] == "Rotate the certificates"
    assert refreshed["status_name"] == "In Progress"


def test_gantt_planning_is_matched_by_name_and_the_rest_is_added(client):
    view = client.patch("/api/planning", json={"enabled": True}).json()
    build = next(t for t in view["types"] if t["name"] == "Build")
    sam = client.post("/api/planning/people", json={"name": "Sam"}).json()
    client.post(
        f"/api/planning/people/{sam['id']}/off", json={"start": "2026-11-10", "end": "2026-11-12"}
    )
    planning = {
        "types": [{"id": "far-build", "name": "build", "hue": 75}],
        "people": [
            {
                "id": "far-sam",
                "name": "Sam",
                "source": "manual",
                "off": [
                    {"id": "o1", "start": "2026-11-11", "end": "2026-11-13"},
                    {"id": "o2", "start": "2026-12-01", "end": "2026-12-02"},
                ],
            },
            {"id": "far-kim", "name": "Kim", "teams": ["Core"], "source": "manual"},
        ],
        "fields": [{"id": "far-risk", "name": "Risk"}],
    }
    doc = {"nodes": [gantt("far-build", "far-sam", "far-risk")]}
    doc["nodes"][0]["data"]["content"]["rows"][0]["stages"][0]["people"].append("far-kim")
    response = import_file(
        client,
        pack({"manifest.json": manifest(), "board.json": doc, "planning.json": planning}),
    )
    assert response.status_code == 201, response.text
    assert response.json()["notes"] == [
        {"kind": "planning_added", "text": "Added to Planning: Kim, Risk."}
    ]

    after = client.get("/api/planning").json()
    kim = next(p for p in after["people"] if p["name"] == "Kim")
    risk = next(f for f in after["fields"] if f["name"] == "Risk")
    sam_after = next(p for p in after["people"] if p["id"] == sam["id"])
    # Time off that overlaps Sam's own is skipped; the rest is added.
    assert [(o["start"], o["end"]) for o in sam_after["off"]] == [
        ("2026-11-10", "2026-11-12"),
        ("2026-12-01", "2026-12-02"),
    ]
    assert kim["teams"] == ["Core"]

    content = client.get(f"/api/boards/{response.json()['board']['id']}").json()["doc"]["nodes"][0][
        "data"
    ]["content"]
    row = content["rows"][0]
    assert row["stages"][0]["type"] == build["id"]
    assert row["stages"][0]["people"] == [sam["id"], kim["id"]]
    assert row["values"] == {risk["id"]: "High"}
    assert content["columns"] == [risk["id"]]
    assert content["filters"] == {"person": [sam["id"]]}


def test_planning_off_here_is_said_and_the_board_still_comes(client):
    doc = {"nodes": [gantt("far-build", "far-sam", "far-risk")]}
    response = import_file(client, pack({"manifest.json": manifest(), "board.json": doc}))
    assert response.status_code == 201, response.text
    assert [note["kind"] for note in response.json()["notes"]] == ["planning_off"]


def test_a_picture_that_does_not_read_leaves_an_empty_frame_and_a_note(client):
    file_id = "a" * 32
    image = node("i", "image", {"file": file_id, "w": 10, "h": 10, "color": "#000000"})
    data = pack(
        {
            "manifest.json": manifest(files={file_id: "image/png"}),
            "board.json": {"nodes": [image]},
            f"files/{file_id}": b"not a picture",
        }
    )
    response = import_file(client, data)
    assert response.status_code == 201, response.text
    assert [note["kind"] for note in response.json()["notes"]] == ["picture"]
    board = client.get(f"/api/boards/{response.json()['board']['id']}").json()
    assert "file" not in board["doc"]["nodes"][0]["data"]


@pytest.mark.parametrize(
    ("data", "status", "words"),
    [
        (b"hello", 422, "not a tiko board file"),
        (pack({"board.json": {"nodes": []}}), 422, "not a tiko board file"),
        (
            pack({"manifest.json": manifest(format=2, app="2027.1.0"), "board.json": {}}),
            422,
            "exported by tiko 2027.1.0. Update this tiko",
        ),
        (
            pack({"manifest.json": manifest(), "board.json": {"nodes": [{"id": "x"}]}}),
            422,
            "does not read as a tiko board",
        ),
    ],
)
def test_a_file_that_cannot_be_imported_writes_nothing(client, data, status, words):
    before = len(client.get("/api/boards").json()["boards"])
    response = import_file(client, data)
    assert response.status_code == status, response.text
    assert words in response.json()["error"]["message"]
    assert len(client.get("/api/boards").json()["boards"]) == before
    assert client.get("/api/trash").json()["boards"] == []


def test_entries_outside_the_layout_are_ignored(client):
    data = pack(
        {
            "manifest.json": manifest(),
            "board.json": {"nodes": [node("s", "sticky", {"text": "Hi"})]},
            "../../etc/passwd": "root",
            "files/../../evil": b"x",
        }
    )
    assert import_file(client, data).status_code == 201


def test_a_guest_of_a_public_link_cannot_export(client):
    board_id = make_board(client, {"nodes": []})
    assert TestClient(client.app).get(f"/api/boards/{board_id}/export").status_code == 401


def test_the_file_name_follows_the_board_name(client):
    board_id = make_board(client, {"nodes": []}, name="Q4: plan/ideas")
    response = client.get(f"/api/boards/{board_id}/export")
    assert "filename*=UTF-8''Q4%20%20plan%20ideas.tiko" in response.headers["content-disposition"]


def test_pictures_past_the_quota_fail_the_whole_import_and_leave_no_board():
    client = signed_in(create_app(Settings(db_path=":memory:", tiko_files_quota_mb=1)))
    file_id = "b" * 32
    image = node("i", "image", {"file": file_id, "w": 10, "h": 10, "color": "#000000"})
    noisy = bytes(range(256)) * 8000
    big = picture(1200, 1200, "PNG", compress_level=0) + noisy
    data = pack(
        {
            "manifest.json": manifest(files={file_id: "image/png"}),
            "board.json": {"nodes": [image]},
            f"files/{file_id}": big,
        }
    )
    response = import_file(client, data)
    assert response.status_code == 507, response.text
    assert "MB more than this workspace has room for" in response.json()["error"]["message"]
    assert client.get("/api/boards").json()["boards"] == []
    assert client.get("/api/trash").json()["boards"] == []


def test_a_damaged_task_list_or_an_oversized_picture_does_not_stop_the_board(client):
    from app.domain.files import MAX_BYTES

    file_id = "c" * 32
    image = node("i", "image", {"file": file_id, "w": 10, "h": 10, "color": "#000000"})
    data = pack(
        {
            "manifest.json": manifest(files={file_id: "image/png"}),
            "board.json": {"nodes": [image]},
            "tasks.json": "null",
            f"files/{file_id}": b"0" * (MAX_BYTES + 1),
        }
    )
    response = import_file(client, data)
    assert response.status_code == 201, response.text
    assert [note["kind"] for note in response.json()["notes"]] == ["picture"]


def test_people_of_one_name_never_get_overlapping_time_off(client):
    client.patch("/api/planning", json={"enabled": True})
    off = [{"id": "o", "start": "2026-12-01", "end": "2026-12-03"}]
    planning = {
        "people": [
            {"id": "a", "name": "Sam", "source": "manual", "off": off},
            {"id": "b", "name": "sam", "source": "manual", "off": off},
        ]
    }
    doc = {"nodes": [gantt("t", "a", "f")]}
    doc["nodes"][0]["data"]["content"]["rows"][0]["stages"][0]["people"].append("b")
    import_file(
        client, pack({"manifest.json": manifest(), "board.json": doc, "planning.json": planning})
    )
    sam = [p for p in client.get("/api/planning").json()["people"] if p["name"] == "Sam"]
    assert len(sam) == 1 and len(sam[0]["off"]) == 1


def test_stages_the_file_does_not_describe_are_reported(client):
    client.patch("/api/planning", json={"enabled": True})
    doc = {"nodes": [gantt("far-build", "far-sam", "far-risk")]}
    response = import_file(client, pack({"manifest.json": manifest(), "board.json": doc}))
    assert [note["kind"] for note in response.json()["notes"]] == ["planning_missing"]


def test_a_card_exported_again_keeps_the_title_it_carried(client):
    task = {
        "source": "jira",
        "key": "OPS-7",
        "summary": "Rotate the certificates",
        "url": "",
        "fetched_at": "2026-11-01T10:00:00+00:00",
    }
    card = node("c", "task_card", {"key": "OPS-7", "source": "jira"})
    first = import_file(
        client,
        pack({"manifest.json": manifest(), "board.json": {"nodes": [card]}, "tasks.json": [task]}),
    ).json()["board"]["id"]
    client.post(f"/api/boards/{first}/refresh")
    tasks = json.loads(entries(export(client, first))["tasks.json"])
    assert [(t["key"], t["summary"]) for t in tasks] == [("OPS-7", "Rotate the certificates")]
