import time

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.deps import AccountsDep, CurrentServerAdmin, InvitesDep
from app.api.people import InviteLink, link
from app.domain.accounts import Account

router = APIRouter(prefix="/accounts", tags=["accounts"])


class AccountView(BaseModel):
    id: str
    username: str
    name: str
    server_admin: bool
    disabled: bool
    in_workspace: bool
    last_sign_in_at: str | None
    created_at: str


class AccountList(BaseModel):
    accounts: list[AccountView]


class AccountChange(BaseModel):
    disabled: bool


def _view(account: Account) -> AccountView:
    return AccountView(**account.model_dump())


@router.get("")
def list_accounts(_: CurrentServerAdmin, accounts: AccountsDep) -> AccountList:
    return AccountList(accounts=[_view(account) for account in accounts.accounts()])


@router.patch("/{user_id}")
def change_account(
    user_id: str, body: AccountChange, _: CurrentServerAdmin, accounts: AccountsDep
) -> AccountView:
    return _view(accounts.set_disabled(user_id, body.disabled))


@router.post("/{user_id}/reset", status_code=201)
def reset_link(user_id: str, admin: CurrentServerAdmin, invites: InvitesDep) -> InviteLink:
    return link(*invites.reset(admin.id, user_id, time.time()))
