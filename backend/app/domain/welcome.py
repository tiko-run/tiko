import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any

from app.domain import planning_sample as sample

WELCOME_NAME = "Welcome to tiko"

_PAD, _TITLE = 24, 48
_STICKY = 200
_SPRINT_X = 560
# Wide enough columns that the timer beside a card in the second one has room.
_CELL_W, _CELL_H = 390, 96
# Taller than the plain Gantt: stages with names under them need the room.
_PLANNED_H = 300

_NOTES = [
    (
        "yellow",
        "This board is a playground. Move, edit or delete anything: the cards are demo tasks.",
    ),
    ("blue", "Add a task with the Task card tool (C): type DEMO-5, or a query like project = DEMO"),
    ("green", "Drag cards in and out of frames. Press ⌘K to search the board, ? for shortcuts"),
    (
        "pink",
        "Connect your tracker in Settings, then make a new board for your own tasks. "
        "Delete this one any time.",
    ),
]
# On a public demo nobody connects a tracker, and the board does not stay.
_DEMO_NOTE = (
    "pink",
    "This is a demo: only you see your boards, kept 7 days after your last visit. Keep real "
    "work data out; to use your own tracker, install tiko: tiko.run",
)
# Two columns of cards, filled row by row; the last one starts collapsed.
_CARDS = ["DEMO-1", "DEMO-2", "DEMO-7", "DEMO-6", "DEMO-11", "DEMO-3"]


def _id() -> str:
    return uuid.uuid4().hex


def welcome_doc(now: datetime, demo: bool = False) -> dict[str, Any]:
    """The board a fresh install opens on: every kind of element, dated from `now`."""
    today = now.date()
    nodes: list[dict[str, Any]] = [
        {
            "id": _id(),
            "type": "text",
            "position": {"x": 0, "y": -90},
            "width": 640,
            "height": 50,
            "data": {"text": "Welcome to tiko: live task cards on an infinite canvas"},
        }
    ]

    start = _id()
    nodes.append(
        {
            "id": start,
            "type": "frame",
            "position": {"x": 0, "y": 0},
            "width": _PAD * 3 + _STICKY * 2,
            "height": _TITLE + _PAD * 2 + _STICKY * 2,
            "data": {"title": "Start here"},
        }
    )
    notes = []
    for i, (color, text) in enumerate([*_NOTES[:-1], _DEMO_NOTE] if demo else _NOTES):
        note = _id()
        notes.append(note)
        nodes.append(
            {
                "id": note,
                "type": "sticky",
                "parentId": start,
                "position": {
                    "x": _PAD + (i % 2) * (_STICKY + _PAD),
                    "y": _TITLE + (i // 2) * (_STICKY + _PAD),
                },
                "width": _STICKY,
                "height": _STICKY,
                "data": {"text": text, "color": color},
            }
        )

    sprint = _id()
    nodes.append(
        {
            "id": sprint,
            "type": "frame",
            "position": {"x": _SPRINT_X, "y": 0},
            "width": _PAD + _CELL_W * 2,
            "height": _TITLE + _CELL_H * 3 + _PAD,
            "data": {"title": "This sprint"},
        }
    )
    cards: dict[str, str] = {}
    for i, key in enumerate(_CARDS):
        cards[key] = _id()
        nodes.append(
            {
                "id": cards[key],
                "type": "task_card",
                "parentId": sprint,
                "position": {"x": _PAD + (i % 2) * _CELL_W, "y": _TITLE + (i // 2) * _CELL_H},
                "data": {"key": key, "source": "demo", "collapsed": key == _CARDS[-1]},
            }
        )
        if key == "DEMO-2":
            nodes.append(
                {
                    "id": _id(),
                    "type": "timer",
                    "parentId": cards[key],
                    "position": {"x": -46, "y": 0},
                    "width": 40,
                    "height": 40,
                    "data": {
                        "note": "Ask QA whether the proxy fix works",
                        "dueAt": (now + timedelta(days=1)).isoformat(),
                    },
                }
            )

    def day(offset: int) -> str:
        return (today + timedelta(days=offset)).isoformat()

    nodes.append(
        {
            "id": _id(),
            "type": "module",
            "position": {"x": 0, "y": 560},
            "width": _SPRINT_X + _PAD + _CELL_W * 2,
            "height": _PLANNED_H if demo else 240,
            "data": {
                "kind": "gantt",
                "title": "Release plan",
                "content": _planned_gantt(today) if demo else _plain_gantt(day),
            },
        }
    )

    edges = [
        {
            "id": _id(),
            "source": notes[1],
            "target": cards["DEMO-1"],
            "sourceHandle": "r",
            "targetHandle": "l",
        },
        {
            "id": _id(),
            "source": cards["DEMO-7"],
            "target": cards["DEMO-6"],
            "sourceHandle": "r",
            "targetHandle": "l",
        },
    ]
    return {"nodes": nodes, "edges": edges}


def _plain_gantt(day: Callable[[int], str]) -> dict[str, Any]:
    epic, crash, story = _id(), _id(), _id()
    return {
        "start": day(-7),
        "end": day(42),
        "scale": "week",
        "rows": [
            {"id": epic, "key": "DEMO-4", "source": "demo", "start": day(-3), "end": day(16)},
            {
                "id": crash,
                "key": "DEMO-7",
                "source": "demo",
                "start": day(-3),
                "end": day(4),
                "parent": epic,
            },
            {
                "id": story,
                "key": "DEMO-1",
                "source": "demo",
                "start": day(5),
                "end": day(12),
                "parent": epic,
            },
            {"id": _id(), "title": "Release notes", "start": day(13), "end": day(16)},
        ],
        "milestones": [{"id": _id(), "date": day(17), "title": "Release"}],
        "links": [{"id": _id(), "from": crash, "to": story}],
    }


def _planned_gantt(today: date) -> dict[str, Any]:
    """The demo's Gantt in Planning mode: stages with sample people, columns, working days."""

    def wd(n: int) -> str:
        return sample.workday(today, n).isoformat()

    def stage(type_id: str, start: int, end: int, *who: str) -> dict[str, Any]:
        return {
            "id": _id(),
            "type": type_id,
            "start": wd(start),
            "end": wd(end),
            "people": list(who),
        }

    def row(stages: list[dict[str, Any]], **fields: Any) -> dict[str, Any]:
        return {
            "id": _id(),
            "start": stages[0]["start"],
            "end": stages[-1]["end"],
            "stages": stages,
            **fields,
        }

    epic = _id()
    crash = row(
        [
            stage(sample.DISCOVERY, -4, -1, sample.ANNA),
            stage(sample.BUILD, 0, 4, sample.ANNA, sample.BEN),
        ],
        key="DEMO-7",
        source="demo",
        parent=epic,
        values={"size": "S"},
    )
    # Chloe's Build overlaps her time off in the sample, so this stage gets the red outline.
    story = row(
        [
            stage(sample.DESIGN, 5, 8, sample.CHLOE),
            stage(sample.BUILD, 9, 14, sample.CHLOE, sample.BEN),
        ],
        key="DEMO-1",
        source="demo",
        parent=epic,
        values={"size": "M"},
    )
    notes = row(
        [stage(sample.REVIEW, 15, 17, sample.DEV)],
        title="Release notes",
        values={"priority": "Medium", "team": "Platform", "size": "S"},
    )
    return {
        "start": wd(-5),
        "end": wd(21),
        "scale": "week",
        "workingDays": True,
        "columns": ["priority", "size", "team"],
        "rows": [
            {
                "id": epic,
                "key": "DEMO-4",
                "source": "demo",
                "start": crash["start"],
                "end": story["end"],
                "values": {"priority": "High", "team": "Web"},
            },
            crash,
            story,
            notes,
        ],
        "milestones": [{"id": _id(), "date": wd(18), "title": "Release"}],
        "links": [{"id": _id(), "from": crash["id"], "to": story["id"]}],
    }
