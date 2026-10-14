from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.domain.updates import UpdateService, VersionView

router = APIRouter(tags=["version"])


def updates(request: Request) -> UpdateService:
    return request.app.state.updates


@router.get("/version")
def version(service: Annotated[UpdateService, Depends(updates)]) -> VersionView:
    return service.view()


@router.post("/version/check")
def check_now(service: Annotated[UpdateService, Depends(updates)]) -> VersionView:
    return service.check_now()
