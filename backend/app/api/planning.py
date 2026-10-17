from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from app.api.deps import (
    CurrentAdmin,
    CurrentPerson,
    NotDemoVisitor,
    is_demo,
    members,
    not_on_demo,
)
from app.domain.members import Members
from app.domain.planning import (
    MAX_WEEKS,
    DaysOff,
    FieldChange,
    FieldIn,
    PersonChange,
    PersonIn,
    Planning,
    PlanningChange,
    PlanningField,
    PlanningPerson,
    PlanningView,
    SavedView,
    StageType,
    TimeOffIn,
    TypeChange,
    TypeIn,
    ViewIn,
    Workload,
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


@router.post("/fields", dependencies=Writer)
def add_field(body: FieldIn, person: CurrentPerson, service: PlanningDep) -> PlanningField:
    return service.add_field(body)


@router.patch("/fields/{field_id}", dependencies=Writer)
def change_field(
    field_id: str, body: FieldChange, person: CurrentPerson, service: PlanningDep
) -> PlanningField:
    return service.change_field(field_id, body)


@router.post("/views", dependencies=Writer)
def add_view(body: ViewIn, person: CurrentPerson, service: PlanningDep) -> SavedView:
    return service.add_view(body)


@router.put("/days-off", dependencies=Writer)
def set_days_off(body: DaysOff, person: CurrentPerson, service: PlanningDep) -> DaysOff:
    return service.set_days_off(body)


@router.delete("/views/{view_id}", status_code=204, dependencies=Writer)
def remove_view(view_id: str, person: CurrentPerson, service: PlanningDep) -> Response:
    service.remove_view(view_id)
    return Response(status_code=204)


@router.get("/people/{person_id}/workload", dependencies=[Depends(not_on_demo)])
def get_workload(
    person_id: str,
    person: CurrentPerson,
    service: PlanningDep,
    access: Annotated[Members, Depends(members)],
    start: Annotated[date | None, Query(alias="from")] = None,
    weeks: Annotated[int, Query(ge=1, le=MAX_WEEKS)] = 12,
) -> Workload:
    return service.workload(
        person_id,
        start or date.today(),
        weeks,
        lambda board_id: access.role(person, board_id) is not None,
    )
