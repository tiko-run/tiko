"""Shared boards under load: rooms of people on big boards. One run is one step.

  rooms.py setup --boards 100 --nodes 1000     makes the boards, writes boards.json
  rooms.py run --rooms 20 --hold 180           fills 20 rooms and measures
  rooms.py sweep                               takes leftovers of a broken step off the boards

Every socket signs in as the same admin: a room counts connections, not people.
A room of 30: 5 drag elements, 2 create and delete them, 10 move the pointer, 13 watch.
"""

import argparse
import asyncio
import json
import multiprocessing
import random
import re
import time
from array import array
from collections import Counter

import httpx
import websockets
from pycrdt import (
    Doc,
    Encoder,
    Map,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
)

ROLES = ["drag"] * 5 + ["create"] * 2 + ["move"] * 10 + ["watch"] * 13
EMPTY_STEP1 = create_sync_message(Doc())
PRESENCE_MARK = re.compile(rb'"t":(\d+\.\d+)')
EDIT_MARK = re.compile(rb"ts:(\d+\.\d+);")
# Ids of the elements the load makes, so they can be told from the board's own.
MADE = "lt"


def sign_in(args) -> str:
    with httpx.Client(base_url=args.base, timeout=60) as http:
        answer = http.post("/api/auth/login", json={"username": "admin", "password": args.password})
        answer.raise_for_status()
        return "; ".join(f"{k}={v}" for k, v in http.cookies.items())


def setup(args) -> None:
    cookie = sign_in(args)
    boards = []
    with httpx.Client(base_url=args.base, timeout=120, headers={"Cookie": cookie}) as http:
        for n in range(1, 13):
            http.post("/api/tasks/resolve", json={"ref": f"DEMO-{n}"})
        for b in range(args.boards):
            nodes = []
            for i in range(args.nodes):
                x, y = (i % 40) * 320, (i // 40) * 240
                if i % 4 == 0:
                    node = {"type": "task_card", "data": {"key": f"DEMO-{i % 12 + 1}"}}
                elif i % 20 == 1:
                    node = {"type": "text", "data": {"text": f"Section {i}"}}
                else:
                    node = {
                        "type": "sticky",
                        "width": 200,
                        "height": 200,
                        "data": {
                            "text": f"Note {i}: ask about the rollout plan",
                            "color": "yellow",
                        },
                    }
                nodes.append({"id": f"n{i}", "position": {"x": x, "y": y}, **node})
            made = http.post("/api/boards", json={"name": f"Load {b}"})
            made.raise_for_status()
            board = made.json()
            version = http.get(f"/api/boards/{board['id']}").json()["version"]
            saved = http.put(
                f"/api/boards/{board['id']}",
                json={"version": version, "doc": {"nodes": nodes, "edges": []}},
            )
            if saved.status_code >= 400:
                print(saved.text[:400])
            saved.raise_for_status()
            boards.append(board["id"])
    with open(args.file, "w") as out:
        json.dump(boards, out)
    print(f"{len(boards)} boards of {args.nodes} elements")


def sweep(args, cookie: str, boards: list[str]) -> None:
    """Takes off the boards what a step left behind: a socket that was closed or failed never
    got to delete the elements it made."""
    left = 0
    with httpx.Client(base_url=args.base, timeout=120, headers={"Cookie": cookie}) as http:
        for board_id in boards:
            board = http.get(f"/api/boards/{board_id}").json()
            nodes = board["doc"]["nodes"]
            kept = [node for node in nodes if not node["id"].startswith(MADE)]
            if len(kept) == len(nodes):
                continue
            doc = {**board["doc"], "nodes": kept}
            saved = http.put(
                f"/api/boards/{board_id}", json={"version": board["version"], "doc": doc}
            )
            if saved.status_code >= 400:
                print(f"board {board_id} was not swept: {saved.status_code}; make the boards anew")
            else:
                left += len(nodes) - len(kept)
    print(f"swept {left} leftover elements")


def presence(client: int, clock: int, state: dict) -> bytes:
    encoder = Encoder()
    encoder.write_var_uint(1)
    encoder.write_var_uint(client)
    encoder.write_var_uint(clock)
    encoder.write_var_string(json.dumps(state, separators=(",", ":")))
    return create_awareness_message(encoder.to_bytes())


class Stats:
    def __init__(self) -> None:
        self.times = {name: array("f") for name in ("join", "presence", "edit", "client_lag")}
        self.errors: Counter = Counter()
        self.online = 0
        self.measuring = False

    def record(self, name: str, seconds: float) -> None:
        if self.measuring or name == "join":
            self.times[name].append(seconds * 1000)


async def person(
    args, stats: Stats, cookie: str, board_id: str, index: int, role: str, until: float
):
    url = args.base.replace("http", "ws", 1) + f"/api/boards/{board_id}/live"
    heavy = role in ("drag", "create")
    doc = Doc() if heavy else None
    nodes = doc.get("nodes", type=Map) if heavy else None
    if heavy:
        doc.get("edges", type=Map)
    client = doc.client_id if heavy else random.getrandbits(31)
    applying, outgoing, synced, clock = False, [], asyncio.Event(), 0
    samples = role == "watch"

    def on_update(event) -> None:
        if not applying:
            outgoing.append(create_update_message(event.update))

    if heavy:
        doc.observe(on_update)
    started = time.perf_counter()
    try:
        async with websockets.connect(
            url, additional_headers={"Cookie": cookie}, max_size=None, open_timeout=30
        ) as socket:

            async def read() -> None:
                nonlocal applying
                seen = 0
                async for message in socket:
                    if not isinstance(message, bytes) or len(message) < 2:
                        continue
                    if message[0] == 0:
                        if message[1] == 2 and samples:
                            mark = EDIT_MARK.search(message)
                            if mark:
                                stats.record("edit", time.time() - float(mark.group(1)))
                        if heavy:
                            applying = True
                            try:
                                reply = handle_sync_message(message[1:], doc)
                            finally:
                                applying = False
                            if reply:
                                await socket.send(reply)
                        if message[1] == 1:
                            synced.set()
                    elif message[0] == 1 and samples:
                        seen += 1
                        # One in ten: a full room sends hundreds of presence frames a second.
                        if seen % 10 == 0:
                            # Every state in the frame: one frame may carry several tabs.
                            now = time.time()
                            for mark in PRESENCE_MARK.finditer(message):
                                stats.record("presence", now - float(mark.group(1)))

            async def say(cursor, selected=(), drag=None) -> None:
                nonlocal clock
                clock += 1
                state = {
                    "user": {"id": str(index), "name": "Load", "color": index % 8},
                    "cursor": cursor,
                    "selected": list(selected),
                    "drag": drag,
                    "t": round(time.time(), 4),
                }
                await socket.send(presence(client, clock, state))

            async def flush() -> None:
                while outgoing:
                    await socket.send(outgoing.pop(0))

            async def wander(seconds: float, x: float, y: float) -> tuple[float, float]:
                for _ in range(int(seconds * args.fps)):
                    x, y = x + random.uniform(-30, 30), y + random.uniform(-30, 30)
                    await say({"x": x, "y": y})
                    await asyncio.sleep(1 / args.fps)
                return x, y

            reader = asyncio.create_task(read())
            await socket.send(create_sync_message(doc) if heavy else EMPTY_STEP1)
            await asyncio.wait_for(synced.wait(), 60)
            stats.record("join", time.perf_counter() - started)
            stats.online += 1
            x, y, made, created = random.uniform(0, 5000), random.uniform(0, 5000), [], 0
            try:
                while time.time() < until and not reader.done():
                    if role == "watch":
                        await say(None)
                        await asyncio.sleep(15 * random.uniform(0.8, 1.2))
                    elif role == "move":
                        x, y = await wander(random.uniform(1, 3), x, y)
                        await asyncio.sleep(random.uniform(1.5, 4.5))
                    elif role == "drag":
                        x, y = await wander(random.uniform(0.5, 1.5), x, y)
                        node_id = random.choice(list(nodes.keys()))
                        place = dict(nodes[node_id]["place"])
                        for _ in range(args.fps):
                            place["x"] += random.uniform(-15, 15)
                            place["y"] += random.uniform(-15, 15)
                            spot = {"x": place["x"], "y": place["y"]}
                            await say(spot, [node_id], {node_id: spot})
                            await asyncio.sleep(1 / args.fps)
                        # Whoever made the element may have deleted it during the drag.
                        if node_id in nodes:
                            nodes[node_id].update({"place": place})
                        await flush()
                        await asyncio.sleep(random.uniform(1, 4))
                    else:
                        x, y = await wander(random.uniform(0.5, 1.5), x, y)
                        created += 1
                        node_id = f"{MADE}{client:x}-{created}"
                        nodes[node_id] = Map(
                            {
                                "type": "sticky",
                                "place": {"x": x, "y": y},
                                "size": {"width": 200, "height": 200},
                                "order": 1e6 + clock,
                                "data": Map({"text": f"ts:{time.time():.4f};", "color": "yellow"}),
                            }
                        )
                        made.append(node_id)
                        if len(made) > 15:
                            nodes.pop(made.pop(0))
                        await flush()
                        await asyncio.sleep(random.uniform(3, 7))
                # The board goes back to its size, so the next step starts from the same one.
                if made and not reader.done():
                    for node_id in made:
                        nodes.pop(node_id)
                    await flush()
                    await asyncio.sleep(0.5)
            finally:
                stats.online -= 1
                reader.cancel()
            if time.time() < until:
                stats.errors[f"closed {socket.close_code}"] += 1
    except Exception as error:
        stats.errors[f"{role} {type(error).__name__}"] += 1


async def work(
    args, cookie: str, boards: list[str], starts: list[float], measure: float, end: float
):
    stats = Stats()

    async def lag() -> None:
        while time.time() < end:
            asked = time.perf_counter()
            await asyncio.sleep(0.05)
            stats.record("client_lag", time.perf_counter() - asked - 0.05)

    async def later(delay: float, job) -> None:
        await asyncio.sleep(max(0.0, delay))
        await job

    jobs = [asyncio.create_task(lag())]
    for board_id, start in zip(boards, starts, strict=True):
        for index, role in enumerate(ROLES[: args.per_room]):
            delay = start + index * args.gap - time.time()
            job = person(args, stats, cookie, board_id, index, role, end)
            jobs.append(asyncio.create_task(later(delay, job)))
    await asyncio.sleep(max(0.0, measure - time.time()))
    stats.measuring, at_start = True, stats.online
    await asyncio.sleep(max(0.0, end - time.time() - 0.5))
    stats.measuring, at_end = False, stats.online
    await asyncio.wait(jobs, timeout=30)
    return (
        {name: values.tobytes() for name, values in stats.times.items()},
        stats.errors,
        at_start,
        at_end,
    )


def worker(args, cookie, boards, starts, measure, end, results) -> None:
    results.put(asyncio.run(work(args, cookie, boards, starts, measure, end)))


def line(name: str, values) -> str:
    values = sorted(values)
    if not values:
        return f"{name:>10}: -"
    at = lambda q: values[min(len(values) - 1, int(len(values) * q))]  # noqa: E731
    return (
        f"{name:>10}: n={len(values):<8} p50={at(0.5):8.1f} p95={at(0.95):8.1f} "
        f"p99={at(0.99):8.1f} max={values[-1]:8.1f} ms"
    )


def run(args) -> None:
    with open(args.file) as source:
        boards = json.load(source)[: args.rooms]
    cookie = sign_in(args)
    now = time.time() + 3
    # Rooms fill one after another: a whole team does not open a board in the same second.
    starts = [now + room * args.room_gap for room in range(len(boards))]
    measure = starts[-1] + args.per_room * args.gap + 10
    end = measure + args.hold
    print(
        f"rooms={len(boards)} people={len(boards) * args.per_room} "
        f"measure in {measure - time.time():.0f}s",
        flush=True,
    )
    print(f"measuring {measure:.0f} {end:.0f}", flush=True)
    results, procs = multiprocessing.Queue(), []
    for part in range(args.procs):
        mine = slice(part, None, args.procs)
        if boards[mine]:
            proc = multiprocessing.Process(
                target=worker,
                args=(args, cookie, boards[mine], starts[mine], measure, end, results),
            )
            proc.start()
            procs.append(proc)
    merged = {name: array("f") for name in ("join", "presence", "edit", "client_lag")}
    errors, at_start, at_end = Counter(), 0, 0
    for _ in procs:
        times, failed, online_start, online_end = results.get()
        for name, raw in times.items():
            merged[name].frombytes(raw)
        errors += failed
        at_start, at_end = at_start + online_start, at_end + online_end
    for proc in procs:
        proc.join()
    print(f"window {measure:.0f} {end:.0f} online start={at_start} end={at_end}")
    for name, values in merged.items():
        print(line(name, values))
    print("errors:", dict(errors) or "none")
    sweep(args, cookie, boards)


parser = argparse.ArgumentParser()
parser.add_argument("mode", choices=["setup", "run", "sweep"])
parser.add_argument("--base", default="http://localhost:13000")
parser.add_argument("--password", default="load-test-password")
parser.add_argument("--file", default="boards.json")
parser.add_argument("--boards", type=int, default=5)
parser.add_argument("--nodes", type=int, default=1000)
parser.add_argument("--rooms", type=int, default=1)
parser.add_argument("--per-room", type=int, default=30)
parser.add_argument("--hold", type=int, default=60)
parser.add_argument("--fps", type=int, default=20, help="presence frames a second while moving")
parser.add_argument("--gap", type=float, default=0.1, help="seconds between people joining a room")
parser.add_argument("--room-gap", type=float, default=1.0, help="seconds between rooms filling")
parser.add_argument("--procs", type=int, default=4)

if __name__ == "__main__":
    args = parser.parse_args()
    if args.mode == "setup":
        setup(args)
    elif args.mode == "run":
        run(args)
    else:
        with open(args.file) as source:
            sweep(args, sign_in(args), json.load(source))
