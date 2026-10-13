"""Runs a step several times and prints the median and the spread of every number it prints.

With `--variant` the same step runs against several builds in turn on one target, so the
builds meet the same machine on the same day.
"""

import argparse
import ast
import re
import shlex
import statistics
import subprocess
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path

TIMING = re.compile(r"^\s*(\w+): n=\S+\s+p50=\s*([\d.]+) p95=\s*([\d.]+) p99=\s*([\d.]+)")
NUMBER = re.compile(r"^\s*([^:=]+): (-?[\d.]+)$")
MEASURING = re.compile(r"^measuring (\d+) (\d+)")


def cpu_usec(container: str) -> int:
    out = subprocess.run(
        [*shlex.split(args.docker), "exec", container, "cat", "/sys/fs/cgroup/cpu.stat"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return int(re.search(r"usage_usec (\d+)", out).group(1))


def sample_containers(start: float, end: float, found: dict[str, float]) -> None:
    """CPU each container used inside the window, from its cgroup: node exporter cannot tell them apart."""
    time.sleep(max(0, start - time.time()))
    before = {name: (time.time(), cpu_usec(name)) for name in args.containers}
    time.sleep(max(0, end - time.time()))
    for name, (at, usec) in before.items():
        found[f"{name} cpu % of a core"] = (cpu_usec(name) - usec) / (time.time() - at) / 1e4


def numbers(lines: list[str]) -> dict[str, float]:
    found = {}
    for text in lines:
        if timing := TIMING.match(text):
            name = timing.group(1)
            for quantile, value in zip(("p50", "p95", "p99"), timing.groups()[1:], strict=True):
                found[f"{name} {quantile} ms"] = float(value)
        elif text.startswith("errors:"):
            said = text.split(":", 1)[1].strip()
            found["errors"] = 0 if said == "none" else sum(ast.literal_eval(said).values())
        elif number := NUMBER.match(text):
            found[number.group(1).strip()] = float(number.group(2))
    return found


def one_run(serial: int) -> dict[str, float]:
    words = [word.replace("{run}", str(serial)) for word in args.step]
    step = subprocess.Popen(words, stdout=subprocess.PIPE, text=True)
    lines, window, cpu, sampler = [], None, {}, None
    for text in step.stdout:
        print("   ", text, end="", flush=True)
        lines.append(text.rstrip("\n"))
        if (said := MEASURING.match(text)) and not window:
            window = said.groups()
            if args.containers:
                sampler = threading.Thread(
                    target=sample_containers, args=(float(window[0]), float(window[1]), cpu)
                )
                sampler.start()
    if step.wait():
        sys.exit(f"the step ended with {step.returncode}")
    if sampler:
        sampler.join()
    found = numbers(lines) | cpu
    if args.window and window:
        seen = subprocess.run(
            [sys.executable, Path(__file__).with_name("window.py"), *window],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        found |= numbers(seen.splitlines())
    return found


def main() -> None:
    variants = [variant.split("=", 1) for variant in args.variant] or [("", "")]
    runs = {name: defaultdict(list) for name, _ in variants}
    serial = 0
    # In turn, not one build after the other: what drifts over the hour drifts for all of them.
    for run in range(args.runs):
        for name, switch in variants:
            if serial:
                time.sleep(args.pause)
            print(f"run {run + 1} of {args.runs} {name}".rstrip(), flush=True)
            if switch:
                subprocess.run(switch, shell=True, check=True)
            for label, value in one_run(serial).items():
                runs[name][label].append(value)
            serial += 1
    for name, labels in runs.items():
        print(f"\n{name or 'step'}: median [least .. most] of {args.runs} runs")
        for label, values in labels.items():
            print(
                f"{label:>28}: {statistics.median(values):9.1f}"
                f"   [{min(values):.1f} .. {max(values):.1f}]"
            )


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--runs", type=int, default=3)
parser.add_argument("--pause", type=float, default=40, help="seconds between runs")
parser.add_argument(
    "--variant",
    action="append",
    default=[],
    metavar="NAME=COMMAND",
    help="a build and the shell command that puts it in place and returns when it answers",
)
parser.add_argument("--containers", nargs="*", default=[], help="containers to read the CPU of")
parser.add_argument(
    "--docker", default="docker", help='how to reach docker on the target, like "ssh target docker"'
)
parser.add_argument("--window", action="store_true", help="add the server's side from window.py")
parser.add_argument(
    "step",
    nargs=argparse.REMAINDER,
    help="after --, the step to run; {run} in it becomes 0, 1, 2 and so on",
)

if __name__ == "__main__":
    args = parser.parse_args()
    args.step = [word for word in args.step if word != "--"] if args.step[:1] == ["--"] else args.step
    if not args.step:
        parser.error("no step given after --")
    main()
