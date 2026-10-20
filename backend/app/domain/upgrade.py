from collections.abc import Callable

from app.domain.accounts import Accounts
from app.domain.errors import UsernameTaken
from app.domain.ports import CredentialRepo, MemberRepo, UserRepo

ADMIN = "admin"


def bootstrap_admin(accounts: Accounts, users: UserRepo, password: Callable[[], str]) -> bool:
    """Turns the instance password into the first admin's; True when it created them."""
    if users.count():
        return False
    try:
        accounts.create(ADMIN, "Admin", password(), "admin", server_admin=True)
    except UsernameTaken:
        # Another worker created the admin first.
        return False
    return True


def adopt_orphans(users: UserRepo, members: MemberRepo, credentials: CredentialRepo) -> None:
    """Boards from before accounts, or left without an owner, go to the first admin, and so
    do the instance's tracker token and task cache."""
    admins = [p for p in users.list() if p.role == "admin" and not p.disabled]
    if admins:
        first = min(admins, key=lambda p: p.created_at).id
        members.adopt_orphans(first)
        credentials.adopt_instance_token(first)
