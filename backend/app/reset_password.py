"""Prints a one-time password reset link: `python -m app.reset_password <username>`.

For an admin who is locked out and has no other admin to issue a reset from Settings.
"""

import sys
import time

from app.adapters.storage import postgres, sqlite
from app.config import get_settings
from app.domain.accounts import Accounts
from app.domain.invites import RESET_TTL_S, Invites
from app.domain.sessions import Sessions


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m app.reset_password <username>", file=sys.stderr)
        return 2
    settings = get_settings()
    if settings.database_url:
        storage, db = postgres, postgres.shared(settings.database_url)
    else:
        storage, db = sqlite, sqlite.Database(settings.db_path)
    users = storage.UserRepo(db)
    sessions = Sessions(storage.SessionRepo(db))
    found = users.find(argv[0])
    if found is None:
        print(f"no person with the username {argv[0]!r}", file=sys.stderr)
        return 1
    person = found[0]
    invites = Invites(storage.InviteRepo(db), Accounts(users, sessions), sessions)
    # The person issues their own link: there may be no other admin to stand for it.
    _, token = invites.reset(person.id, person.id, time.time())
    hours = RESET_TTL_S // 3600
    print(f"Open this on your tiko address within {hours} hours to set a new password:")
    print(f"/?reset={token}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
