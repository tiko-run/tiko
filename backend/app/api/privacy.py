from typing import Annotated

import anyio.to_thread
from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import CurrentAdmin, CurrentPerson
from app.domain.errors import Forbidden, ValidationFailed
from app.domain.usage import PageReports, Privacy, PrivacyIn, PrivacyView

router = APIRouter(prefix="/privacy", tags=["privacy"])


def _privacy(request: Request) -> Privacy:
    return request.app.state.privacy


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


# A page's report is a few kilobytes; anything bigger is not one.
MAX_REPORT_BYTES = 200_000


@router.post("/errors", status_code=204)
async def page_error(_: CurrentPerson, privacy: Switches, request: Request) -> Response:
    """The page's error reports, sent on from here while reports are on."""
    tunnel = request.app.state.error_tunnel
    if tunnel is None or not privacy.errors_enabled():
        raise Forbidden("Error reports are off.")
    body = await request.body()
    if len(body) > MAX_REPORT_BYTES:
        raise ValidationFailed("report too large")
    try:
        await anyio.to_thread.run_sync(tunnel.forward, body)
    except ValueError as exc:
        raise ValidationFailed("not a report for this tiko") from exc
    return Response(status_code=204)
