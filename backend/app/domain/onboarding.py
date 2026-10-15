from typing import Literal

from pydantic import BaseModel, ConfigDict

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
    model_config = ConfigDict(extra="forbid")

    tour_seen: bool | None = None
    done: list[Item] = []
    hidden: bool | None = None


def apply(state: Onboarding, patch: OnboardingChange, now: str) -> Onboarding:
    # An item stays done; doing it again keeps the first time.
    return state.model_copy(
        update={
            "tour_seen": state.tour_seen if patch.tour_seen is None else patch.tour_seen,
            "hidden": state.hidden if patch.hidden is None else patch.hidden,
            "done": {**{item: now for item in patch.done}, **state.done},
        }
    )
