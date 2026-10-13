"""Demo visitors against a running stack: start a demo, open the welcome board, hold its live
socket, drag cards. One run is one stage: ramp up to --users, hold, report.

Each visitor has a board of their own, so this measures many small rooms. The instance needs
TIKO_DEMO=1 and a TIKO_DEMO_LIMIT above --users. Run from backend/, see scripts/load/README.md.
"""

import argparse
import asyncio
import json
import random
import time
from collections import Counter, defaultdict

import httpx
import websockets
from pycrdt import (
    Decoder,
    Doc,
    Encoder,
    Map,
    create_awareness_message,
    create_sync_message,
    create_update_message,
    handle_sync_message,
    read_message,
)

args = None
timings: dict[str, list[float]] = defaultdict(list)
errors: Counter = Counter()
online = 0
measuring = False


def record(name: str, seconds: float) -> None:
    if measuring or name in ("demo", "boards", "board", "page", "ws_sync"):
        timings[name].append(seconds * 1000)


def presence(client: int, clock: int, state: dict) -> bytes:
    encoder = Encoder()
    encoder.write_var_uint(1)
    encoder.write_var_uint(client)
    encoder.write_var_uint(clock)
    encoder.write_var_string(json.dumps(state))
    return create_awareness_message(encoder.to_bytes())


async def visitor(index: int, stop: asyncio.Event) -> None:
    global online
    n = index + args.offset
    address = f"198.{18 + (n >> 16) % 2}.{(n >> 8) % 256}.{n % 256}"
    headers = {"X-Forwarded-For": address}
    try:
        async with httpx.AsyncClient(base_url=args.base, headers=headers, timeout=30) as http:
            for name, method, path in (
                ("page", "GET", "/"),
                ("demo", "POST", "/api/auth/demo"),
                ("boards", "GET", "/api/boards"),
            ):
                started = time.perf_counter()
                response = await http.request(method, path)
                record(name, time.perf_counter() - started)
                if response.status_code >= 400:
                    errors[f"{name} {response.status_code}"] += 1
                    return
            board_id = response.json()["boards"][0]["id"]
            started = time.perf_counter()
            response = await http.get(f"/api/boards/{board_id}")
            record("board", time.perf_counter() - started)
            cookie = "; ".join(f"{k}={v}" for k, v in http.cookies.items())
    except Exception as error:
        errors[f"http {type(error).__name__}"] += 1
        return

    url = args.base.replace("http", "ws", 1) + f"/api/boards/{board_id}/live"
    doc = Doc()
    nodes = doc.get("nodes", type=Map)
    doc.get("edges", type=Map)
    client, clock, sent = doc.client_id, 0, {}
    applying, outgoing, synced = False, [], asyncio.Event()

    def on_update(event) -> None:
        if not applying:
            outgoing.append(create_update_message(event.update))

    doc.observe(on_update)
    started = time.perf_counter()
    try:
        async with websockets.connect(
            url, additional_headers={"Cookie": cookie, **headers}, max_size=None, open_timeout=30
        ) as socket:

            async def read() -> None:
                nonlocal applying
                async for message in socket:
                    if not isinstance(message, bytes) or len(message) < 2:
                        continue
                    if message[0] == 0:
                        applying = True
                        try:
                            reply = handle_sync_message(message[1:], doc)
                        finally:
                            applying = False
                        if reply:
                            await socket.send(reply)
                        if message[1] == 1:
                            synced.set()
                    elif message[0] == 1:
                        decoder = Decoder(read_message(message[1:]))
                        for _ in range(decoder.read_var_uint()):
                            who, tick = decoder.read_var_uint(), decoder.read_var_uint()
                            decoder.read_var_string()
                            if who == client and tick in sent:
                                record("echo", time.perf_counter() - sent.pop(tick))

            async def say(state: dict) -> None:
                nonlocal clock
                clock += 1
                sent[clock] = time.perf_counter()
                await socket.send(presence(client, clock, state))

            reader = asyncio.create_task(read())
            await socket.send(create_sync_message(doc))
            await asyncio.wait_for(synced.wait(), 30)
            record("ws_sync", time.perf_counter() - started)
            online += 1
            me = {"id": str(n), "name": "Demo visitor", "color": n % 8}
            active = random.random() < args.active
            x = y = 0.0
            try:
                while not stop.is_set() and not reader.done():
                    if not active:
                        # What an open tab that nobody touches sends: the awareness heartbeat.
                        await say({"user": me, "cursor": None, "selected": [], "drag": None})
                        await asyncio.sleep(15 * random.uniform(0.8, 1.2))
                        continue
                    for _ in range(max(1, int(random.expovariate(1 / args.think) / 0.33))):
                        x, y = x + random.uniform(-40, 40), y + random.uniform(-40, 40)
                        await say(
                            {"user": me, "cursor": {"x": x, "y": y}, "selected": [], "drag": None}
                        )
                        await asyncio.sleep(0.33)
                    node_id = random.choice(list(nodes.keys()))
                    place = dict(nodes[node_id]["place"])
                    for _ in range(12):
                        place["x"] += random.uniform(-15, 15)
                        place["y"] += random.uniform(-15, 15)
                        await say(
                            {
                                "user": me,
                                "cursor": {"x": place["x"], "y": place["y"]},
                                "selected": [node_id],
                                "drag": {node_id: {"x": place["x"], "y": place["y"]}},
                            }
                        )
                        await asyncio.sleep(0.08)
                    nodes[node_id].update({"place": place})
                    while outgoing:
                        await socket.send(outgoing.pop(0))
            finally:
                online -= 1
                reader.cancel()
            if not stop.is_set():
                errors[f"ws closed {socket.close_code}"] += 1
    except Exception as error:
        errors[f"ws {type(error).__name__}"] += 1


async def lag(stop: asyncio.Event) -> None:
    """How late this process's own loop runs: echo times are only as good as this."""
    while not stop.is_set():
        started = time.perf_counter()
        await asyncio.sleep(0.05)
        record("client_lag", time.perf_counter() - started - 0.05)


async def container_stats(samples: list[str]) -> None:
    if not args.containers:
        return
    process = await asyncio.create_subprocess_exec(
        "docker",
        "stats",
        "--no-stream",
        "--format",
        "{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}",
        *args.containers,
        stdout=asyncio.subprocess.PIPE,
    )
    out, _ = await process.communicate()
    samples.append(" | ".join(out.decode().split("\n")).strip(" |"))


def line(name: str) -> str:
    values = sorted(timings[name])
    if not values:
        return f"{name:>10}: -"
    at = lambda q: values[min(len(values) - 1, int(len(values) * q))]  # noqa: E731
    return (
        f"{name:>10}: n={len(values):<7} p50={at(0.5):8.1f} p95={at(0.95):8.1f} "
        f"p99={at(0.99):8.1f} max={values[-1]:8.1f} ms"
    )


async def main() -> None:
    global measuring
    stop = asyncio.Event()
    tasks = [asyncio.create_task(lag(stop))]
    for index in range(args.users):
        tasks.append(asyncio.create_task(visitor(index, stop)))
        await asyncio.sleep(1 / args.rate)
    await asyncio.sleep(5)
    print(f"users={args.users} online after ramp={online}", flush=True)
    measuring, samples, at_start = True, [], online
    steps = max(1, args.hold // 10)
    print(f"measuring {time.time():.0f} {time.time() + 10 * steps:.0f}", flush=True)
    for _ in range(steps):
        await asyncio.gather(asyncio.sleep(10), container_stats(samples))
    measuring = False
    print(f"online at end of hold={online} (start {at_start})")
    stop.set()
    await asyncio.wait(tasks, timeout=30)
    for name in ("page", "demo", "boards", "board", "ws_sync", "echo", "client_lag"):
        print(line(name))
    print("errors:", dict(errors) or "none")
    for sample in samples:
        print("  ", sample)


parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://localhost:13000")
parser.add_argument("--users", type=int, default=50)
parser.add_argument("--rate", type=float, default=20, help="new visitors per second")
parser.add_argument("--hold", type=int, default=40)
parser.add_argument("--active", type=float, default=0.5, help="share of visitors who keep working")
parser.add_argument("--think", type=float, default=4, help="seconds of cursor between drags")
parser.add_argument("--offset", type=int, default=0)
parser.add_argument(
    "--containers", nargs="*", default=[], help="containers to sample with docker stats"
)
args = parser.parse_args()
asyncio.run(main())
