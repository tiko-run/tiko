import shutil
from pathlib import Path

from app.adapters.storage.sqlite import Database

KEEP = 3
# Room for the copy to grow while it is written, and for the WAL next to the database.
HEADROOM = 1.2


class SqliteUpdateBackups:
    """`data/backups/pre-update-<version>.db`, the newest few kept; other backups untouched."""

    def __init__(self, db: Database) -> None:
        self._db = db
        self._dir = Path(db.path).parent / "backups"

    def free_and_needed(self) -> tuple[int, int]:
        path = Path(self._db.path)
        size = path.stat().st_size + sum(
            p.stat().st_size for p in path.parent.glob(f"{path.name}-wal") if p.is_file()
        )
        return shutil.disk_usage(path.parent).free, int(size * HEADROOM)

    def copy_before_update(self, version: str) -> str:
        self._dir.mkdir(parents=True, exist_ok=True)
        name = f"pre-update-{version}.db"
        target = self._dir / name
        target.unlink(missing_ok=True)
        self._db.copy_to(target)
        kept = sorted(self._dir.glob("pre-update-*.db"), key=lambda p: p.stat().st_mtime)
        for old in kept[:-KEEP]:
            old.unlink()
        return name
