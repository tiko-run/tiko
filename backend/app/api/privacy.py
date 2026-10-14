from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.api.deps import CurrentAdmin
from app.domain.usage import PrivacyView, UsageStats

router = APIRouter(prefix="/privacy", tags=["privacy"])


def _usage(request: Request) -> UsageStats:
    return request.app.state.usage


Usage = Annotated[UsageStats, Depends(_usage)]


class PrivacyIn(BaseModel):
    usage_stats: bool


@router.get("")
def get_privacy(_: CurrentAdmin, usage: Usage) -> PrivacyView:
    """The switches and the exact ping the instance sends next."""
    return usage.view()


@router.put("")
def put_privacy(body: PrivacyIn, _: CurrentAdmin, usage: Usage) -> PrivacyView:
    return usage.set_enabled(body.usage_stats)
