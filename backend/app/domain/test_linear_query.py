import pytest

from app.domain.errors import InvalidJql
from app.domain.linear_query import to_filter, vocabulary

CASES = [
    # team, matched by its key or its name
    (
        "team = ENG",
        {"team": {"or": [{"key": {"eqIgnoreCase": "ENG"}}, {"name": {"eqIgnoreCase": "ENG"}}]}},
    ),
    (
        "team != ENG",
        {"team": {"and": [{"key": {"neqIgnoreCase": "ENG"}}, {"name": {"neqIgnoreCase": "ENG"}}]}},
    ),
    (
        'team ~ "plat"',
        {
            "team": {
                "or": [
                    {"key": {"containsIgnoreCase": "plat"}},
                    {"name": {"containsIgnoreCase": "plat"}},
                ]
            }
        },
    ),
    (
        "team in (ENG, OPS)",
        {
            "team": {
                "or": [
                    {"key": {"eqIgnoreCase": "ENG"}},
                    {"name": {"eqIgnoreCase": "ENG"}},
                    {"key": {"eqIgnoreCase": "OPS"}},
                    {"name": {"eqIgnoreCase": "OPS"}},
                ]
            }
        },
    ),
    (
        "team not in (ENG)",
        {"team": {"and": [{"key": {"neqIgnoreCase": "ENG"}}, {"name": {"neqIgnoreCase": "ENG"}}]}},
    ),
    ('project = "Billing v2"', {"project": {"name": {"eqIgnoreCase": "Billing v2"}}}),
    ("project is empty", {"project": {"null": True}}),
    ("project IS NOT EMPTY", {"project": {"null": False}}),
    ("cycle = 12", {"cycle": {"number": {"eq": 12}}}),
    ('cycle = "Cycle 12"', {"cycle": {"name": {"eqIgnoreCase": "Cycle 12"}}}),
    ("cycle in openSprints()", {"cycle": {"isActive": {"eq": True}}}),
    ("sprint in nextSprint()", {"cycle": {"isNext": {"eq": True}}}),
    ("cycle not in openSprints()", {"cycle": {"isActive": {"eq": False}}}),
    ("cycle is empty", {"cycle": {"null": True}}),
    ('status = "In Review"', {"state": {"name": {"eqIgnoreCase": "In Review"}}}),
    ('statusCategory = "In Progress"', {"state": {"type": {"in": ["started"]}}}),
    (
        "statusCategory != Done",
        {"state": {"type": {"nin": ["completed", "canceled", "duplicate"]}}},
    ),
    (
        'category in ("To Do", done)',
        {
            "state": {
                "type": {
                    "in": ["triage", "backlog", "unstarted", "completed", "canceled", "duplicate"]
                }
            }
        },
    ),
    ("assignee = currentUser()", {"assignee": {"isMe": {"eq": True}}}),
    ("assignee != currentUser()", {"assignee": {"isMe": {"eq": False}}}),
    (
        'assignee = "Ada Lovelace"',
        {
            "assignee": {
                "or": [
                    {"name": {"eqIgnoreCase": "Ada Lovelace"}},
                    {"displayName": {"eqIgnoreCase": "Ada Lovelace"}},
                    {"email": {"eqIgnoreCase": "Ada Lovelace"}},
                ]
            }
        },
    ),
    ("assignee is empty", {"assignee": {"null": True}}),
    ("reporter = currentUser()", {"creator": {"isMe": {"eq": True}}}),
    ("labels = bug", {"labels": {"some": {"name": {"eqIgnoreCase": "bug"}}}}),
    (
        "labels in (bug, ui)",
        {
            "labels": {
                "some": {
                    "or": [{"name": {"eqIgnoreCase": "bug"}}, {"name": {"eqIgnoreCase": "ui"}}]
                }
            }
        },
    ),
    ("labels != bug", {"labels": {"every": {"name": {"neqIgnoreCase": "bug"}}}}),
    (
        "labels not in (bug, ui)",
        {
            "labels": {
                "every": {
                    "and": [{"name": {"neqIgnoreCase": "bug"}}, {"name": {"neqIgnoreCase": "ui"}}]
                }
            }
        },
    ),
    ("labels ~ back", {"labels": {"some": {"name": {"containsIgnoreCase": "back"}}}}),
    ("labels is empty", {"labels": {"length": {"eq": 0}}}),
    ("labels is not empty", {"labels": {"length": {"gt": 0}}}),
    ("priority = High", {"priority": {"eq": 2}}),
    ("priority != Urgent", {"priority": {"neq": 1}}),
    ('priority in (Urgent, "No priority")', {"priority": {"in": [1, 0]}}),
    ("priority not in (Low)", {"priority": {"nin": [4]}}),
    ("created > -2w", {"createdAt": {"gt": "-P2W"}}),
    ("created >= 2026/11/1", {"createdAt": {"gte": "2026-11-01"}}),
    ("updated < -3d", {"updatedAt": {"lt": "-P3D"}}),
    ("updated <= -4h", {"updatedAt": {"lte": "-PT4H"}}),
    ("due < 1M", {"dueDate": {"lt": "P1M"}}),
    ("due >= 2026-12-01", {"dueDate": {"gte": "2026-12-01"}}),
    ("due is empty", {"dueDate": {"null": True}}),
    (
        'text ~ "billing"',
        {
            "or": [
                {"title": {"containsIgnoreCase": "billing"}},
                {"description": {"containsIgnoreCase": "billing"}},
            ]
        },
    ),
    ('title ~ "retry"', {"title": {"containsIgnoreCase": "retry"}}),
    ('summary = "Fix it"', {"title": {"eqIgnoreCase": "Fix it"}}),
    ('title != "Fix it"', {"title": {"neqIgnoreCase": "Fix it"}}),
    ("key = eng-12", {"id": {"eq": "ENG-12"}}),
    ("key != ENG-12", {"id": {"neq": "ENG-12"}}),
    ("key in (ENG-1, ENG-2)", {"id": {"in": ["ENG-1", "ENG-2"]}}),
    ("issuekey not in (ENG-1)", {"id": {"nin": ["ENG-1"]}}),
    ("parent = ENG-1", {"parent": {"id": {"eq": "ENG-1"}}}),
    ("parent is empty", {"parent": {"null": True}}),
]


@pytest.mark.parametrize(("query", "expected"), CASES)
def test_each_field_and_operator(query, expected):
    assert to_filter(query) == expected


def test_and_or_and_parentheses():
    found = to_filter(
        "team = ENG AND (labels = bug OR priority = Urgent) and cycle in openSprints()"
    )
    team, either, cycle = found["and"]
    assert team == to_filter("team = ENG")
    assert either == {"or": [to_filter("labels = bug"), to_filter("priority = Urgent")]}
    assert cycle == to_filter("cycle in openSprints()")


def test_or_binds_looser_than_and():
    found = to_filter("labels = a OR labels = b AND labels = c")
    assert found == {
        "or": [to_filter("labels = a"), {"and": [to_filter("labels = b"), to_filter("labels = c")]}]
    }


def test_the_spec_examples():
    assert to_filter(
        "team = ENG AND labels = bug AND cycle in openSprints() AND assignee = currentUser()"
    )["and"][3] == {"assignee": {"isMe": {"eq": True}}}
    assert to_filter('text ~ "billing" AND updated > -2w')["and"][1] == {
        "updatedAt": {"gt": "-P2W"}
    }


@pytest.mark.parametrize(
    ("query", "where", "expected"),
    [
        ("", "position 1", "a field"),
        ("teem = ENG", "position 1", "one of team"),
        ("team ENG", "position 6", "an operator"),
        ("team =", "position 7", "a value"),
        ("team = ENG AND", "position 15", "a field"),
        ("team = ENG labels = bug", "position 12", "AND, OR or the end"),
        ("(team = ENG", "position 12", "a closing parenthesis"),
        ("team in (ENG", "position 13", "a comma or a closing parenthesis"),
        ("team > ENG", "position 6", "=, !=, IN, NOT IN, ~"),
        ("team is empty", "position 6", "another operator"),
        ("NOT team = ENG", "position 1", "use != or NOT IN"),
        ("team = ENG ORDER BY created", "position 12", "the end of the query"),
        ("priority = Huge", "position 12", "Urgent, High"),
        ("statusCategory = Waiting", "position 18", '"To Do"'),
        ("created > yesterday", "position 11", "a date"),
        ("cycle = lastSprint()", "position 9", "openSprints()"),
        ("assignee = me()", "position 12", "currentUser()"),
        ("team = currentUser()", "position 8", "a value"),
        ("text = billing", "position 6", "~"),
        ("project is full", "position 12", "EMPTY"),
        ("created > 2026-02-30", "position 11", "a date"),
        ("updated > -99999y", "position 11", "in days"),
        ("due > -2h", "position 7", "in days"),
        ('key = "foo bar"', "position 7", "a key like ENG-12"),
        ("parent = ENG12", "position 10", "a key like ENG-12"),
        ("assignee = EMPTY", "position 12", "IS EMPTY"),
        ("labels in (EMPTY)", "position 12", "IS EMPTY"),
        ("(" * 31 + "team = x" + ")" * 31, "position 31", "a simpler query"),
    ],
)
def test_a_mistake_says_where_and_what_was_expected(query, where, expected):
    with pytest.raises(InvalidJql) as raised:
        to_filter(query)
    assert where in raised.value.message
    assert expected in raised.value.message


def test_quotes_and_escapes():
    assert to_filter(r'title ~ "say \"hi\""') == {"title": {"containsIgnoreCase": 'say "hi"'}}
    assert to_filter("project = 'Q4 plan'") == {"project": {"name": {"eqIgnoreCase": "Q4 plan"}}}


def test_vocabulary_lists_every_field_with_its_operators():
    found = {f.name: f.operators for f in vocabulary().fields}
    assert len(found) == 16
    assert found["assignee"][-2:] == ["IS", "IS NOT"]
    assert "IS" not in found["team"]
    assert vocabulary().functions == ["currentUser()", "openSprints()", "nextSprint()"]
