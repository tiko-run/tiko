from datetime import date, timedelta

from app.domain.planning import PlanningPerson, StageType, TimeOff

# Fixed ids, so the welcome boards made on a demo keep pointing at them after a rewrite.
DISCOVERY, DESIGN, BUILD, REVIEW, ON_HOLD = (
    "demo-discovery",
    "demo-design",
    "demo-build",
    "demo-review",
    "demo-on-hold",
)
ANNA, BEN, CHLOE, DEV, ELIF = "demo-anna", "demo-ben", "demo-chloe", "demo-dev", "demo-elif"

TYPES = [
    StageType(id=DISCOVERY, name="Discovery", hue=75),
    StageType(id=DESIGN, name="Design", hue=150),
    StageType(id=BUILD, name="Build", hue=250),
    StageType(id=REVIEW, name="Review", hue=300),
    StageType(id=ON_HOLD, name="On hold", hue=25),
]
_PEOPLE = [
    (ANNA, "Anna", ["Web"]),
    (BEN, "Ben", ["Web"]),
    (CHLOE, "Chloe", ["Mobile"]),
    (DEV, "Dev", ["Platform"]),
    (ELIF, "Elif", ["Platform"]),
]
# Everything a demo shows; other rows in its database stay hidden.
IDS = frozenset([*(t.id for t in TYPES), *(pid for pid, _, _ in _PEOPLE)])
# Chloe is away during her Build stage on the welcome Gantt, so it shows the red outline.
CHLOE_OFF = (11, 13)


def workday(today: date, n: int) -> date:
    """The working day `n` working days after today, or after the next Monday on a weekend."""
    day = today + timedelta(days=(7 - today.weekday()) % 7 if today.weekday() > 4 else 0)
    step = 1 if n >= 0 else -1
    for _ in range(abs(n)):
        day += timedelta(days=step)
        while day.weekday() > 4:
            day += timedelta(days=step)
    return day


def people(today: date) -> list[PlanningPerson]:
    """The demo's people; time off is dated from today, so it stays near on a long run."""
    off = {
        CHLOE: [
            TimeOff(
                id="demo-chloe-off",
                start=workday(today, CHLOE_OFF[0]),
                end=workday(today, CHLOE_OFF[1]),
            )
        ]
    }
    return [
        PlanningPerson(id=pid, name=name, teams=teams, source="manual", off=off.get(pid, []))
        for pid, name, teams in _PEOPLE
    ]
