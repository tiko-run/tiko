"""Top frames of a py-spy profile written with `--format raw`: `profile.py prof.txt`."""

import collections
import pathlib
import sys

self_t, incl = collections.Counter(), collections.Counter()
total = 0
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    stack, _, n = line.rstrip().rpartition(" ")
    if not stack or not n.isdigit():
        continue
    n = int(n)
    total += n
    frames = stack.split(";")
    self_t[frames[-1]] += n
    for f in set(frames):
        incl[f] += n
print(f"samples={total}")
print("-- self time")
for f, n in self_t.most_common(14):
    print(f"{100 * n / total:5.1f}%  {f[:110]}")
print("-- inclusive, app code")
for f, n in [
    x for x in incl.most_common(400) if "/app/app/" in x[0] or "app/" in x[0].split(" ")[-1]
][:18]:
    print(f"{100 * n / total:5.1f}%  {f[:110]}")
