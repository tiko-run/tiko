"""Moves the people of a demo's default workspace into workspaces of their own, once.

A demo copied from SQLite has every visitor and everyone who signed up in the default
workspace, where the Planning lists are now writable: each gets a copy of their own instead.
"""

import logging
import uuid

import psycopg

from app.adapters.storage.postgres import Database
from app.domain.tasks import now_iso

log = logging.getLogger(__name__)

MARK = "demo_people_moved"
_LOCK = "demo people moved"
# Rows that belong to one person and only name the workspace.
_PERSONAL = ("user_credentials", "task_snapshots", "demo_statuses", "onboarding")
_PLANNING = {
    "planning_types": "id, name, hue, archived, position",
    "planning_fields": "id, name, standard, archived, position",
    "planning_views": "id, name, filters, position",
    "planning_people": "id, name, teams, source, archived, position",
    "planning_off": "id, person_id, start_day, end_day",
}
_PLANNING_SETTINGS = ("planning_enabled", "planning_days_off")


def move_once(db: Database) -> int:
    """Gives each member of the default workspace who is not its admin a workspace of their
    own, when visitors are there; returns how many moved. Every process may call it."""
    with db.jobs() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", (_LOCK,))
        if conn.execute("SELECT 1 FROM server_settings WHERE key = %s", (MARK,)).fetchone():
            return 0
        default = db.default_workspace
        people = [
            row["user_id"]
            for row in conn.execute(
                "SELECT user_id FROM memberships WHERE workspace_id = %s AND role = 'member'"
                " ORDER BY user_id",
                (default,),
            )
        ]
        # A team that turns the demo on keeps its people together: it has no visitors yet.
        visitors = conn.execute(
            "SELECT EXISTS (SELECT 1 FROM users WHERE id = ANY(%s)"
            " AND demo_expires_at IS NOT NULL) AS any",
            (people,),
        ).fetchone()["any"]
        moved = people if visitors else []
        for user_id in moved:
            _move(conn, default, user_id)
        conn.execute("INSERT INTO server_settings (key, value) VALUES (%s, %s)", (MARK, now_iso()))
    if moved:
        log.info("demo: %d people moved into workspaces of their own", len(moved))
    return len(moved)


def _move(conn: psycopg.Connection, default: str, user_id: str) -> None:
    workspace = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO workspaces (id, name, kind, owner_id, created_at)"
        " VALUES (%s, 'Demo', 'demo', %s, %s)",
        (workspace, user_id, now_iso()),
    )
    owned = [
        row["board_id"]
        for row in conn.execute(
            "SELECT board_id FROM board_members"
            " WHERE workspace_id = %s AND user_id = %s AND role = 'owner'",
            (default, user_id),
        )
    ]
    # The references to a board name its workspace, so they go before it moves and come back
    # after. Strangers it was shared with lose it; the person leaves boards of others.
    stages = conn.execute(
        "DELETE FROM planning_stages WHERE board_id = ANY(%s)"
        ' RETURNING board_id, person_id, row_title, type, start, "end"',
        (owned,),
    ).fetchall()
    conn.execute("DELETE FROM board_members WHERE board_id = ANY(%s)", (owned,))
    conn.execute(
        "DELETE FROM board_members WHERE workspace_id = %s AND user_id = %s", (default, user_id)
    )
    conn.execute("UPDATE boards SET workspace_id = %s WHERE id = ANY(%s)", (workspace, owned))
    conn.execute(
        "UPDATE board_index SET workspace_id = %s WHERE board_id = ANY(%s)", (workspace, owned)
    )
    cursor = conn.cursor()
    cursor.executemany(
        "INSERT INTO board_members (workspace_id, board_id, user_id, role)"
        " VALUES (%s, %s, %s, 'owner')",
        [(workspace, board_id, user_id) for board_id in owned],
    )
    cursor.executemany(
        "INSERT INTO planning_stages"
        ' (workspace_id, board_id, person_id, row_title, type, start, "end")'
        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
        [(workspace, *row.values()) for row in stages],
    )
    for table in (*_PERSONAL, "memberships"):
        conn.execute(
            f"UPDATE {table} SET workspace_id = %s WHERE workspace_id = %s AND user_id = %s",
            (workspace, default, user_id),
        )
    # The lists the demo showed everyone, so the boards keep naming the same people and types.
    for table, columns in _PLANNING.items():
        conn.execute(
            f"INSERT INTO {table} (workspace_id, {columns})"
            f" SELECT %s, {columns} FROM {table} WHERE workspace_id = %s",
            (workspace, default),
        )
    conn.execute(
        "INSERT INTO settings (workspace_id, key, value)"
        " SELECT %s, key, value FROM settings WHERE workspace_id = %s AND key = ANY(%s)",
        (workspace, default, list(_PLANNING_SETTINGS)),
    )
