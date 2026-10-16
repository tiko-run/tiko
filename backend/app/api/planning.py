from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.deps import CurrentAdmin, CurrentPerson, NotDemoVisitor, is_demo, not_on_demo
from app.domain.planning import (
    PersonChange,
    PersonIn,
    Planning,
    PlanningChange,
    PlanningPerson,
    PlanningView,
    StageType,
    TimeOffIn,
    TypeChange,
    TypeIn,
)

router = APIRouter(prefix="/planning", tags=["planning"])


def planning(request: Request) -> Planning:
    return request.app.state.planning


PlanningDep = Annotated[Planning, Depends(planning)]
# A demo instance has visitors who never met each other, so it has no shared planning lists.
Writer = [NotDemoVisitor, Depends(not_on_demo)]


@router.get("")
def get_planning(person: CurrentPerson, service: PlanningDep, request: Request) -> PlanningView:
    if is_demo(request):
        return PlanningView(enabled=False)
    return service.view()


@router.patch("", dependencies=[Depends(not_on_demo)])
def change_planning(
    body: PlanningChange, admin: CurrentAdmin, service: PlanningDep
) -> PlanningView:
    return service.set_enabled(body.enabled)


@router.post("/types", dependencies=Writer)
def add_type(body: TypeIn, person: CurrentPerson, service: PlanningDep) -> StageType:
    return service.add_type(body)


@router.patch("/types/{type_id}", dependencies=Writer)
def change_type(
    type_id: str, body: TypeChange, person: CurrentPerson, service: PlanningDep
) -> StageType:
    return service.change_type(type_id, body)


@router.post("/people", dependencies=Writer)
def add_person(body: PersonIn, person: CurrentPerson, service: PlanningDep) -> PlanningPerson:
    return service.add_person(body)


@router.patch("/people/{person_id}", dependencies=Writer)
def change_person(
    person_id: str, body: PersonChange, person: CurrentPerson, service: PlanningDep
) -> PlanningPerson:
    return service.change_person(person_id, body)


@router.post("/people/{person_id}/off", dependencies=Writer)
def add_off(
    person_id: str, body: TimeOffIn, person: CurrentPerson, service: PlanningDep
) -> PlanningPerson:
    return service.add_off(person_id, body)


@router.delete("/people/{person_id}/off/{off_id}", dependencies=Writer)
def remove_off(
    person_id: str, off_id: str, person: CurrentPerson, service: PlanningDep
) -> PlanningPerson:
    return service.remove_off(person_id, off_id)
