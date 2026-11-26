"""The JQL people know from Jira, turned into Linear's issue filter.

Linear has no query language of its own; this reads the subset in spec 053 (FR-015) with no
dependency and answers a mistake with where it is and what was expected.
"""

import re
from collections.abc import Callable
from dataclasses import dataclass

from app.domain.errors import InvalidJql
from app.domain.jql import JqlField, JqlVocabulary

_TOKEN = re.compile(
    r"""\s*(?:
      (?P<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
    | (?P<op>!=|>=|<=|=|~|>|<)
    | (?P<punct>[(),])
    | (?P<word>[^\s"'(),=!~<>]+)
    )""",
    re.VERBOSE,
)
_RELATIVE = re.compile(r"^([+-]?)(\d+)([yMwdhm])$")
_DAY = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$")
_NUMBER = re.compile(r"^\d+$")

Filter = dict


@dataclass(frozen=True)
class Token:
    kind: str  # string, op, punct, word, end
    text: str
    at: int  # 1-based position in the query

    @property
    def keyword(self) -> str:
        return self.text.upper() if self.kind == "word" else ""


@dataclass(frozen=True)
class Value:
    text: str
    at: int
    function: bool = False


def _tokens(query: str) -> list[Token]:
    found, pos = [], 0
    while pos < len(query):
        match = _TOKEN.match(query, pos)
        if not match or match.end() == pos:
            if query[pos:].strip() == "":
                break
            raise _error(pos + 1, f"cannot read {query[pos]!r}", "a field, a value or AND/OR")
        kind = match.lastgroup or "word"
        text = match.group(kind)
        start = match.start(kind) + 1
        if kind == "string":
            text = re.sub(r"\\(.)", r"\1", text[1:-1])
        found.append(Token(kind, text, start))
        pos = match.end()
    found.append(Token("end", "", len(query) + 1))
    return found


def _error(at: int, what: str, expected: str) -> InvalidJql:
    return InvalidJql(f"At position {at}, {what}: expected {expected}.")


# How a value is compared: positive ones join with OR, negated ones with AND.
_COMPARE = {
    "=": ("eqIgnoreCase", False),
    "!=": ("neqIgnoreCase", True),
    "~": ("containsIgnoreCase", False),
}


def _join(kind: str, parts: list[Filter]) -> Filter:
    return parts[0] if len(parts) == 1 else {kind: parts}


def _names(attrs: tuple[str, ...]) -> Callable[[str, list[Value]], Filter]:
    """A relation matched by any of its names, like a team by its key or its name."""

    def build(op: str, values: list[Value]) -> Filter:
        if op in ("in", "not in"):
            compare, negated = (
                ("neqIgnoreCase", True) if op == "not in" else ("eqIgnoreCase", False)
            )
        else:
            compare, negated = _COMPARE[op]
        parts = [{attr: {compare: v.text}} for v in values for attr in attrs]
        return _join("and" if negated else "or", parts)

    return build


def _scalar(op: str, values: list[Value], value: Callable[[Value], object] = lambda v: v.text):
    """A plain field: `=`, `!=`, `IN`, `NOT IN` and comparisons, compared exactly."""
    plain = {"=": "eq", "!=": "neq", ">": "gt", ">=": "gte", "<": "lt", "<=": "lte"}
    if op == "in":
        return {"in": [value(v) for v in values]}
    if op == "not in":
        return {"nin": [value(v) for v in values]}
    return {plain[op]: value(values[0])}


def _date(value: Value) -> str:
    if value.function:
        raise _error(value.at, f"{value.text}() is not a date", "a date like 2026-11-30 or -2w")
    if match := _DAY.match(value.text):
        year, month, day = (int(part) for part in match.groups())
        return f"{year:04d}-{month:02d}-{day:02d}"
    if match := _RELATIVE.match(value.text):
        sign, count, unit = match.groups()
        # Linear reads an ISO 8601 duration as a time relative to now.
        time = unit in "hm"
        return f"{'-' if sign == '-' else ''}P{'T' if time else ''}{count}{unit.upper()}"
    raise _error(value.at, f"{value.text!r} is not a date", "a date like 2026-11-30 or -2w")


_PRIORITY = {"no priority": 0, "none": 0, "urgent": 1, "high": 2, "medium": 3, "low": 4}
_CATEGORY = {
    "new": ["triage", "backlog", "unstarted"],
    "to do": ["triage", "backlog", "unstarted"],
    "indeterminate": ["started"],
    "in progress": ["started"],
    "done": ["completed", "canceled", "duplicate"],
}


def _priority(value: Value) -> int:
    text = value.text.lower()
    if text in _PRIORITY:
        return _PRIORITY[text]
    if _NUMBER.match(text) and int(text) <= 4:
        return int(text)
    raise _error(
        value.at, f"{value.text!r} is not a priority", "Urgent, High, Medium, Low or No priority"
    )


def _category(op: str, values: list[Value]) -> Filter:
    types: list[str] = []
    for value in values:
        if value.text.lower() not in _CATEGORY:
            raise _error(
                value.at,
                f"{value.text!r} is not a status category",
                '"To Do", "In Progress" or Done',
            )
        types += _CATEGORY[value.text.lower()]
    return {"state": {"type": {"nin" if op in ("!=", "not in") else "in": types}}}


def _person(relation: str) -> Callable[[str, list[Value]], Filter]:
    names = _names(("name", "displayName", "email"))

    def build(op: str, values: list[Value]) -> Filter:
        mine = [v for v in values if v.function]
        for v in mine:
            if v.text.lower() != "currentuser":
                raise _error(v.at, f"{v.text}() is not a person", "currentUser() or a name")
        others = [v for v in values if not v.function]
        negated = op in ("!=", "not in")
        parts = [{"isMe": {"eq": not negated}}] if mine else []
        if others:
            parts.append(names(op, others))
        return {relation: _join("and" if negated else "or", parts)}

    return build


def _cycle(op: str, values: list[Value]) -> Filter:
    functions = {"opensprints": "isActive", "nextsprint": "isNext"}
    negated = op in ("!=", "not in")
    parts = []
    for value in values:
        if value.function:
            if value.text.lower() not in functions:
                raise _error(
                    value.at,
                    f"{value.text}() is not a cycle",
                    "openSprints(), nextSprint(), a number or a name",
                )
            parts.append({functions[value.text.lower()]: {"eq": not negated}})
        elif _NUMBER.match(value.text):
            parts.append({"number": {"neq" if negated else "eq": int(value.text)}})
        else:
            parts.append({"name": {"neqIgnoreCase" if negated else "eqIgnoreCase": value.text}})
    return {"cycle": _join("and" if negated else "or", parts)}


def _labels(op: str, values: list[Value]) -> Filter:
    if op in ("!=", "not in"):
        # Like Linear's own "is not": an issue without labels matches too.
        return {
            "labels": {"every": _join("and", [{"name": {"neqIgnoreCase": v.text}} for v in values])}
        }
    compare = "containsIgnoreCase" if op == "~" else "eqIgnoreCase"
    return {"labels": {"some": _join("or", [{"name": {compare: v.text}} for v in values])}}


def _relation(name: str, build: Callable[[str, list[Value]], Filter]):
    return lambda op, values: {name: build(op, values)}


def _text(op: str, values: list[Value]) -> Filter:
    word = values[0].text
    return {
        "or": [
            {"title": {"containsIgnoreCase": word}},
            {"description": {"containsIgnoreCase": word}},
        ]
    }


def _title(op: str, values: list[Value]) -> Filter:
    return {"title": {_COMPARE[op][0]: values[0].text}}


def _key(attr: Callable[[Filter], Filter]):
    return lambda op, values: attr(_scalar(op, values, lambda v: v.text.upper()))


@dataclass(frozen=True)
class Field:
    label: str
    operators: tuple[str, ...]
    build: Callable[[str, list[Value]], Filter]
    # The filter for IS EMPTY and IS NOT EMPTY, when the field may be empty.
    empty: Callable[[bool], Filter] | None = None
    # Whether a function like currentUser() is one of its values.
    functions: bool = False


_LIST = ("=", "!=", "in", "not in")
_NAMED = (*_LIST, "~")
_DATES = (">", ">=", "<", "<=")


def _null(relation: str) -> Callable[[bool], Filter]:
    return lambda empty: {relation: {"null": empty}}


FIELDS: dict[str, Field] = {
    "team": Field("Team", _NAMED, _relation("team", _names(("key", "name")))),
    "project": Field("Project", _NAMED, _relation("project", _names(("name",))), _null("project")),
    "cycle": Field("Cycle", _LIST, _cycle, _null("cycle"), functions=True),
    "status": Field("Status", _NAMED, _relation("state", _names(("name",)))),
    "statuscategory": Field("Status category", _LIST, _category),
    "assignee": Field("Assignee", _NAMED, _person("assignee"), _null("assignee"), functions=True),
    "reporter": Field("Creator", _NAMED, _person("creator"), _null("creator"), functions=True),
    "labels": Field(
        "Labels",
        _NAMED,
        _labels,
        lambda empty: {"labels": {"length": {"eq": 0} if empty else {"gt": 0}}},
    ),
    "priority": Field("Priority", _LIST, lambda op, vs: {"priority": _scalar(op, vs, _priority)}),
    "created": Field("Created", _DATES, lambda op, vs: {"createdAt": _scalar(op, vs, _date)}),
    "updated": Field("Updated", _DATES, lambda op, vs: {"updatedAt": _scalar(op, vs, _date)}),
    "due": Field(
        "Due date", _DATES, lambda op, vs: {"dueDate": _scalar(op, vs, _date)}, _null("dueDate")
    ),
    "text": Field("Title or description", ("~",), _text),
    "title": Field("Title", ("=", "!=", "~"), _title),
    "key": Field("Key", _LIST, _key(lambda c: {"id": c})),
    "parent": Field("Parent", _LIST, _key(lambda c: {"parent": {"id": c}}), _null("parent")),
}
# Jira's other names for the same fields.
FIELDS["category"] = FIELDS["statuscategory"]
FIELDS["creator"] = FIELDS["reporter"]
FIELDS["label"] = FIELDS["labels"]
FIELDS["duedate"] = FIELDS["due"]
FIELDS["summary"] = FIELDS["title"]
FIELDS["issuekey"] = FIELDS["key"]
FIELDS["sprint"] = FIELDS["cycle"]
_SHOWN = (
    "team",
    "project",
    "cycle",
    "status",
    "statusCategory",
    "assignee",
    "reporter",
    "labels",
    "priority",
    "created",
    "updated",
    "due",
    "text",
    "title",
    "key",
    "parent",
)
FUNCTIONS = ["currentUser()", "openSprints()", "nextSprint()"]


def vocabulary() -> JqlVocabulary:
    """What the query box offers for Linear."""
    return JqlVocabulary(
        fields=[
            JqlField(
                name=name,
                label=FIELDS[name.lower()].label,
                operators=[
                    *(op.upper() for op in FIELDS[name.lower()].operators),
                    *(("IS", "IS NOT") if FIELDS[name.lower()].empty else ()),
                ],
            )
            for name in _SHOWN
        ],
        functions=FUNCTIONS,
        keywords=["AND", "OR", "EMPTY"],
    )


class _Parser:
    def __init__(self, query: str) -> None:
        self.tokens = _tokens(query)
        self.i = 0

    @property
    def peek(self) -> Token:
        return self.tokens[self.i]

    def take(self) -> Token:
        token = self.tokens[self.i]
        self.i += 1
        return token

    def expect(self, text: str, what: str) -> Token:
        token = self.take()
        if token.text != text or token.kind not in ("punct", "op"):
            raise _error(token.at, f"found {token.text or 'the end'}", what)
        return token

    def query(self) -> Filter:
        if self.peek.kind == "end":
            raise _error(1, "the query is empty", "a field like team or status")
        found = self.either()
        token = self.peek
        if token.keyword == "ORDER":
            raise _error(token.at, "ORDER BY is not read for Linear", "the end of the query")
        if token.kind != "end":
            raise _error(token.at, f"found {token.text}", "AND, OR or the end of the query")
        return found

    def either(self) -> Filter:
        parts = [self.both()]
        while self.peek.keyword == "OR":
            self.take()
            parts.append(self.both())
        return _join("or", parts)

    def both(self) -> Filter:
        parts = [self.single()]
        while self.peek.keyword == "AND":
            self.take()
            parts.append(self.single())
        return _join("and", parts)

    def single(self) -> Filter:
        token = self.peek
        if token.keyword == "NOT":
            raise _error(token.at, "NOT (…) is not read for Linear", "a field; use != or NOT IN")
        if token.text == "(" and token.kind == "punct":
            self.take()
            found = self.either()
            self.expect(")", "a closing parenthesis")
            return found
        return self.clause()

    def clause(self) -> Filter:
        token = self.take()
        if token.kind not in ("word", "string") or token.keyword in ("AND", "OR"):
            raise _error(
                token.at, f"found {token.text or 'the end'}", "a field like team or status"
            )
        field = FIELDS.get(token.text.lower())
        if field is None:
            known = ", ".join(_SHOWN)
            raise _error(token.at, f"{token.text} is not a Linear field", f"one of {known}")
        name = token.text
        op_token = self.peek
        op = self.operator()
        if op in ("is", "is not"):
            if field.empty is None:
                raise _error(op_token.at, f"{name} is never empty", "another operator")
            return field.empty(op == "is")
        if op not in field.operators:
            allowed = ", ".join(o.upper() for o in field.operators)
            raise _error(op_token.at, f"{op.upper()} does not work on {name}", allowed)
        values = self.values() if op in ("in", "not in") else [self.value()]
        if not field.functions and (call := next((v for v in values if v.function), None)):
            raise _error(call.at, f"{call.text}() is not a value of {name}", "a value")
        return field.build(op, values)

    def operator(self) -> str:
        token = self.take()
        if token.kind == "op":
            return token.text
        if token.keyword == "IN":
            return "in"
        if token.keyword == "NOT" and self.peek.keyword == "IN":
            self.take()
            return "not in"
        if token.keyword == "IS":
            negated = self.peek.keyword == "NOT"
            if negated:
                self.take()
            empty = self.take()
            if empty.keyword not in ("EMPTY", "NULL"):
                raise _error(empty.at, f"found {empty.text or 'the end'}", "EMPTY")
            return "is not" if negated else "is"
        raise _error(
            token.at, f"found {token.text or 'the end'}", "an operator like =, !=, IN or ~"
        )

    def values(self) -> list[Value]:
        # `IN openSprints()`: a function stands for the whole list.
        if self.peek.kind == "word" and self.tokens[self.i + 1].text == "(":
            return [self.value()]
        self.expect("(", "a list in parentheses")
        found = [self.value()]
        while self.peek.text == "," and self.peek.kind == "punct":
            self.take()
            found.append(self.value())
        self.expect(")", "a comma or a closing parenthesis")
        return found

    def value(self) -> Value:
        token = self.take()
        if token.kind == "string":
            return Value(token.text, token.at)
        if token.kind != "word" or token.keyword in ("AND", "OR"):
            raise _error(token.at, f"found {token.text or 'the end'}", "a value")
        if self.peek.text == "(" and self.peek.kind == "punct":
            self.take()
            self.expect(")", "() after a function")
            return Value(token.text, token.at, function=True)
        return Value(token.text, token.at)


def to_filter(query: str) -> Filter:
    """Linear's IssueFilter for a query; raises InvalidJql with where it went wrong."""
    return _Parser(query).query()
