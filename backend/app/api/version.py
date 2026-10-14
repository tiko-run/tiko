from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import CurrentAdmin
from app.domain.updates import OneClickUpdate, UpdateService, UpdateView, VersionView

router = APIRouter(tags=["version"])


def updates(request: Request) -> UpdateService:
    return request.app.state.updates


def one_click(request: Request) -> OneClickUpdate:
    return request.app.state.one_click


@router.get("/version")
def version(service: Annotated[UpdateService, Depends(updates)]) -> VersionView:
    return service.view()


@router.post("/version/check")
def check_now(service: Annotated[UpdateService, Depends(updates)]) -> VersionView:
    return service.check_now()


@router.get("/update")
def update_status(service: Annotated[OneClickUpdate, Depends(one_click)]) -> UpdateView:
    return service.view()


@router.post("/update")
def start_update(
    _: CurrentAdmin, service: Annotated[OneClickUpdate, Depends(one_click)]
) -> UpdateView:
    return service.start()
