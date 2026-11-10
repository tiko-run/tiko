"""A gantt as API v1 shows it (spec 047). The follow cases mirror the web app's follow.test.ts."""

from datetime import date

import pytest

from app.domain.api_gantt import Names, gantt_view, narrow, tracker_span
from app.domain.errors import NotFound
from app.domain.tasks import Task

D = date.fromisoformat


def task(key: str = "DEMO-1", source: str = "demo", **dates) -> Task:
    return Task(
        source=source,
        key=key,
        summary="Rotate the staging certificates",
        status_name="To Do",
        url="https://tracker.example/DEMO-1",
        fetched_at="2026-11-10T09:00:00Z",
        **dates,
    )


ROW = {"id": "a", "key": "DEMO-1", "title": "", "start": "2026-10-05", "end": "2026-10-09"}


def content(*rows, **extra) -> dict:
    return {
        "start": "2026-10-01",
        "end": "2026-12-31",
        "rows": list(rows),
        "milestones": [],
        "links": [],
        **extra,
    }


def view(gantt: dict, tasks=(), names: Names | None = None):
    found = {f"{t.source}:{t.key}": t for t in tasks}
    return gantt_view(gantt, found, "demo", names).rows


def dump(row) -> dict:
    return row.model_dump(mode="json")


def test_a_missing_date_is_a_week_from_the_other():
    both = tracker_span(task(start=D("2026-11-02"), due=D("2026-11-20")))
    assert (both.start, both.end, both.guessed) == (D("2026-11-02"), D("2026-11-20"), None)
    due = tracker_span(task(due=D("2026-11-20")))
    assert (due.start, due.end, due.guessed) == (D("2026-11-14"), D("2026-11-20"), "start")
    start = tracker_span(task(start=D("2026-11-02")))
    assert (start.start, start.end, start.guessed) == (D("2026-11-02"), D("2026-11-08"), "end")
    assert tracker_span(task()) is None
    assert tracker_span(task(due=D("2026-11-20"), state="no_token")) is None


def test_following_rows_take_the_tracker_dates_others_and_parents_keep_theirs():
    rows = view(
        content(
            ROW | {"follow": True},
            ROW | {"id": "b"},
            ROW | {"id": "p", "follow": True, "key": None, "title": "Parent"},
            ROW | {"id": "c", "key": "DEMO-2", "parent": "p", "follow": True},
        ),
        [task(start=D("2026-11-02"), due=D("2026-11-20"))],
    )
    assert [(r.id, str(r.start), str(r.end), r.dates) for r in rows] == [
        ("a", "2026-11-02", "2026-11-20", "tracker"),
        ("b", "2026-10-05", "2026-10-09", "own"),
        ("p", "2026-10-05", "2026-10-09", "own"),
        # DEMO-2 has no task in the cache: it shows what the board stored.
        ("c", "2026-10-05", "2026-10-09", "stored"),
    ]


def test_a_row_cut_into_stages_keeps_its_bar():
    staged = ROW | {
        "follow": True,
        "stages": [{"id": "s", "type": "dev", "start": "2026-10-05", "end": "2026-10-09"}],
    }
    row = view(content(staged), [task(start=D("2026-11-02"), due=D("2026-11-20"))])[0]
    assert (str(row.start), row.dates) == ("2026-10-05", "own")


def test_a_guessed_side_is_named_and_not_compared():
    rows = view(
        content(ROW | {"follow": True}, ROW | {"id": "b", "key": "DEMO-2", "end": "2026-11-20"}),
        [task(due=D("2026-11-20")), task("DEMO-2", due=D("2026-11-20"))],
    )
    assert (rows[0].dates, rows[0].guessed, str(rows[0].start)) == (
        "tracker",
        "start",
        "2026-11-14",
    )
    # Own dates end on the due; the tracker has no start to compare.
    assert rows[1].tracker is None


def test_own_dates_that_disagree_carry_the_trackers():
    row = view(content(ROW), [task(start=D("2026-11-02"), due=D("2026-11-20"))])[0]
    assert dump(row)["tracker"] == {"start": "2026-11-02", "end": "2026-11-20"}
    assert dump(row)["dates"] == "own"


def test_a_parent_spans_its_branch_after_follow_and_drifts_on_it():
    rows = view(
        content(
            {"id": "p", "key": "DEMO-9", "start": "2026-10-01", "end": "2026-10-02"},
            ROW | {"id": "c", "parent": "p", "follow": True},
            ROW | {"id": "d", "key": None, "title": "Review", "parent": "p"},
        ),
        [
            task(start=D("2026-11-02"), due=D("2026-11-20")),
            task("DEMO-9", start=D("2026-10-01"), due=D("2026-11-20")),
        ],
    )
    parent = dump(rows[0])
    assert parent["span"] == {"start": "2026-10-01", "end": "2026-11-20"}
    # The span matches the parent's task, so no mark, though its own dates differ.
    assert "tracker" not in parent
    assert "span" not in dump(rows[1])


def test_task_rows_carry_key_and_task_plain_rows_their_title():
    rows = view(
        content(
            ROW | {"source": "jira", "key": "PROJ-1"},
            ROW | {"id": "b", "title": "stale"},
            ROW | {"id": "c", "key": None, "title": "Design review"},
        ),
        [task("PROJ-1", "jira"), task(state="no_token")],
    )
    jira, unread, plain = (dump(r) for r in rows)
    assert (jira["source"], jira["key"], jira["task"]["title"]) == (
        "jira",
        "PROJ-1",
        "Rotate the staging certificates",
    )
    assert "title" not in jira
    # A row saved before trackers could be mixed belongs to the instance's tracker.
    assert (unread["source"], unread["task"]) == ("demo", None)
    assert plain["title"] == "Design review"
    assert "task" not in plain and "key" not in plain


NAMES = Names(
    types={"t1": "Design"},
    people={"p1": "Mira Example"},
    fields={"f1": "Priority", "f2": "Size"},
)


def test_planning_names_stages_of_leaves_and_shown_values():
    rows = view(
        content(
            {
                "id": "r1",
                "title": "Payments",
                "start": "2026-11-02",
                "end": "2026-11-27",
                "values": {"f1": "High", "f2": "L"},
                "stages": [{"id": "old", "type": "t1", "start": "2026-11-02", "end": "2026-11-03"}],
            },
            ROW
            | {
                "id": "r2",
                "parent": "r1",
                "start": "2026-11-02",
                "end": "2026-11-27",
                "stages": [
                    {
                        "id": "s1",
                        "type": "t1",
                        "start": "2026-11-02",
                        "end": "2026-11-13",
                        "people": ["p1", "gone"],
                    },
                    {"id": "s2", "type": "t9", "start": "2026-11-16", "end": "2026-11-27"},
                ],
            },
            ROW | {"id": "r3", "parent": "r1", "values": {"f1": "Low"}},
            columns=["f1"],
        ),
        names=NAMES,
    )
    parent, staged, own = (dump(r) for r in rows)
    # A parent's stored stages are not drawn.
    assert "stages" not in parent
    assert parent["values"] == [
        {"field": {"id": "f1", "name": "Priority"}, "value": "High", "inherited": False}
    ]
    assert staged["stages"] == [
        {
            "id": "s1",
            "type": {"id": "t1", "name": "Design"},
            "start": "2026-11-02",
            "end": "2026-11-13",
            "people": [{"id": "p1", "name": "Mira Example"}, {"id": "gone", "name": None}],
        },
        {
            "id": "s2",
            "type": {"id": "t9", "name": None},
            "start": "2026-11-16",
            "end": "2026-11-27",
            "people": [],
        },
    ]
    assert staged["values"][0]["inherited"] is True
    assert own["values"][0] | {} == {
        "field": {"id": "f1", "name": "Priority"},
        "value": "Low",
        "inherited": False,
    }
    assert own["stages"] == []


def test_planning_off_shows_no_stages_or_values():
    staged = ROW | {
        "values": {"f1": "High"},
        "stages": [{"id": "s", "type": "t1", "start": "2026-10-05", "end": "2026-10-09"}],
    }
    row = dump(view(content(staged, columns=["f1"]))[0])
    assert "stages" not in row and "values" not in row


def test_milestones_and_links():
    gantt = gantt_view(
        content(
            ROW,
            ROW | {"id": "b"},
            milestones=[{"id": "m", "date": "2026-12-20", "title": "Release"}],
            links=[{"id": "l", "from": "a", "to": "b"}],
        ),
        {},
        "demo",
        None,
    ).model_dump(mode="json")
    assert gantt["milestones"] == [{"id": "m", "date": "2026-12-20", "title": "Release"}]
    assert gantt["links"] == [{"from": "a", "to": "b"}]


def tree(top: int, under: int) -> dict:
    rows = []
    for i in range(top):
        rows.append(
            {"id": f"t{i}", "title": f"Epic {i}", "start": "2026-10-01", "end": "2026-10-02"}
        )
        for j in range(under):
            day = f"2026-{10 + i % 3}-{j % 28 + 1:02d}"
            rows.append(
                {"id": f"t{i}-{j}", "parent": f"t{i}", "title": "x", "start": day, "end": day}
            )
    return content(*rows)


def test_narrowing_by_branch_and_window():
    rows = view(tree(3, 4))
    branch, note = narrow(rows, branch="t1")
    assert [r.id for r in branch] == ["t1", "t1-0", "t1-1", "t1-2", "t1-3"] and note is None
    window, _ = narrow(rows, start=D("2026-11-02"), end=D("2026-11-02"))
    # The child in the window comes with its ancestor; t2 spans October to December.
    assert [r.id for r in window] == ["t1", "t1-1", "t2"]
    with pytest.raises(NotFound):
        narrow(rows, branch="nope")


def test_too_many_rows_fold_to_the_top_level_also_after_narrowing():
    rows = view(tree(3, 50))
    folded, note = narrow(rows)
    assert [(r.id, r.holds) for r in folded] == [("t0", 50), ("t1", 50), ("t2", 50)]
    assert note and "branch" in note
    assert all(dump(r).get("holds") is None for r in rows)
    small, note = narrow(rows, cap=200)
    assert len(small) == 153 and note is None
    one, note = narrow(rows, branch="t0", cap=10)
    assert [(r.id, r.holds) for r in one] == [("t0", 50)] and note
