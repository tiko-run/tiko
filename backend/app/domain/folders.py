from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.domain.errors import FolderLimit, NotFound
from app.domain.ports import FolderRepo

FOLDER_LIMIT = 100
FOLDER_NAME_MAX = 60
FolderName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=FOLDER_NAME_MAX)
]


class Folder(BaseModel):
    id: str
    name: str
    # From 1, in the order the person keeps their folders.
    position: int


def add_folder(person_id: str, name: str, folders: FolderRepo) -> Folder:
    folder = folders.add(person_id, name, FOLDER_LIMIT)
    if folder is None:
        raise FolderLimit(f"You can keep up to {FOLDER_LIMIT} folders. Delete one to add another.")
    return folder


def change_folder(
    person_id: str, folder_id: str, name: str | None, position: int | None, folders: FolderRepo
) -> Folder:
    folder = folders.change(person_id, folder_id, name, position)
    if folder is None:
        raise NotFound("folder not found")
    return folder


def delete_folder(person_id: str, folder_id: str, folders: FolderRepo) -> None:
    """The folder's boards stay on Home."""
    if not folders.remove(person_id, folder_id):
        raise NotFound("folder not found")


def place_board(person_id: str, board_id: str, folder_id: str | None, folders: FolderRepo) -> None:
    """Moves the board into one of the person's folders, or out of any with None."""
    if not folders.place(person_id, board_id, folder_id):
        raise NotFound("folder not found")
