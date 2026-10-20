import shutil
from collections.abc import Callable
from pathlib import Path

# Room for the dump to grow while it is written.
HEADROOM = 1.2


class DumpUpdateBackups:
    """Room for `data/backups/pre-update-<version>.dump`, which the updater writes."""

    def __init__(self, database_size: Callable[[], int], data_dir: str) -> None:
        self._size = database_size
        self._data = Path(data_dir)

    def free_and_needed(self, version: str) -> tuple[int, int]:
        # A dump of an earlier try of the same update is replaced, so its room counts as free.
        earlier = self._data / "backups" / f"pre-update-{version}.dump"
        reused = earlier.stat().st_size if earlier.is_file() else 0
        # A compressed dump is smaller than the database; its size is the upper bound.
        return shutil.disk_usage(self._data).free + reused, int(self._size() * HEADROOM)
