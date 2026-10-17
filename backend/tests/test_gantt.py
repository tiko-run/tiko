import pytest
from pydantic import ValidationError

from app.domain.modules.gantt import GanttContent

BASE = {"start": "2026-10-01", "end": "2026-12-31"}


def row(row_id, **extra):
    return {"id": row_id, "start": "2026-10-05", "end": "2026-10-09"} | extra


def gantt(**extra):
    return GanttContent.model_validate(BASE | extra)


def test_defaults():
    content = gantt()
    assert content.scale == "week" and content.labelWidth == 160
    assert content.rows == [] and content.milestones == [] and content.links == []


def test_links_serialize_with_from():
    content = gantt(rows=[row("a"), row("b")], links=[{"id": "l", "from": "a", "to": "b"}])
    assert content.model_dump(mode="json")["links"] == [{"id": "l", "from": "a", "to": "b"}]


@pytest.mark.parametrize(
    ("extra", "reason"),
    [
        ({"end": "2026-09-30"}, "end before start"),
        ({"end": "2029-10-03"}, "range over 3 years"),
        ({"scale": "year"}, "Input should be"),
        ({"labelWidth": 50}, "greater than or equal to 120"),
        ({"rows": [row("a", end="2026-10-01")]}, "row a ends before it starts"),
        ({"rows": [row("a", key="nope")]}, "invalid issue key"),
        ({"rows": [row("a"), row("a")]}, "duplicate row id a"),
        ({"milestones": [{"id": "m", "date": "2026-11-01"}] * 2}, "duplicate milestone id m"),
        ({"rows": [row("a")], "links": [{"id": "l", "from": "a", "to": "b"}]}, "missing row"),
        ({"rows": [row("a")], "links": [{"id": "l", "from": "a", "to": "a"}]}, "to itself"),
        (
            {
                "rows": [row("a"), row("b")],
                "links": [{"id": "l", "from": "a", "to": "b"}, {"id": "k", "from": "a", "to": "b"}],
            },
            "duplicates another link",
        ),
        ({"rows": [row(str(i)) for i in range(201)]}, "at most 200"),
    ],
)
def test_rules(extra, reason):
    with pytest.raises(ValidationError, match=reason):
        gantt(**extra)


def test_rows_form_a_tree_in_display_order():
    rows = [row("a"), row("b", parent="a"), row("c", parent="b"), row("d", parent="a"), row("e")]
    content = gantt(rows=rows)
    assert [r.parent for r in content.rows] == [None, "a", "b", "a", None]


@pytest.mark.parametrize(
    ("rows", "reason"),
    [
        ([row("b", parent="a"), row("a")], "row b must follow its parent a"),
        ([row("a"), row("b"), row("c", parent="a")], "row c must follow its parent a"),
        ([row("a", parent="a")], "row a must follow its parent a"),
        (
            [row("0")] + [row(str(i), parent=str(i - 1)) for i in range(1, 6)],
            "nested deeper than 5",
        ),
    ],
)
def test_tree_rules(rows, reason):
    with pytest.raises(ValidationError, match=reason):
        gantt(rows=rows)


def test_rows_may_lie_outside_the_range():
    content = gantt(rows=[row("a", start="2025-01-01", end="2027-01-01", key="DEV-1")])
    assert content.rows[0].key == "DEV-1"


def stage(stage_id, start, end, **extra):
    return {"id": stage_id, "type": "t1", "start": start, "end": end} | extra


def test_a_row_spans_its_stages():
    stages = [stage("s1", "2026-10-05", "2026-10-09"), stage("s2", "2026-10-12", "2026-10-16")]
    content = gantt(rows=[row("a", end="2026-10-16", stages=stages)])
    assert [s.id for s in content.rows[0].stages] == ["s1", "s2"]


def test_content_without_stages_is_unchanged():
    content = gantt(rows=[row("a")])
    assert content.rows[0].stages is None
    assert "stages" not in content.model_dump(exclude_none=True)["rows"][0]
    assert "people" not in content.model_dump(exclude_none=True)


def test_people_show_inline_or_below():
    assert gantt(people="below").people == "below"
    with pytest.raises(ValidationError):
        gantt(people="aside")


@pytest.mark.parametrize(
    ("stages", "reason"),
    [
        ([stage("s1", "2026-10-05", "2026-10-07")], "must span its stages"),
        (
            [stage("s1", "2026-10-05", "2026-10-07"), stage("s2", "2026-10-07", "2026-10-09")],
            "overlap or are out of order",
        ),
        (
            [stage("s2", "2026-10-08", "2026-10-09"), stage("s1", "2026-10-05", "2026-10-07")],
            "overlap or are out of order",
        ),
        ([stage("s1", "2026-10-09", "2026-10-05")], "ends before it starts"),
        ([stage("s1", "2026-10-05", "2026-10-09", people=["p", "p"])], "a person twice"),
        ([stage(str(i), "2026-10-05", "2026-10-05") for i in range(21)], "at most 20"),
    ],
)
def test_stage_rules(stages, reason):
    with pytest.raises(ValidationError, match=reason):
        gantt(rows=[row("a", stages=stages)])


def test_stage_ids_are_unique_in_the_chart():
    one = [stage("s", "2026-10-05", "2026-10-09")]
    with pytest.raises(ValidationError, match="duplicate stage id s"):
        gantt(rows=[row("a", stages=one), row("b", stages=one)])


def test_a_parent_keeps_hidden_stages_outside_its_dates():
    stages = [stage("s1", "2026-10-05", "2026-10-07")]
    content = gantt(rows=[row("a", stages=stages), row("b", parent="a")])
    assert content.rows[0].stages[0].id == "s1"


def test_values_columns_and_filters_are_optional():
    content = gantt(rows=[row("a")])
    dumped = content.model_dump(exclude_none=True)
    assert "values" not in dumped["rows"][0] and "columns" not in dumped
    assert "filters" not in dumped


def test_the_chart_keeps_its_filters():
    filters = {"f7": ["Q4"], "team": ["Web"], "person": ["p5"]}
    assert gantt(filters=filters).filters == filters


def test_rows_keep_values_and_the_chart_its_columns():
    content = gantt(
        rows=[row("a", values={"priority": "1", "f7": "Q4, Q1"})], columns=["priority", "f7"]
    )
    assert content.rows[0].values == {"priority": "1", "f7": "Q4, Q1"}
    assert content.columns == ["priority", "f7"]


@pytest.mark.parametrize(
    ("extra", "reason"),
    [
        ({"rows": [row("a", values={"f7": ""})]}, "at least 1 character"),
        ({"rows": [row("a", values={"f7": "x" * 101})]}, "at most 100 characters"),
        ({"rows": [row("a", values={str(i): "x" for i in range(21)})]}, "at most 20"),
        ({"columns": [str(i) for i in range(7)]}, "at most 6"),
        ({"columns": ["priority", "priority"]}, "duplicate column id priority"),
        ({"filters": {"team": []}}, "at least 1 item"),
        ({"filters": {"team": [""]}}, "at least 1 character"),
        ({"filters": {"team": [str(i) for i in range(21)]}}, "at most 20"),
        ({"filters": {str(i): ["x"] for i in range(21)}}, "at most 20"),
    ],
)
def test_value_and_column_rules(extra, reason):
    with pytest.raises(ValidationError, match=reason):
        gantt(**extra)
