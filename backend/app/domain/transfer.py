"""A board as a `.tiko` file: an open zip that carries it from one tiko instance to another."""

import io
import json
import re
import zipfile
from collections import Counter
from collections.abc import Callable, Iterable
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from app.domain.accounts import Person
from app.domain.boards import (
    CARD,
    REACTION_KEY,
    BoardDoc,
    BoardName,
    BoardRecord,
    BoardSummary,
    check_doc,
    image_files,
    stage_refs,
    summary,
    task_refs,
)
from app.domain.errors import (
    BoardLimit,
    FileQuota,
    FileTooLarge,
    NewerFile,
    UnsupportedFile,
    ValidationFailed,
)
from app.domain.files import MAX_BYTES, Files, Served
from app.domain.planning import Planning, PlanningField, PlanningPerson, StageType
from app.domain.ports import BoardRepo, SnapshotRepo
from app.domain.tasks import Task

FORMAT = 1
MEDIA_TYPE = "application/vnd.tiko.board+zip"
# A board holds at most 2000 elements, so this many pictures is already far past real use.
MAX_ENTRIES = 2100
MAX_JSON_BYTES = 20 * 1024 * 1024
MAX_UPLOAD_BYTES = 300 * 1024 * 1024
MAX_UNPACKED_BYTES = 600 * 1024 * 1024
_FILE_ENTRY = re.compile(r"^files/([0-9a-f]{32})$")
_JSON_ENTRIES = ("manifest.json", "board.json", "tasks.json", "planning.json")

NOT_A_BOARD = "This is not a tiko board file. Export the board again from the board's menu."


class Manifest(BaseModel):
    format: int
    app: str = ""
    exported_at: str = ""
    name: BoardName
    # Stored picture id to its media type, for every file under files/.
    files: dict[str, str] = {}


class PlanningLists(BaseModel):
    """The stage types, people and fields a board's Gantts use."""

    types: list[StageType] = []
    people: list[PlanningPerson] = []
    fields: list[PlanningField] = []


@dataclass
class Bundle:
    manifest: Manifest
    doc: dict[str, Any]
    tasks: list[Task]
    planning: PlanningLists
    files: dict[str, bytes] = field(default_factory=dict)


class Note(BaseModel):
    """Something the import could not finish by itself, and what to do about it."""

    # Cards of a tracker not connected here are not a note: the board sees their state live.
    kind: Literal["planning_off", "planning_missing", "planning_added", "planning_full", "picture"]
    text: str


class ImportOut(BaseModel):
    board: BoardSummary
    # Elements by kind, as the report counts them.
    moved: dict[str, int]
    notes: list[Note]


def _named_sources(doc: dict[str, Any], default_source: str) -> dict[str, Any]:
    """A task that names no tracker belongs to this instance's; the file says which one, since
    the instance it lands on may be set to another."""
    for node in doc.get("nodes", []):
        data = node.get("data", {})
        if node.get("type") == CARD:
            data.setdefault("source", default_source)
        elif node.get("type") == "timer" and data.get("watch"):
            data["watch"].setdefault("source", default_source)
        elif node.get("type") == "module" and data.get("kind") == "gantt":
            for row in data.get("content", {}).get("rows", []):
                if row.get("key"):
                    row.setdefault("source", default_source)
    return doc


def _without_reactions(doc: dict[str, Any]) -> dict[str, Any]:
    # Reactions are by people of the old instance; their ids mean nothing on another.
    for node in doc.get("nodes", []):
        data = node.get("data", {})
        for key in [k for k in data if k.startswith(REACTION_KEY)]:
            del data[key]
    return doc


def _gantts(doc: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        node["data"]["content"]
        for node in doc.get("nodes", [])
        if node.get("type") == "module" and node.get("data", {}).get("kind") == "gantt"
    ]


def planning_refs(doc: BoardDoc) -> tuple[set[str], set[str], set[str]]:
    """Stage type, person and field ids the board's Gantts use, row values included."""
    types, people, fields = stage_refs(doc)
    for content in _gantts(doc.model_dump()):
        for row in content.get("rows", []):
            fields.update((row.get("values") or {}).keys())
    return types, people, fields


def export_board(
    record: BoardRecord,
    default_source: str,
    tasks: dict[str, Task],
    planning: PlanningLists,
    picture: Callable[[str], Served | None],
    app_version: str,
    now: datetime,
) -> bytes:
    """The board as a `.tiko` zip: its document, the last known tasks, the planning its Gantts
    use and the original bytes of its pictures."""
    doc = _without_reactions(
        _named_sources(record.doc.model_dump(exclude_none=True), default_source)
    )
    files: dict[str, Served] = {}
    for file_id in sorted(image_files(record.doc)):
        served = picture(file_id)
        if served is not None:
            files[file_id] = served
    manifest = Manifest(
        format=FORMAT,
        app=app_version,
        exported_at=now.isoformat(timespec="seconds"),
        name=record.name,
        files={file_id: served.mime for file_id, served in files.items()},
    )
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", manifest.model_dump_json(indent=2))
        zf.writestr("board.json", json.dumps(doc, ensure_ascii=False))
        # A task its tracker cannot be asked about here still carries what was last seen of it.
        known = [task.model_dump(mode="json") for task in tasks.values() if task.summary]
        zf.writestr("tasks.json", json.dumps(known, ensure_ascii=False))
        zf.writestr("planning.json", planning.model_dump_json())
        for file_id, served in files.items():
            # Pictures are compressed already.
            zf.writestr(f"files/{file_id}", served.data, zipfile.ZIP_STORED)
    return out.getvalue()


def _read(zf: zipfile.ZipFile, info: zipfile.ZipInfo, limit: int) -> bytes | None:
    """The entry's bytes, None past `limit`."""
    # The sizes in the zip's directory are the writer's word; count what actually comes out.
    with zf.open(info) as entry:
        data = entry.read(limit + 1)
    return data if len(data) <= limit else None


def _json(raw: bytes | None, name: str) -> Any:
    if raw is None:
        raise ValidationFailed(NOT_A_BOARD)
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise ValidationFailed(f"{name} in the file is damaged. Export the board again.") from exc


def read_bundle(data: bytes) -> Bundle:
    """Reads a `.tiko` file without trusting it: entries, sizes and paths are limited, and
    anything outside the known layout is ignored."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, ValueError) as exc:
        raise ValidationFailed(NOT_A_BOARD) from exc
    with zf:
        infos = zf.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValidationFailed(NOT_A_BOARD)
        raw: dict[str, bytes] = {}
        files: dict[str, bytes] = {}
        unpacked = 0
        try:
            for info in infos:
                if info.filename in _JSON_ENTRIES:
                    entry = _read(zf, info, MAX_JSON_BYTES)
                    if entry is None:
                        raise ValidationFailed(f"{info.filename} in the file is too large.")
                    raw[info.filename] = entry
                    unpacked += len(entry)
                elif match := _FILE_ENTRY.match(info.filename):
                    # A picture past the upload limit is left out: the import reports it.
                    entry = _read(zf, info, MAX_BYTES)
                    if entry is not None:
                        files[match[1]] = entry
                        unpacked += len(entry)
                if unpacked > MAX_UNPACKED_BYTES:
                    raise ValidationFailed("The file unpacks to more than tiko takes at once.")
        # RuntimeError: an encrypted entry; NotImplementedError: a compression zip lacks.
        except (
            zipfile.BadZipFile,
            zipfile.LargeZipFile,
            OSError,
            EOFError,
            RuntimeError,
            NotImplementedError,
        ) as exc:
            raise ValidationFailed(
                "The file is damaged or packed in a way tiko cannot read. Export the board again."
            ) from exc
    try:
        manifest = Manifest.model_validate(_json(raw.get("manifest.json"), "manifest.json"))
    except ValidationError as exc:
        raise ValidationFailed(NOT_A_BOARD) from exc
    if manifest.format > FORMAT:
        made_by = f"tiko {manifest.app}" if manifest.app else "a newer tiko"
        raise NewerFile(f"This board was exported by {made_by}. Update this tiko to import it.")
    doc = _json(raw.get("board.json"), "board.json")
    try:
        checked = BoardDoc.model_validate(doc)
        check_doc(checked)
    except ValidationError as exc:
        raise ValidationFailed("The board in the file does not read as a tiko board.") from exc
    tasks: list[Task] = []
    items = _json(raw.get("tasks.json", b"[]"), "tasks.json")
    for item in items if isinstance(items, list) else []:
        # A task that does not read is only a missing preview: the card fills in on refresh.
        try:
            tasks.append(Task.model_validate(item))
        except ValidationError:
            continue
    try:
        planning = PlanningLists.model_validate(
            _json(raw.get("planning.json", b"{}"), "planning.json")
        )
    except ValidationError:
        planning = PlanningLists()
    kept = {file_id: files[file_id] for file_id in manifest.files if file_id in files}
    return Bundle(
        manifest=manifest,
        doc=checked.model_dump(exclude_none=True),
        tasks=tasks,
        planning=planning,
        files=kept,
    )


def _distinct(ids: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(ids))


def _remap_planning(
    doc: dict[str, Any], types: dict[str, str], people: dict[str, str], fields: dict[str, str]
) -> None:
    for content in _gantts(doc):
        if content.get("columns"):
            content["columns"] = [fields.get(f, f) for f in content["columns"]]
        if content.get("filters"):
            content["filters"] = {
                ("person" if key == "person" else fields.get(key, key)): (
                    _distinct(people.get(p, p) for p in values) if key == "person" else values
                )
                for key, values in content["filters"].items()
            }
        for row in content.get("rows", []):
            if row.get("values"):
                row["values"] = {fields.get(k, k): v for k, v in row["values"].items()}
            for stage in row.get("stages") or []:
                stage["type"] = types.get(stage["type"], stage["type"])
                # Two people of one name in the file are one person here.
                stage["people"] = _distinct(people.get(p, p) for p in stage.get("people", []))


_KINDS = {
    "task_card": "cards",
    "sticky": "stickies",
    "shape": "shapes",
    "text": "texts",
    "frame": "frames",
    "image": "pictures",
    "module": "modules",
    "timer": "reminders",
}


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _mb(size: int) -> int:
    return max(1, round(size / (1024 * 1024)))


def import_board(
    person: Person,
    bundle: Bundle,
    boards: BoardRepo,
    files: Files,
    snapshots: SnapshotRepo,
    planning: Planning,
    default_source: str,
    limit: int | None = None,
) -> ImportOut:
    """A new board from the file, owned by the person. Nothing is left behind when it fails."""
    doc = deepcopy(bundle.doc)
    notes: list[Note] = []
    board_id = boards.create(bundle.manifest.name, BoardDoc(), person.id, limit)
    if board_id is None:
        raise BoardLimit(f"An account here holds {limit} boards. Delete one to make another.")
    try:
        _add_pictures(doc, bundle, files, person.id, board_id, notes)
        # Checked before Planning is touched, so a board that cannot be saved adds nothing there.
        check_doc(BoardDoc.model_validate(doc))
        _adopt_planning(doc, bundle.planning, planning, notes)
        final = BoardDoc.model_validate(doc)
        boards.save(board_id, 1, final)
        _seed_tasks(final, bundle.tasks, snapshots, default_source)
    except BaseException:
        boards.delete(board_id, person.id)
        boards.purge(board_id)
        raise

    moved = Counter(_KINDS[node.type] for node in final.nodes if node.type in _KINDS)
    moved["arrows"] = len(final.edges)
    return ImportOut(
        board=summary(person, board_id, boards),
        moved={kind: n for kind, n in moved.items() if n},
        notes=notes,
    )


def _seed_tasks(
    doc: BoardDoc, tasks: list[Task], snapshots: SnapshotRepo, default_source: str
) -> None:
    refs = set(task_refs(doc, default_source))
    seed = [task for task in tasks if task.ref in refs]
    cached = snapshots.get_many([task.ref for task in seed])
    # What the person's own tracker shows is newer than the file, unless it holds no title.
    snapshots.put_many(
        [task for task in seed if task.ref not in cached or not cached[task.ref].summary]
    )


def _add_pictures(
    doc: dict[str, Any],
    bundle: Bundle,
    files: Files,
    person_id: str,
    board_id: str,
    notes: list[Note],
) -> None:
    stored: dict[str, str] = {}
    refused: Counter[str] = Counter()
    pending = {
        node["data"]["file"]
        for node in doc["nodes"]
        if node["type"] == "image" and node["data"].get("file")
    }
    for node in doc["nodes"]:
        data = node["data"]
        old = data.get("file") if node["type"] == "image" else None
        if old is None:
            continue
        if old not in stored:
            raw = bundle.files.get(old)
            if raw is None:
                stored[old] = ""
                refused["The file did not carry it."] += 1
            else:
                try:
                    stored[old] = files.add(raw, bundle.manifest.files[old], person_id, board_id).id
                except FileQuota as exc:
                    left = sum(len(bundle.files.get(f, b"")) for f in pending - stored.keys())
                    raise FileQuota(
                        f"The board's pictures need about {_mb(left)} MB more than this"
                        " workspace has room for. Free some space, or ask an admin to raise"
                        " the quota, then import again."
                    ) from exc
                except (UnsupportedFile, FileTooLarge) as exc:
                    stored[old] = ""
                    refused[exc.message] += 1
        if stored[old]:
            data["file"] = stored[old]
        else:
            # Without a file and a start time the board asks to pick the picture again.
            data.pop("file", None)
            data.pop("since", None)
    for reason, n in refused.items():
        notes.append(
            Note(
                kind="picture",
                text=f"{_plural(n, 'picture', 'pictures')} did not move: {reason}"
                " Pick the file again on the empty frame.",
            )
        )


def _adopt_planning(
    doc: dict[str, Any], lists: PlanningLists, planning: Planning, notes: list[Note]
) -> None:
    types, people, fields = planning_refs(BoardDoc.model_validate(doc))
    if not (types or people or fields):
        return
    if not planning.enabled():
        notes.append(
            Note(
                kind="planning_off",
                text="Planning is off here, so the Gantts show stages without their types"
                " and people. A workspace admin turns it on in Settings; import the board"
                " again after that.",
            )
        )
        return
    described = {t.id for t in lists.types} | {p.id for p in lists.people}
    if (types | people) - described:
        notes.append(
            Note(
                kind="planning_missing",
                text="Some Gantt stages arrived without their types or people: Planning was off"
                " where the board was exported. Turn it on there, export the board again and"
                " import that file.",
            )
        )
    adopted = planning.adopt(
        [t for t in lists.types if t.id in types],
        [p for p in lists.people if p.id in people],
        [f for f in lists.fields if f.id in fields],
    )
    _remap_planning(doc, adopted.types, adopted.people, adopted.fields)
    if adopted.added:
        notes.append(
            Note(
                kind="planning_added",
                text="Added to Planning: " + ", ".join(adopted.added) + ".",
            )
        )
    if adopted.off_full:
        notes.append(
            Note(
                kind="planning_full",
                text="Not all time off fitted for "
                + ", ".join(dict.fromkeys(adopted.off_full))
                + ". Check it in Planning.",
            )
        )
    if adopted.full:
        notes.append(
            Note(
                kind="planning_full",
                text="Planning here has no room for these fields: "
                + ", ".join(adopted.full)
                + ". Archive some in Planning and import again to bring them.",
            )
        )
