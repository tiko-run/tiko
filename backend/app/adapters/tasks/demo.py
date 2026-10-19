import re

from app.domain.errors import InvalidJql, TaskNotFound
from app.domain.jql import JqlField, JqlValue, JqlVocabulary
from app.domain.ports import DemoStatusRepo
from app.domain.tasks import SearchResult, StatusCategory, Task, now_iso

DEMO_HOST = "jira.example.com"
_QUOTED = re.compile(r'"([^"]*)"')
_EQUALITY = ["=", "!=", "in", "not in", "is", "is not", "was", "was in", "changed"]
_TEXT = ["~", "!~", "is", "is not"]
# Demo fields and where their values come from in the seed.
_FIELDS = {
    "project": (_EQUALITY, None),
    "key": (["=", "!=", "in", "not in", "<", ">"], None),
    "status": (_EQUALITY, "status_name"),
    "assignee": (_EQUALITY, "assignee_name"),
    "priority": (_EQUALITY, "priority_name"),
    "issuetype": (_EQUALITY, "type_name"),
    "summary": (_TEXT, None),
    "text": (["~"], None),
}

_CATEGORY: dict[str, StatusCategory] = {
    "To Do": "new",
    "Backlog": "new",
    "In Progress": "indeterminate",
    "In Review": "indeterminate",
    "Done": "done",
    "Closed": "done",
}

# Made-up tasks so the whole scenario runs without a Jira instance.
_SEED = [
    (
        "DEMO-1",
        "Story",
        "Show live task status on the team board",
        "In Progress",
        "Alex Rivera",
        "High",
    ),
    (
        "DEMO-2",
        "Bug",
        "Login page times out behind the corporate proxy",
        "To Do",
        "Sam Lee",
        "Highest",
    ),
    ("DEMO-3", "Task", "Rotate service account credentials", "Done", "Jordan Kim", "Medium"),
    ("DEMO-4", "Epic", "Q4 reliability goals", "In Progress", None, "High"),
    ("DEMO-5", "Story", "Export board as PNG for the weekly review", "Backlog", None, "Low"),
    ("DEMO-6", "Task", "Write the on-call handbook draft", "In Review", "Taylor Morgan", "Medium"),
    ("DEMO-7", "Bug", "Duplicate alerts after deploy", "In Progress", "Alex Rivera", "High"),
    ("DEMO-8", "Sub-task", "Add retry to the nightly export job", "To Do", "Sam Lee", "Medium"),
    ("DEMO-9", "Story", "Quarterly capacity planning", "To Do", "Jordan Kim", "Medium"),
    ("DEMO-10", "Task", "Clean up stale feature flags", "Closed", "Taylor Morgan", "Low"),
    ("DEMO-11", "Bug", "Dashboard shows wrong time zone", "In Review", None, "Medium"),
    ("DEMO-12", "Epic", "Migrate CI runners", "Backlog", "Alex Rivera", "High"),
]


class DemoTaskProvider:
    base_host = DEMO_HOST
    source_id = "demo"
    source_name = "Demo tasks"
    source_note = None

    def __init__(self, statuses: DemoStatusRepo | None = None, owner: str = "") -> None:
        self._seed = {
            key: {
                "type_name": type_name,
                "summary": summary,
                "status_name": status,
                "assignee_name": assignee,
                "priority_name": priority,
                "updated": "2026-10-01T09:00:00+00:00",
            }
            for key, type_name, summary, status, assignee, priority in _SEED
        }
        # With a store each person has their own statuses; without one the instance shares them.
        self._statuses = statuses
        self._owner = owner

    def scoped(self, owner: str) -> "DemoTaskProvider":
        """The demo tasks as this person sees them."""
        return DemoTaskProvider(self._statuses, owner) if self._statuses else self

    @property
    def _tasks(self) -> dict[str, dict]:
        if self._statuses is None:
            return self._seed
        changed = self._statuses.get(self._owner)
        return {
            key: {**fields, "status_name": changed[key][0], "updated": changed[key][1]}
            if key in changed
            else fields
            for key, fields in self._seed.items()
        }

    def _task(self, key: str, tasks: dict[str, dict] | None = None) -> Task:
        fields = (tasks or self._tasks)[key]
        return Task(
            source=self.source_id,
            key=key,
            status_category=_CATEGORY.get(fields["status_name"], "new"),
            url=f"https://{DEMO_HOST}/browse/{key}",
            fetched_at=now_iso(),
            **fields,
        )

    def resolve(self, key: str) -> Task:
        if key not in self._seed:
            raise TaskNotFound(f"{key} not found")
        return self._task(key)

    def poll(self, keys: list[str]) -> list[Task]:
        tasks = self._tasks
        return [
            self._task(key, tasks)
            if key in tasks
            else Task(
                source=self.source_id,
                key=key,
                state="not_found",
                url=f"https://{DEMO_HOST}/browse/{key}",
                fetched_at=now_iso(),
            )
            for key in keys
        ]

    def set_status(self, key: str, status: str) -> Task:
        """Lets smoke tests and demos change a status the way Jira would."""
        if key not in self._seed:
            raise TaskNotFound(f"{key} not found")
        if self._statuses is None:
            self._seed[key]["status_name"] = status
            self._seed[key]["updated"] = now_iso()
        else:
            self._statuses.set(self._owner, key, status, now_iso())
        return self._task(key)

    def search(self, jql: str, limit: int) -> SearchResult:
        """Not real JQL: quoted values must each appear in a task's text; no quotes match all."""
        if jql.count('"') % 2:
            raise InvalidJql("The query has an unclosed quote.")
        needles = [value.lower() for value in _QUOTED.findall(jql)]
        tasks = self._tasks
        keys = [
            key
            for key, fields in tasks.items()
            if all(needle in self._text(key, fields) for needle in needles)
        ]
        return SearchResult([self._task(key, tasks) for key in keys[:limit]], len(keys))

    def jql_vocabulary(self) -> JqlVocabulary:
        return JqlVocabulary(
            fields=[
                JqlField(name=name, label=name, operators=operators)
                for name, (operators, _) in _FIELDS.items()
            ],
            functions=["currentUser()", "now()", "startOfWeek()"],
        )

    def jql_values(self, field: str, prefix: str) -> list[JqlValue]:
        source = _FIELDS.get(field.lower(), ([], None))[1]
        if field.lower() == "project":
            values = {"DEMO"}
        elif source:
            values = {fields[source] for fields in self._tasks.values() if fields[source]}
        else:
            return []
        matches = sorted(v for v in values if v.lower().startswith(prefix.lower().strip('"')))
        return [JqlValue(value=f'"{v}"' if " " in v else v, label=v) for v in matches]

    @staticmethod
    def _text(key: str, fields: dict) -> str:
        values = [key, fields["summary"], fields["status_name"], fields["type_name"]]
        return " ".join([*values, fields["assignee_name"] or ""]).lower()

    def check(self) -> str:
        return "Demo User"
