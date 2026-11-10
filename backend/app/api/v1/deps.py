from typing import Annotated

from fastapi import Depends, Request

from app.domain.accounts import Person
from app.domain.api_keys import KeyIdentity


def person(request: Request) -> Person:
    """Set by the gate from the key, with the role of a member of the key's workspace."""
    return request.state.person


def key(request: Request) -> KeyIdentity:
    return request.state.api_key


KeyPerson = Annotated[Person, Depends(person)]
Key = Annotated[KeyIdentity, Depends(key)]
