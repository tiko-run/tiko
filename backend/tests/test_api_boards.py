import pytest

DOC = {
    "nodes": [
        {
            "id": "f",
            "type": "frame",
            "position": {"x": 0, "y": 0},
            "width": 400,
            "height": 300,
            "data": {"title": "Now", "color": "blue"},
        },
        {
            "id": "a",
            "type": "task_card",
            "position": {"x": 20, "y": 40},
            "parentId": "f",
            "data": {"key": "DEMO-1", "collapsed": False},
        },
        {
            "id": "b",
            "type": "task_card",
            "position": {"x": 600, "y": 40},
            "data": {"key": "DEMO-2", "collapsed": True},
        },
        {
            "id": "s",
            "type": "sticky",
            "position": {"x": 200, "y": 40},
            "width": 200,
            "height": 200,
            "parentId": "f",
            "data": {"text": "Rotate certs", "color": "blue"},
        },
        {
            "id": "t",
            "type": "text",
            "position": {"x": 600, "y": -80},
            "width": 240,
            "data": {"text": "Q4 risks"},
        },
        {
            "id": "d",
            "type": "shape",
            "position": {"x": 600, "y": 200},
            "width": 160,
            "height": 100,
            "data": {"shape": "rhombus", "text": "Certs valid?", "color": "none"},
        },
    ],
    "edges": [
        {"id": "e", "source": "a", "target": "b", "sourceHandle": "r", "targetHandle": "l"},
        {"id": "e2", "source": "s", "target": "t", "sourceHandle": "t", "targetHandle": "b"},
    ],
    "viewport": {"x": 10.0, "y": -5.0, "zoom": 1.25},
}


def create(client, name="Q4"):
    response = client.post("/api/boards", json={"name": name})
    assert response.status_code == 201
    return response.json()


def test_board_round_trip(client):
    board = create(client)
    assert client.get("/api/boards").json()["boards"][0]["id"] == board["id"]
    for key in ("DEMO-1", "DEMO-2"):
        client.post("/api/tasks/resolve", json={"ref": key})

    saved = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": DOC})
    assert saved.json() == {"version": 2}

    body = client.get(f"/api/boards/{board['id']}").json()
    assert body["doc"] == DOC
    assert body["version"] == 2
    assert set(body["tasks"]) == {"demo:DEMO-1", "demo:DEMO-2"}
    assert body["default_source"] == "demo"


def test_stale_version_conflicts(client):
    board = create(client)
    client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": DOC})
    response = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": DOC})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "version_conflict"


def test_invalid_doc_rejected(client):
    board = create(client)
    nested = {"nodes": [DOC["nodes"][0], DOC["nodes"][0] | {"id": "g", "parentId": "f"}]}
    response = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": nested})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


@pytest.mark.parametrize(
    "data",
    [
        {"shape": "star", "text": "", "color": "none"},
        {"shape": "rhombus", "text": "", "color": "red"},
        {"shape": "rhombus", "text": "x" * 501, "color": "none"},
    ],
)
def test_bad_shape_rejected(client, data):
    board = create(client)
    doc = {"nodes": [DOC["nodes"][-1] | {"data": data}]}
    response = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc})
    assert response.status_code == 422


def test_frame_without_a_fill_stays_as_saved(client):
    board = create(client)
    frame = DOC["nodes"][0] | {"data": {"title": "Old"}}
    saved = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": {"nodes": [frame]}})
    assert saved.status_code == 200
    assert client.get(f"/api/boards/{board['id']}").json()["doc"]["nodes"] == [frame]


@pytest.mark.parametrize("color", ["surface", None])
def test_unknown_frame_fill_rejected(client, color):
    board = create(client)
    doc = {"nodes": [DOC["nodes"][0] | {"data": {"title": "", "color": color}}]}
    response = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc})
    assert response.status_code == 422


STYLED = [
    {"type": "frame", "data": {"title": "Done", "opacity": 40}},
    {"type": "sticky", "data": {"text": "Idea", "color": "pink", "opacity": 75, "bold": True}},
    {
        "type": "shape",
        "data": {
            "shape": "rhombus",
            "text": "Maybe",
            "color": "none",
            "opacity": 10,
            "stroke": 3,
            "dash": True,
            "bold": True,
            "size": "small",
        },
    },
    {"type": "text", "data": {"text": "Q4", "opacity": 100, "bold": False, "size": "large"}},
]


def test_style_round_trip(client):
    board = create(client)
    nodes = [{"id": f"n{i}", "position": {"x": i * 300, "y": 0}} | n for i, n in enumerate(STYLED)]
    saved = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": {"nodes": nodes}})
    assert saved.status_code == 200
    assert client.get(f"/api/boards/{board['id']}").json()["doc"]["nodes"] == nodes


@pytest.mark.parametrize(
    ("kind", "style"),
    [
        ("sticky", {"opacity": 42}),
        ("sticky", {"opacity": 5}),
        ("sticky", {"opacity": None}),
        ("shape", {"stroke": 2}),
        ("shape", {"size": "huge"}),
        ("text", {"opacity": 105}),
    ],
)
def test_unknown_style_rejected(client, kind, style):
    board = create(client)
    node = next(n for n in STYLED if n["type"] == kind)
    doc = {
        "nodes": [
            {"id": "n", "position": {"x": 0, "y": 0}, "type": kind, "data": node["data"] | style}
        ]
    }
    response = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc})
    assert response.status_code == 422


def test_child_before_its_frame_rejected(client):
    board = create(client)
    frame, card = DOC["nodes"][0], DOC["nodes"][1]
    doc = {"nodes": [card, frame]}
    response = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc})
    assert response.status_code == 422


def test_blank_name_rejected(client):
    assert client.post("/api/boards", json={"name": "  "}).status_code == 422


def test_missing_board(client):
    assert client.put("/api/boards/nope", json={"version": 1, "doc": DOC}).status_code == 404


def test_resolve_by_key_and_link(client):
    by_key = client.post("/api/tasks/resolve", json={"ref": "demo-1"}).json()["task"]
    assert by_key["key"] == "DEMO-1" and by_key["state"] == "ok"
    link = "https://jira.example.com/browse/DEMO-2"
    assert client.post("/api/tasks/resolve", json={"ref": link}).json()["task"]["key"] == "DEMO-2"


def test_resolve_errors(client):
    cases = [
        ("NOPE-1", 404, "task_not_found"),
        ("https://other.example.org/browse/DEMO-1", 422, "host_mismatch"),
        ("hello", 422, "invalid_ref"),
        ("", 422, "invalid_ref"),
    ]
    for ref, status, code in cases:
        response = client.post("/api/tasks/resolve", json={"ref": ref})
        assert (response.status_code, response.json()["error"]["code"]) == (status, code)


def test_non_finite_numbers_rejected(client):
    board = create(client)
    viewport = '{"x": 0, "y": 0, "zoom": Infinity}'
    body = f'{{"version": 1, "doc": {{"nodes": [], "edges": [], "viewport": {viewport}}}}}'
    response = client.put(
        f"/api/boards/{board['id']}", content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 422
    assert client.get(f"/api/boards/{board['id']}").status_code == 200


def test_rename_keeps_doc_version(client):
    board = create(client)
    renamed = client.patch(f"/api/boards/{board['id']}", json={"name": "  Team Platform "})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Team Platform"
    assert (
        client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": DOC}).status_code == 200
    )
    assert client.get("/api/boards").json()["boards"][0]["name"] == "Team Platform"


def test_rename_validates_and_404s(client):
    board = create(client)
    assert client.patch(f"/api/boards/{board['id']}", json={"name": " "}).status_code == 422
    assert client.patch("/api/boards/missing", json={"name": "X"}).status_code == 404


def test_delete_board(client):
    keep, gone = create(client, "Keep"), create(client, "Gone")
    assert client.delete(f"/api/boards/{gone['id']}").status_code == 204
    assert [b["id"] for b in client.get("/api/boards").json()["boards"]] == [keep["id"]]
    assert client.get(f"/api/boards/{gone['id']}").status_code == 404
    assert client.delete(f"/api/boards/{gone['id']}").status_code == 404


GANTT = {
    "start": "2026-10-01",
    "end": "2026-12-31",
    "scale": "week",
    "labelWidth": 240,
    "rows": [
        {
            "id": "r1",
            "key": "DEMO-3",
            "title": "",
            "start": "2026-10-06",
            "end": "2026-10-17",
            "collapsed": False,
        }
    ],
    "milestones": [{"id": "m1", "date": "2026-11-01", "title": "Beta"}],
    "links": [],
}


def module(node_id, kind, content):
    return {
        "id": node_id,
        "type": "module",
        "position": {"x": 0, "y": 400},
        "width": 960,
        "height": 320,
        "data": {"kind": kind, "title": "Q4 plan", "content": content},
    }


def test_modules_round_trip_with_their_tasks(client):
    board = create(client)
    client.post("/api/tasks/resolve", json={"ref": "DEMO-3"})
    doc = {
        "nodes": [module("g", "gantt", GANTT), module("u", "future_thing", {"x": [1, None]})],
        "edges": [],
        "viewport": {"x": 0.0, "y": 0.0, "zoom": 1.0},
    }
    saved = client.put(f"/api/boards/{board['id']}", json={"version": 1, "doc": doc})
    assert saved.status_code == 200

    body = client.get(f"/api/boards/{board['id']}").json()
    assert body["doc"] == doc
    assert set(body["tasks"]) == {"demo:DEMO-3"}


def test_invalid_module_content_rejected(client):
    board = create(client)
    bad = module("g", "gantt", GANTT | {"end": "2026-09-01"})
    body = {"version": 1, "doc": {"nodes": [bad]}}
    response = client.put(f"/api/boards/{board['id']}", json=body)
    assert response.status_code == 422
    assert "gantt: end before start" in response.json()["error"]["message"]
