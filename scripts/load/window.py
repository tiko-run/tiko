"""Server-side numbers of one measured window, from Prometheus.

Several API processes are summed; `PROM` names another Prometheus than the local one.
"""

import json
import os
import sys
import urllib.parse
import urllib.request

start, end = float(sys.argv[1]), float(sys.argv[2])
w = f"{int(end - start)}s"


def q(expr: str):
    url = (
        os.environ.get("PROM", "http://127.0.0.1:9090")
        + "/api/v1/query?"
        + urllib.parse.urlencode({"query": expr, "time": end})
    )
    return json.load(urllib.request.urlopen(url))["data"]["result"]


def one(expr: str, scale: float = 1.0, digits: int = 1) -> str:
    found = q(expr)
    try:
        return str(round(float(found[0]["value"][1]) * scale, digits)) if found else "-"
    except ValueError:
        return "-"


lag = f"sum by (le) (rate(tiko_event_loop_lag_seconds_bucket[{w}]))"
rows = [
    ("host cpu busy %", f'100 * (1 - avg(rate(node_cpu_seconds_total{{mode="idle"}}[{w}])))', 1),
    ("host cpu steal %", f'100 * avg(rate(node_cpu_seconds_total{{mode="steal"}}[{w}]))', 1),
    ("api cpu % of a core", f'100 * sum(rate(process_cpu_seconds_total{{job="tiko"}}[{w}]))', 1),
    (
        "busiest process %",
        f'100 * max(rate(process_cpu_seconds_total{{job="tiko"}}[{w}]))',
        1,
    ),
    ("api rss MiB", 'sum(process_resident_memory_bytes{job="tiko"}) / 1048576', 1),
    ("open fds", 'sum(process_open_fds{job="tiko"})', 1),
    ("rooms", "sum(tiko_live_rooms)", 1),
    ("sockets", "sum(tiko_live_sockets)", 1),
    (
        "loop lag p50 ms",
        f"1000 * histogram_quantile(0.5, {lag})",
        1,
    ),
    (
        "loop lag p95 ms",
        f"1000 * histogram_quantile(0.95, {lag})",
        1,
    ),
    (
        "loop lag p99 ms",
        f"1000 * histogram_quantile(0.99, {lag})",
        1,
    ),
    ("msgs in /s", f'sum(rate(tiko_live_messages_total{{direction="in"}}[{w}]))', 1),
    ("msgs out /s", f'sum(rate(tiko_live_messages_total{{direction="out"}}[{w}]))', 1),
    (
        "presence out /s",
        f'sum(rate(tiko_live_messages_total{{direction="out",kind="awareness"}}[{w}]))',
        1,
    ),
    ("net out Mbit/s", f'8 * sum(rate(tiko_live_bytes_total{{direction="out"}}[{w}])) / 1e6', 1),
    ("checks /s", f"sum(rate(tiko_live_check_seconds_count[{w}]))", 1),
    (
        "check avg ms",
        f"1000 * sum(rate(tiko_live_check_seconds_sum[{w}]))"
        f" / sum(rate(tiko_live_check_seconds_count[{w}]))",
        1,
    ),
    ("check share of a core %", f"100 * sum(rate(tiko_live_check_seconds_sum[{w}]))", 1),
    (
        "save avg ms",
        f"1000 * sum(rate(tiko_live_save_seconds_sum[{w}]))"
        f" / sum(rate(tiko_live_save_seconds_count[{w}]))",
        1,
    ),
    (
        "db wait avg ms",
        f"1000 * sum(rate(tiko_db_wait_seconds_sum[{w}]))"
        f" / sum(rate(tiko_db_wait_seconds_count[{w}]))",
        1,
    ),
    ("outbox max", f"max(max_over_time(tiko_live_outbox_max[{w}]))", 1),
]
for label, expr, scale in rows:
    print(f"{label:>24}: {one(expr, scale)}")
closes = {
    r["metric"]["code"]: round(float(r["value"][1]))
    for r in q(f"sum by (code) (increase(tiko_live_closes_total[{w}]))")
}
print(f"{'server closes':>24}: {({k: v for k, v in closes.items() if v}) or 'none'}")
