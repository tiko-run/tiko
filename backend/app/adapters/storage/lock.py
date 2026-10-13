import fcntl
import threading
from typing import Self


class FileLock:
    """One holder at a time among the processes that share the file, and their threads."""

    def __init__(self, path: str) -> None:
        self._path = path
        self._threads = threading.Lock()
        self._file = None

    def __enter__(self) -> Self:
        self._threads.acquire()
        try:
            self._file = open(self._path, "a")  # noqa: SIM115
            fcntl.flock(self._file, fcntl.LOCK_EX)
        except BaseException:
            self._release()
            raise
        return self

    def __exit__(self, *exc: object) -> None:
        self._release()

    def _release(self) -> None:
        if self._file:
            # Closing the file gives the lock back.
            self._file.close()
            self._file = None
        self._threads.release()
