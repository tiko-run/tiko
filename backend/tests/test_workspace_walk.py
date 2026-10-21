"""SC-002 of spec 032: no route answers with a row of another workspace or changes one."""

import re

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in

# Reached by a secret in the address, from anywhere by design: an invite or a public link.
BY_TOKEN = ("/api/invites/{token}", "/api/public/{token}")
# The server admin's: accounts of every workspace are theirs to run, and a visitor gets 403.
SERVER = ("/api/accounts",)
SKIPPED = {
    # They end the session the walk goes on with.
    ("POST", "/api/auth/logout"),
    ("POST", "/api/auth/logout-all"),
    # They reach outside the server and hold no workspace rows.
    ("POST", "/api/version/check"),
    ("POST", "/api/privacy/errors"),
}
STICKY = {
    "id": "note",
    "type": "sticky",
    "position": {"x": 1, "y": 2},
    "width": 200,
    "height": 200,
    "data": {"text": "", "color": "yellow"},
}


def bodies(own: dict) -> dict[tuple[str, str], dict]:
    """Bodies that pass validation, so a request reaches the lookup of the row it names."""
    return {
        ("PUT", "/api/boards/{board_id}"): {"version": 1, "doc": {"nodes": [], "edges": []}},
        ("PATCH", "/api/boards/{board_id}"): {"name": "Taken"},
        ("PUT", "/api/boards/{board_id}/everyone"): {"role": None},
        ("PUT", "/api/boards/{board_id}/members/{user_id}"): {"role": "viewer"},
        ("PUT", "/api/boards/{board_id}/public"): {"public": True},
        ("POST", "/api/boards/{board_id}/transfer"): {"user_id": own["user_id"]},
        ("PATCH", "/api/people/{user_id}"): {"role": "admin"},
        ("PATCH", "/api/planning/types/{type_id}"): {"name": "Taken"},
        ("PATCH", "/api/planning/people/{person_id}"): {"name": "Taken"},
        ("POST", "/api/planning/people/{person_id}/off"): {
            "start": "2027-05-03",
            "end": "2027-05-04",
        },
        ("PATCH", "/api/planning/fields/{field_id}"): {"name": "Taken"},
        ("PUT", "/api/demo/tasks/{key}/status"): {"status": "Done"},
        ("POST", "/api/tasks/resolve"): {"ref": "DEMO-1"},
    }


def ok(response) -> dict:
    assert response.is_success, response.text
    return response.json()


def fill(client: TestClient, tag: str, day: str) -> dict:
    """Rows of every kind in the client's workspace, named by `tag`; returns their ids."""
    me = client.get("/api/auth/status").json()["me"]
    if me["role"] == "admin":
        client.patch("/api/planning", json={"enabled": True})
        board_id = ok(client.post("/api/boards", json={"name": f"board-{tag}"}))["id"]
        invite = ok(client.post("/api/invites", json={"role": "member"}))["invite"]["id"]
    else:
        board_id = ok(client.get("/api/boards"))["boards"][0]["id"]
        ok(client.patch(f"/api/boards/{board_id}", json={"name": f"board-{tag}"}))
        invite = "none"
    sticky = STICKY | {"data": {"text": f"note-{tag}", "color": "yellow"}}
    doc = {"nodes": [sticky], "edges": []}
    ok(client.put(f"/api/boards/{board_id}", json={"version": 1, "doc": doc}))
    person = ok(client.post("/api/planning/people", json={"name": f"person-{tag}"}))["id"]
    off = ok(client.post(f"/api/planning/people/{person}/off", json={"start": day, "end": day}))
    type_id = ok(client.post("/api/planning/types", json={"name": f"type-{tag}", "hue": 25}))
    field = ok(client.post("/api/planning/fields", json={"name": f"field-{tag}"}))["id"]
    view = {"name": f"view-{tag}", "filters": {"team": [tag]}}
    view = ok(client.post("/api/planning/views", json=view))["id"]
    ok(client.put("/api/planning/days-off", json={"dates": [day]}))
    ok(client.put("/api/demo/tasks/DEMO-1/status", json={"status": "Done"}))
    return {
        "board_id": board_id,
        "user_id": me["id"],
        "person_id": person,
        "off_id": off["off"][0]["id"],
        "type_id": type_id["id"],
        "field_id": field,
        "view_id": view,
        "invite_id": invite,
        "key": "DEMO-1",
        "workspace": me["workspace"]["id"],
        "markers": [
            f"board-{tag}",
            f"note-{tag}",
            f"person-{tag}",
            f"type-{tag}",
            f"field-{tag}",
            f"view-{tag}",
            day,
            me["id"],
            board_id,
        ],
    }


def workspace_rows(app, workspace: str) -> list[str]:
    db = app.state.boards._db
    with db.jobs() as conn:
        tables = [
            row["table_name"]
            for row in conn.execute(
                "SELECT table_name FROM information_schema.columns"
                " WHERE table_schema = 'public' AND column_name = 'workspace_id'"
            )
        ]
        return sorted(
            f"{table}:{tuple(row.values())}"
            for table in tables
            for row in conn.execute(f"SELECT * FROM {table} WHERE workspace_id = %s", (workspace,))
        )


def walk(app, client: TestClient, own: dict, other: dict) -> list[str]:
    """Every route with the other workspace's ids; returns what went wrong."""
    wrong = []
    sent = bodies(own)
    for path, methods in app.openapi()["paths"].items():
        if path.startswith(BY_TOKEN) or (path.startswith(SERVER) and own["server"]):
            continue
        for method in (m.upper() for m in methods):
            if (method, path) in SKIPPED:
                continue
            url = re.sub(r"\{(\w+)\}", lambda m: str(other[m.group(1)]), path)
            body = sent.get((method, path), {}) if method != "GET" else None
            response = client.request(method, url, json=body)
            # An id the request carried may come back in an error; anything else may not.
            leaked = [m for m in other["markers"] if m in response.text and m not in url]
            if leaked:
                wrong.append(f"{method} {path} {response.status_code}: {leaked}")
    return wrong


@pytest.fixture
def app():
    return create_app(Settings(db_path=":memory:", tiko_demo=True))


def test_no_route_reaches_another_workspace(app):
    admin = signed_in(app)
    visitor = TestClient(app)
    assert visitor.post("/api/auth/demo", headers={"x-real-ip": "203.0.113.9"}).is_success
    default = fill(admin, "default", "2027-03-03") | {"server": True}
    theirs = fill(visitor, "visitor", "2027-04-04") | {"server": False}
    assert default["workspace"] != theirs["workspace"]

    wrong = []
    for client, own, other in [(admin, default, theirs), (visitor, theirs, default)]:
        # A walk changes its own workspace as it likes, never the other one.
        before = workspace_rows(app, other["workspace"])
        wrong += walk(app, client, own, other)
        assert workspace_rows(app, other["workspace"]) == before
    assert wrong == []
