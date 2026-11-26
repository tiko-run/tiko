from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel

from app.api import deps
from app.domain.jql import JqlValue, JqlVocabulary
from app.domain.ports import TaskProvider
from app.domain.tasks import SOURCE_PATTERN

router = APIRouter(prefix="/jql", tags=["jql"])


def _provider(
    request: Request,
    source: Annotated[str | None, Query(pattern=SOURCE_PATTERN)] = None,
) -> TaskProvider:
    return deps.query_provider(request, source)


Provider = Annotated[TaskProvider, Depends(_provider)]


class ValuesOut(BaseModel):
    values: list[JqlValue]


@router.get("/vocabulary")
def vocabulary(provider: Provider) -> JqlVocabulary:
    return provider.jql_vocabulary()


@router.get("/values")
def values(
    provider: Provider,
    field: Annotated[str, Query(min_length=1, max_length=200)],
    prefix: Annotated[str, Query(max_length=200)] = "",
) -> ValuesOut:
    return ValuesOut(values=provider.jql_values(field, prefix))
