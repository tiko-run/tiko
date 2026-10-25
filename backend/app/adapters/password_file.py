import os
import secrets
from pathlib import Path


def load_or_create(path: str) -> tuple[str, bool]:
    """Returns the saved instance password, generating one on first start; True when new."""
    file = Path(path)
    if file.exists():
        return file.read_text().strip(), False
    file.parent.mkdir(parents=True, exist_ok=True)
    password = secrets.token_urlsafe(15)
    try:
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        # Another worker won the race; use its password.
        return file.read_text().strip(), False
    with os.fdopen(fd, "w") as handle:
        handle.write(password + "\n")
    return password, True


def remove(path: str) -> None:
    """Deletes the generated password once the first admin has replaced it."""
    Path(path).unlink(missing_ok=True)
