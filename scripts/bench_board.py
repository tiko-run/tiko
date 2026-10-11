"""Seed a "bench 300" board: 10 frames with 30 demo cards each. Stdlib only, runs in the api
container: `docker compose exec -T api python - < scripts/bench_board.py`. Delete the board
from the board menu when done."""

import json
import os
import urllib.request

API = os.environ.get("BENCH_API_URL", "http://localhost:8000")
FRAMES, PER_FRAME, COLUMNS = 10, 30, 5
CARD_W, CARD_H, GAP = 300, 56, 16


def call(method: str, path: str, body: dict | None = None) -> dict | None:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        f"{API}{path}", data=data, method=method, headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


settings = call("GET", "/api/settings")
# Snapshots for the demo keys exist only once the demo provider has resolved them.
call("PUT", "/api/settings", {"provider": "demo"})
try:
    for n in range(1, 13):
        call("POST", "/api/tasks/resolve", {"ref": f"DEMO-{n}"})
finally:
    call("PUT", "/api/settings", {"provider": settings["provider"]})

frame_w = COLUMNS * (CARD_W + GAP) + GAP
frame_h = (PER_FRAME // COLUMNS) * (CARD_H + GAP) + GAP + 24
nodes = []
for f in range(FRAMES):
    frame_id = f"frame-{f}"
    nodes.append(
        {
            "id": frame_id,
            "type": "frame",
            "position": {"x": (f % 2) * (frame_w + 80), "y": (f // 2) * (frame_h + 80)},
            "width": frame_w,
            "height": frame_h,
            "data": {"title": f"Frame {f + 1}"},
        }
    )
    for c in range(PER_FRAME):
        nodes.append(
            {
                "id": f"card-{f}-{c}",
                "type": "task_card",
                "parentId": frame_id,
                "position": {
                    "x": GAP + (c % COLUMNS) * (CARD_W + GAP),
                    "y": GAP + 24 + (c // COLUMNS) * (CARD_H + GAP),
                },
                "data": {"key": f"DEMO-{(f * PER_FRAME + c) % 12 + 1}"},
            }
        )

board = call("POST", "/api/boards", {"name": "bench 300"})
call(
    "PUT",
    f"/api/boards/{board['id']}",
    {"version": 1, "doc": {"nodes": nodes, "edges": [], "viewport": {"x": 40, "y": 40, "zoom": 0.4}}},
)
print(f"board {board['id']}: {FRAMES} frames, {FRAMES * PER_FRAME} cards")
print(f"open http://localhost:3000/?board={board['id']}")
