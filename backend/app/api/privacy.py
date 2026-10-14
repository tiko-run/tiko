from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import CurrentAdmin, CurrentPerson
from app.domain.usage import PageReports, Privacy, PrivacyIn, PrivacyView

router = APIRouter(prefix="/privacy", tags=["privacy"])


def _privacy(request: Request) -> Privacy:
    return request.app.state.usage


Switches = Annotated[Privacy, Depends(_privacy)]


@router.get("")
def get_privacy(_: CurrentAdmin, privacy: Switches) -> PrivacyView:
    """The switches and the exact ping the instance sends next."""
    return privacy.view()


@router.put("")
def put_privacy(body: PrivacyIn, _: CurrentAdmin, privacy: Switches) -> PrivacyView:
    return privacy.update(body)


@router.get("/page")
def page_reports(_: CurrentPerson, privacy: Switches) -> PageReports:
    return privacy.page_reports()
