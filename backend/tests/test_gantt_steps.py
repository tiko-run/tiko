"""Steps on a Gantt plan (spec 056): the engine alone, on content as the web app saves it."""

import json
from datetime import date
from pathlib import Path

import pytest

from app.domain.errors import ValidationFailed
from app.domain.gantt_steps import Context, Resolved, Step, apply

TODAY = date(2026, 10, 12)


def row(row_id: str, parent: str | None = None, **more) -> dict:
    out = {"id": row_id, "title": f"Row {row_id}", "start": "2026-10-05", "end": "2026-10-09"}
    if parent:
        out["parent"] = parent
    return out | more


def plan(*rows: dict, **more) -> dict:
    return (
        {"start": "2026-10-01", "end": "2026-12-31", "scale": "week", "rows": list(rows)}
        | {
            "milestones": [],
            "links": [],
        }
        | more
    )


# Goals with two children, one under the second, and a lone row.
PLAN = plan(row("g"), row("a", "g"), row("b", "g"), row("b1", "b"), row("x"))


def run(content: dict, *steps: dict, **context):
    return apply(content, [Step(**s) for s in steps], Context(today=TODAY, **context))


def ids(result) -> list[tuple[str, str | None]]:
    return [(r["id"], r.get("parent")) for r in result.content["rows"]]


def fails(content: dict, *steps: dict, **context) -> str:
    with pytest.raises(ValidationFailed) as failed:
        run(content, *steps, **context)
    return failed.value.message


def test_a_step_takes_only_its_own_fields():
    with pytest.raises(ValueError, match="remove_row takes no title"):
        Step(op="remove_row", id="a", title="x")
    with pytest.raises(ValueError, match="move_row needs id"):
        Step(op="move_row")
    with pytest.raises(ValueError, match="a title or a task"):
        Step(op="add_row", id="n")


def test_add_row_lands_last_first_or_after_a_sibling():
    last = run(PLAN, {"op": "add_row", "id": "n", "title": "New", "parent": "g"})
    assert ids(last)[:5] == [("g", None), ("a", "g"), ("b", "g"), ("b1", "b"), ("n", "g")]
    first = run(PLAN, {"op": "add_row", "id": "n", "title": "New", "parent": "g", "after": None})
    assert ids(first)[:2] == [("g", None), ("n", "g")]
    after = run(PLAN, {"op": "add_row", "id": "n", "title": "New", "parent": "g", "after": "a"})
    assert [i for i, _ in ids(after)] == ["g", "a", "n", "b", "b1", "x"]
    top = run(PLAN, {"op": "add_row", "id": "n", "title": "New"})
    assert ids(top)[-1] == ("n", None)
    assert top.created == {0: "n"} and top.touched == ["n"]
    # A week from today, inside the plan's range.
    assert (top.content["rows"][-1]["start"], top.content["rows"][-1]["end"]) == (
        "2026-10-12",
        "2026-10-18",
    )


def test_a_later_step_names_a_row_an_earlier_one_made():
    result = run(
        PLAN,
        {"op": "add_row", "id": "p", "title": "Payments"},
        {"op": "add_row", "id": "c", "title": "Checkout", "parent": "p"},
    )
    assert ids(result)[-2:] == [("p", None), ("c", "p")]


def test_a_collapsed_parent_opens_for_a_new_child():
    content = plan(row("g", collapsed=True), row("a", "g"))
    result = run(content, {"op": "add_row", "id": "n", "title": "New", "parent": "g"})
    assert result.content["rows"][0]["collapsed"] is False


def test_a_task_row_follows_its_tracker_and_is_planned_once():
    task = Resolved(key="DEMO-14", source="demo", span=(date(2026, 11, 2), date(2026, 11, 20)))
    result = run(PLAN, {"op": "add_row", "id": "t", "task": "DEMO-14"}, tasks={0: task})
    added = result.content["rows"][-1]
    assert added["key"] == "DEMO-14" and added["follow"] is True
    assert (added["start"], added["end"]) == ("2026-11-02", "2026-11-20")
    again = fails(result.content, {"op": "add_row", "id": "t2", "task": "DEMO-14"}, tasks={0: task})
    assert again == "step 0 (add_row): DEMO-14 is already in this plan as row t"
    dated = {"op": "add_row", "id": "t3", "task": "DEMO-15", "start": "2026-11-01"}
    assert "set follow: false first" in fails(
        PLAN, dated, tasks={0: Resolved(key="DEMO-15", source="demo")}
    )


def test_dates_follow_the_rules_of_the_web_app():
    stages = [{"id": "s1", "type": "t", "start": "2026-10-05", "end": "2026-10-09", "people": []}]
    content = plan(
        row("g"), row("a", "g"), row("s", stages=stages), row("f", key="DEMO-1", follow=True)
    )
    leaf = run(content, {"op": "update_row", "id": "a", "start": "2026-10-01", "end": "2026-10-20"})
    assert leaf.content["rows"][1]["start"] == "2026-10-01"
    # A parent is clamped to its children: it never cuts them off.
    parent = run(
        content, {"op": "update_row", "id": "g", "start": "2026-10-07", "end": "2026-10-08"}
    )
    assert (parent.content["rows"][0]["start"], parent.content["rows"][0]["end"]) == (
        "2026-10-05",
        "2026-10-09",
    )
    assert "use shift" in fails(content, {"op": "update_row", "id": "s", "end": "2026-10-30"})
    assert "follow: false" in fails(content, {"op": "update_row", "id": "f", "end": "2026-10-30"})
    free = run(
        content,
        {"op": "update_row", "id": "f", "follow": False},
        {"op": "update_row", "id": "f", "end": "2026-10-30"},
    )
    assert (
        "follow" not in free.content["rows"][3] and free.content["rows"][3]["end"] == "2026-10-30"
    )


def test_shift_moves_the_branch_and_its_stages_and_leaves_following_rows():
    stages = [{"id": "s1", "type": "t", "start": "2026-10-05", "end": "2026-10-09", "people": []}]
    content = plan(
        row("g"), row("a", "g", stages=stages), row("f", "g", key="DEMO-1", follow=True), row("x")
    )
    result = run(content, {"op": "update_row", "id": "g", "shift": 14})
    rows = {r["id"]: r for r in result.content["rows"]}
    assert rows["g"]["start"] == "2026-10-19"
    assert rows["a"]["stages"][0]["start"] == "2026-10-19" and rows["a"]["start"] == "2026-10-19"
    assert rows["f"]["start"] == "2026-10-05" and rows["x"]["start"] == "2026-10-05"
    assert result.kept == ["f"] and result.touched == ["g", "a"]


def test_move_row_takes_its_branch_and_never_into_itself():
    result = run(PLAN, {"op": "move_row", "id": "b", "parent": None})
    assert [i for i, _ in ids(result)] == ["g", "a", "x", "b", "b1"]
    assert ids(result)[3:] == [("b", None), ("b1", "b")]
    under = run(PLAN, {"op": "move_row", "id": "x", "parent": "a"})
    assert ids(under)[2] == ("x", "a")
    assert "own branch" in fails(PLAN, {"op": "move_row", "id": "g", "parent": "b1"})


def test_remove_row_lifts_its_children_or_takes_its_branch():
    content = PLAN | {"links": [{"id": "l1", "from": "b1", "to": "x"}]}
    lifted = run(content, {"op": "remove_row", "id": "b"})
    assert ("b1", "g") in ids(lifted) and lifted.content["links"] == content["links"]
    branch = run(content, {"op": "remove_row", "id": "b", "branch": True})
    assert [i for i, _ in ids(branch)] == ["g", "a", "x"] and branch.content["links"] == []


def test_values_only_on_columns_and_with_planning_on():
    content = PLAN | {"columns": ["team"]}
    step = {"op": "update_row", "id": "a", "values": {"team": "Core"}}
    assert run(content, step, fields={"team", "size"}).content["rows"][1]["values"] == {
        "team": "Core"
    }
    assert "Planning is off" in fails(content, step)
    other = {"op": "update_row", "id": "a", "values": {"size": "L"}}
    assert "not a column" in fails(content, other, fields={"team", "size"})
    cleared = run(
        content | {"rows": [row("a", values={"team": "Core"})]},
        {"op": "update_row", "id": "a", "values": {"team": None}},
        fields={"team"},
    )
    assert "values" not in cleared.content["rows"][0]


def test_done_on_plain_leaves_only():
    assert run(PLAN, {"op": "update_row", "id": "a", "done": True}).content["rows"][1]["done"]
    assert "progress" in fails(PLAN, {"op": "update_row", "id": "g", "done": True})


def test_a_failing_step_names_itself_and_changes_nothing():
    deep = plan(row("r0"), *(row(f"r{i}", f"r{i - 1}") for i in range(1, 5)))
    message = fails(
        deep,
        {"op": "add_row", "id": "ok", "title": "Fine"},
        {"op": "add_row", "id": "r5", "title": "Too deep", "parent": "r4"},
    )
    assert message.startswith("step 1 (add_row): ") and "deeper than 5" in message
    assert len(deep["rows"]) == 5
    full = plan(*(row(f"r{i}") for i in range(200)))
    assert "at most 200 rows" in fails(full, {"op": "add_row", "id": "n", "title": "One more"})
    assert "row nope not found" in fails(PLAN, {"op": "remove_row", "id": "nope"})


def test_set_range_is_checked_as_the_module_checks_it():
    result = run(PLAN, {"op": "set_range", "scale": "month", "end": "2027-03-31"})
    assert (result.content["scale"], result.content["end"]) == ("month", "2027-03-31")
    assert "end before start" in fails(PLAN, {"op": "set_range", "end": "2026-09-01"})


CASES = json.loads(
    (Path(__file__).parents[2] / "frontend/src/modules/gantt/cleanup.fixtures.json").read_text()
)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_the_clean_up_matches_the_web_app(case):
    from app.domain.gantt_steps import _Plan

    work = _Plan(case["before"], Context(today=TODAY))
    work.clean()
    assert work.content == case["after"]


PLANNED = {"fields": set(), "types": {"design", "build"}, "people": {"mira", "ann"}}


def test_stages_are_added_kept_in_order_and_the_leaf_spans_them():
    result = run(
        PLAN,
        {
            "op": "add_stage",
            "id": "s2",
            "row": "a",
            "type": "build",
            "start": "2026-10-19",
            "end": "2026-10-30",
            "people": ["ann"],
        },
        {
            "op": "add_stage",
            "id": "s1",
            "row": "a",
            "type": "design",
            "start": "2026-10-12",
            "end": "2026-10-16",
            "people": ["mira"],
        },
        **PLANNED,
    )
    row = result.content["rows"][1]
    assert [s["id"] for s in row["stages"]] == ["s1", "s2"]
    assert (row["start"], row["end"]) == ("2026-10-12", "2026-10-30")
    assert result.created == {0: "s2", 1: "s1"}


def test_a_stage_is_ticked_and_a_plain_leaf_is_done_with_all_its_stages():
    content = run(
        PLAN,
        {
            "op": "add_stage",
            "id": "s1",
            "row": "a",
            "type": "design",
            "start": "2026-10-12",
            "end": "2026-10-16",
        },
        **PLANNED,
    ).content
    ticked = run(content, {"op": "update_stage", "id": "s1", "done": True}, **PLANNED)
    row = ticked.content["rows"][1]
    assert row["stages"][0]["done"] is True and row["done"] is True
    gone = run(ticked.content, {"op": "remove_stage", "id": "s1"}, **PLANNED)
    assert "stages" not in gone.content["rows"][1]


def test_stage_rules():
    step = {
        "op": "add_stage",
        "row": "a",
        "type": "design",
        "start": "2026-10-12",
        "end": "2026-10-16",
        "id": "s1",
    }
    assert "Planning is off" in fails(PLAN, step)
    assert "hidden" in fails(PLAN, step | {"row": "g"}, **PLANNED)
    assert "stage type qa not found" in fails(PLAN, step | {"type": "qa"}, **PLANNED)
    assert "person zed not found" in fails(PLAN, step | {"people": ["zed"]}, **PLANNED)
    overlap = run(PLAN, step, **PLANNED).content
    clash = step | {"id": "s2", "start": "2026-10-14", "end": "2026-10-20"}
    assert "overlap" in fails(overlap, clash, **PLANNED)


def test_milestones_and_links():
    result = run(
        PLAN,
        {"op": "add_milestone", "id": "m1", "date": "2026-11-30", "title": "Beta"},
        {"op": "update_milestone", "id": "m1", "title": "Public beta"},
        {"op": "link", "id": "l1", "from": "a", "to": "x"},
    )
    assert result.content["milestones"] == [
        {"id": "m1", "date": "2026-11-30", "title": "Public beta"}
    ]
    assert result.content["links"] == [{"id": "l1", "from": "a", "to": "x"}]
    assert "already waits" in fails(
        result.content, {"op": "link", "id": "l2", "from": "a", "to": "x"}
    )
    unlinked = run(
        result.content,
        {"op": "unlink", "from": "a", "to": "x"},
        {"op": "remove_milestone", "id": "m1"},
    )
    assert unlinked.content["links"] == [] and unlinked.content["milestones"] == []
    assert "does not wait" in fails(PLAN, {"op": "unlink", "from": "a", "to": "x"})
    assert "row nope not found" in fails(
        PLAN, {"op": "link", "id": "l3", "from": "a", "to": "nope"}
    )


def test_a_required_field_given_as_null_is_missing():
    with pytest.raises(ValueError, match="remove_row needs id"):
        Step(op="remove_row", id=None)
    # Optional ones still take null: first under the top level.
    assert Step(op="move_row", id="a", parent=None, after=None).after is None


def test_stage_removal_and_archived_ids_keep_the_rules():
    stages = [
        {"id": "s1", "type": "old", "start": "2026-10-05", "end": "2026-10-06", "people": ["gone"]},
        {"id": "s2", "type": "design", "start": "2026-10-07", "end": "2026-10-09", "people": []},
    ]
    content = plan(row("g"), row("a", "g", stages=stages, start="2026-10-05"))
    # s1 keeps its archived type and person; s2 may not take them up.
    kept = run(content, {"op": "update_stage", "id": "s1", "done": True}, **PLANNED)
    assert kept.content["rows"][1]["stages"][0]["type"] == "old"
    assert "stage type old not found" in fails(
        content, {"op": "update_stage", "id": "s2", "type": "old"}, **PLANNED
    )
    assert "person gone not found" in fails(
        content, {"op": "update_stage", "id": "s2", "people": ["gone"]}, **PLANNED
    )
    assert "Planning is off" in fails(content, {"op": "remove_stage", "id": "s1"})
    parent = plan(row("p", stages=stages[:1]), row("c", "p"))
    assert "hidden" in fails(parent, {"op": "remove_stage", "id": "s1"}, **PLANNED)
