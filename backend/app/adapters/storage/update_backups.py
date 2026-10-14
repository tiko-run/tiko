import shutil
from pathlib import Path

# Room for the copy to grow while it is written.
HEADROOM = 1.2


class SqliteUpdateBackups:
    """Room for `data/backups/pre-update-<version>.db`, which the updater writes."""

    def __init__(self, db_path: str) -> None:
        self._path = Path(db_path)

    def free_and_needed(self, version: str) -> tuple[int, int]:
        size = sum(
            p.stat().st_size
            for p in (self._path, self._path.with_name(f"{self._path.name}-wal"))
            if p.is_file()
        )
        # A copy from an earlier try of the same update is replaced, so its room counts as free.
        earlier = self._path.parent / "backups" / f"pre-update-{version}.db"
        reused = earlier.stat().st_size if earlier.is_file() else 0
        return shutil.disk_usage(self._path.parent).free + reused, int(size * HEADROOM)
