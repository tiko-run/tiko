from typing import Literal

from pydantic import BaseModel

from app.domain.ports import UserRepo

Item = Literal[
    "add_card",
    "paste_link",
    "search_filter",
    "set_timer",
    "timer_list",
    "gantt_task",
    "focus",
    "tracker",
]


class Onboarding(BaseModel):
    tour_seen: bool = False
    # When each getting started item was first done.
    done: dict[Item, str] = {}
    hidden: bool = False


class OnboardingChange(BaseModel):
    tour_seen: bool | None = None
    done: list[Item] = []
    hidden: bool | None = None


def read(users: UserRepo, user_id: str) -> Onboarding:
    return Onboarding.model_validate(users.onboarding(user_id))


def change(users: UserRepo, user_id: str, patch: OnboardingChange, now: str) -> Onboarding:
    state = read(users, user_id)
    if patch.tour_seen is not None:
        state.tour_seen = patch.tour_seen
    if patch.hidden is not None:
        state.hidden = patch.hidden
    # An item stays done; doing it again keeps the first time.
    state.done = {**{item: now for item in patch.done}, **state.done}
    users.set_onboarding(user_id, state.model_dump())
    return state
