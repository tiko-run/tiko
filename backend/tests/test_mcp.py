"""The MCP server at /api/mcp, driven by the SDK's own client over HTTP (spec 046)."""

import asyncio
import socket
import threading
import time

import httpx2
import pytest
import uvicorn
from fastapi.testclient import TestClient
from mcp.client import Client
from mcp.client.streamable_http import streamable_http_client

from app.api.v1 import deps as v1_deps
from app.config import Settings
from app.main import create_app
from tests.conftest import signed_in
from tests.test_api_keys import make_key
from tests.test_api_v1_read import DOC, board
from tests.test_people import invite, join

READ_TOOLS = ["list_boards", "read_board", "read_gantt", "search_tasks"]


@pytest.fixture
def served():
    """The whole app on a real port, its lifespan running, and a signed-in admin."""
    app = create_app(Settings(db_path=":memory:"))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)
    yield app, f"http://127.0.0.1:{port}", signed_in(app)
    server.should_exit = True
    thread.join(5)


def call(url: str, token: str, steps, mode: str = "auto", host: str | None = None):
    """Runs `steps(client)` in an MCP session signed in with `token`."""

    async def run():
        headers = {"authorization": f"Bearer {token}"} | ({"host": host} if host else {})
        http = httpx2.AsyncClient(headers=headers)
        transport = streamable_http_client(f"{url}/api/mcp", http_client=http)
        async with Client(transport, mode=mode) as client:
            return await steps(client)

    return asyncio.run(run())


async def tool_names(client) -> list[str]:
    return sorted(tool.name for tool in (await client.list_tools()).tools)


@pytest.mark.parametrize("mode", ["auto", "legacy"])
def test_a_read_key_reads_boards_on_either_protocol(served, mode):
    app, url, admin = served
    board_id = board(admin)
    token = make_key(admin)["token"]

    async def steps(client):
        names = await tool_names(client)
        listed = await client.call_tool("list_boards", {})
        outline = await client.call_tool("read_board", {"board": board_id})
        page = await client.call_tool("read_board", {"board": board_id, "all": True})
        return names, listed, outline, page

    names, listed, outline, page = call(url, token, steps, mode)
    assert names == READ_TOOLS
    assert [b["id"] for b in listed.structured_content["boards"]] == [board_id]
    assert outline.structured_content["frames"][0]["title"] == "In review"
    elements = {e["id"]: e for e in page.structured_content["elements"]}
    assert elements["n1"]["text"] == "Ask legal"
    # No places unless asked: they only fill the agent's context.
    assert "x" not in elements["n1"]


def test_places_come_when_asked(served):
    app, url, admin = served
    board_id = board(admin)
    token = make_key(admin)["token"]

    async def steps(client):
        args = {"board": board_id, "all": True, "coordinates": True}
        return await client.call_tool("read_board", args)

    elements = {e["id"]: e for e in call(url, token, steps).structured_content["elements"]}
    assert (elements["n1"]["x"], elements["n1"]["y"]) == (110, 220)


def test_search_reads_the_demo_tasks(served):
    app, url, admin = served
    token = make_key(admin)["token"]

    async def steps(client):
        return await client.call_tool("search_tasks", {"source": "demo", "query": '"login"'})

    assert call(url, token, steps).structured_content["tasks"]


def test_a_board_out_of_reach_is_a_tool_error(served):
    app, url, admin = served
    member = join(app, invite(admin))
    private = board(member, "Private", DOC)
    token = make_key(admin)["token"]

    async def steps(client):
        return await client.call_tool("read_board", {"board": private})

    result = call(url, token, steps)
    assert result.is_error
    assert "not_found" in result.content[0].text


def test_budgets_answer_as_tool_errors(served, monkeypatch):
    monkeypatch.setattr(v1_deps, "READS", 1)
    app, url, admin = served
    token = make_key(admin)["token"]

    async def steps(client):
        await client.call_tool("list_boards", {})
        return await client.call_tool("list_boards", {})

    result = call(url, token, steps)
    assert result.is_error and "rate_limited" in result.content[0].text


def test_any_host_name_and_both_spellings_of_the_address_work(served):
    app, url, admin = served
    token = make_key(admin)["token"]
    names = call(url, token, tool_names, host="tiko.example.com:3000")
    assert names == READ_TOOLS
    raw = httpx2.post(
        f"{url}/api/mcp",
        headers={
            "authorization": f"Bearer {token}",
            "accept": "application/json, text/event-stream",
        },
        json={"jsonrpc": "2.0", "id": 1, "method": "ping"},
        follow_redirects=False,
    )
    assert raw.status_code != 307


def test_mcp_takes_no_cookie_and_no_unknown_key(served):
    app, url, admin = served
    cookie = TestClient(app, cookies=admin.cookies).post("/api/mcp/", json={})
    assert cookie.status_code == 401
    unknown = httpx2.post(f"{url}/api/mcp/", headers={"authorization": "Bearer tiko_" + "z" * 40})
    assert unknown.status_code == 401
    assert unknown.headers["www-authenticate"].startswith("Bearer")


def test_a_removed_member_loses_mcp_too(served):
    app, url, admin = served
    member = join(app, invite(admin))
    token = make_key(member, password="long-enough-password")["token"]
    ann = member.get("/api/auth/status").json()["me"]["id"]
    assert admin.delete(f"/api/people/{ann}").status_code == 204
    refused = httpx2.post(f"{url}/api/mcp/", headers={"authorization": f"Bearer {token}"})
    assert refused.status_code == 401
    assert refused.json()["error"]["code"] == "token_revoked"


WRITE_TOOLS = [
    "add_cards",
    "add_frame",
    "add_notes",
    "arrange",
    "connect",
    "create_board",
    "remove_elements",
    "update_elements",
]


def test_a_write_key_lays_a_board_out(served):
    app, url, admin = served
    board_id = board(admin)
    token = make_key(admin, scope="write")["token"]

    async def steps(client):
        names = await tool_names(client)
        frame = await client.call_tool("add_frame", {"board": board_id, "title": "Agent"})
        frame_id = frame.structured_content["created"][0]
        cards = await client.call_tool(
            "add_cards", {"board": board_id, "cards": [{"ref": "DEMO-2", "id": "agent-c"}]}
        )
        await client.call_tool(
            "add_notes", {"board": board_id, "notes": [{"text": "Check with QA", "id": "agent-n"}]}
        )
        arrow = await client.call_tool(
            "connect", {"board": board_id, "start": "agent-n", "end": "agent-c"}
        )
        laid = await client.call_tool(
            "arrange", {"board": board_id, "cards": ["agent-c"], "frame": frame_id}
        )
        gone = await client.call_tool("remove_elements", {"board": board_id, "ids": ["agent-n"]})
        human = await client.call_tool("remove_elements", {"board": board_id, "ids": ["n1"]})
        return names, cards, arrow, laid, gone, human

    names, cards, arrow, laid, gone, human = call(url, token, steps)
    assert names == sorted(READ_TOOLS + WRITE_TOOLS)
    assert cards.structured_content["created"] == ["agent-c"]
    assert not arrow.is_error
    assert laid.structured_content["elements"][0]["frame"]
    assert not gone.is_error
    assert human.is_error and "not_api_element" in human.content[0].text


def test_a_read_key_cannot_call_a_write_tool(served):
    app, url, admin = served
    board_id = board(admin)
    token = make_key(admin)["token"]

    async def steps(client):
        return await client.call_tool("add_notes", {"board": board_id, "notes": [{"text": "x"}]})

    result = call(url, token, steps)
    assert result.is_error and "scope_required" in result.content[0].text


def gantt_node(node_id: str, rows: list[dict], y: int = 0) -> dict:
    content = {"start": "2026-10-01", "end": "2026-12-31", "rows": rows}
    return {
        "id": node_id,
        "type": "module",
        "position": {"x": 0, "y": y},
        "data": {"kind": "gantt", "title": f"Plan {node_id}", "content": content},
    }


def epics(count: int, under: int) -> list[dict]:
    rows = []
    for i in range(count):
        rows.append(
            {"id": f"e{i}", "title": f"Epic {i}", "start": "2026-10-05", "end": "2026-10-09"}
        )
        rows += [
            {
                "id": f"e{i}-{j}",
                "parent": f"e{i}",
                "title": "x",
                "start": "2026-11-02",
                "end": "2026-11-06",
            }
            for j in range(under)
        ]
    return rows


def test_read_gantt_finds_the_boards_gantt_and_narrows_a_big_one(served):
    app, url, admin = served
    one = board(admin, "One", {"nodes": [gantt_node("g", epics(3, 50))], "edges": []})
    two = board(
        admin,
        "Two",
        {"nodes": [gantt_node("a", epics(1, 1)), gantt_node("b", [], 900)], "edges": []},
    )
    none = board(admin, "None")
    token = make_key(admin)["token"]

    async def steps(client):
        whole = await client.call_tool("read_gantt", {"board": one})
        branch = await client.call_tool("read_gantt", {"board": one, "branch": "e1"})
        window = await client.call_tool(
            "read_gantt", {"board": one, "start": "2026-10-05", "end": "2026-10-09"}
        )
        pick = await client.call_tool("read_gantt", {"board": two})
        picked = await client.call_tool("read_gantt", {"board": two, "gantt": "a"})
        missing = await client.call_tool("read_gantt", {"board": none})
        return whole, branch, window, pick, picked, missing

    whole, branch, window, pick, picked, missing = call(url, token, steps)
    folded = whole.structured_content
    assert [(r["id"], r["holds"]) for r in folded["gantt"]["rows"]] == [
        ("e0", 50),
        ("e1", 50),
        ("e2", 50),
    ]
    assert "branch" in folded["note"] and folded["url"].endswith(f"?board={one}")
    assert len(branch.structured_content["gantt"]["rows"]) == 51
    assert "note" not in branch.structured_content
    # The children start in November: only the epics' own bars touch the window.
    assert [r["id"] for r in window.structured_content["gantt"]["rows"]] == ["e0", "e1", "e2"]
    assert [g["id"] for g in pick.structured_content["gantts"]] == ["a", "b"]
    assert [r["id"] for r in picked.structured_content["gantt"]["rows"]] == ["e0", "e0-0"]
    assert missing.is_error and "no gantt" in missing.content[0].text
