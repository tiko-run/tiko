from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field, model_validator

from app.api import deps
from app.api.deps import CanView, CurrentPerson
from app.domain import boards as boards_service
from app.domain import folders as service
from app.domain.boards import TrashedBoard
from app.domain.folders import Folder, FolderName
from app.domain.ports import BoardRepo, FolderRepo

router = APIRouter(tags=["folders"])


def folders(request: Request) -> FolderRepo:
    return request.app.state.folders


Folders = Annotated[FolderRepo, Depends(folders)]


class FolderList(BaseModel):
    folders: list[Folder]


class FolderIn(BaseModel):
    name: FolderName


class FolderChange(BaseModel):
    name: FolderName | None = None
    position: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _something(self) -> "FolderChange":
        if self.name is None and self.position is None:
            raise ValueError("send a name or a position")
        return self


class TrashList(BaseModel):
    boards: list[TrashedBoard]


class PlaceIn(BaseModel):
    folder_id: str | None


@router.put("/boards/{board_id}/star", status_code=204)
def star_board(board_id: str, _: CanView, person: CurrentPerson, repo: Folders) -> Response:
    repo.star(person.id, board_id, True)
    return Response(status_code=204)


@router.delete("/boards/{board_id}/star", status_code=204)
def unstar_board(board_id: str, _: CanView, person: CurrentPerson, repo: Folders) -> Response:
    repo.star(person.id, board_id, False)
    return Response(status_code=204)


@router.put("/boards/{board_id}/folder", status_code=204)
def place_board(
    board_id: str, body: PlaceIn, _: CanView, person: CurrentPerson, repo: Folders
) -> Response:
    service.place_board(person.id, board_id, body.folder_id, repo)
    return Response(status_code=204)


@router.get("/folders")
def list_folders(person: CurrentPerson, repo: Folders) -> FolderList:
    return FolderList(folders=repo.folders(person.id))


@router.post("/folders", status_code=201)
def add_folder(body: FolderIn, person: CurrentPerson, repo: Folders) -> Folder:
    return service.add_folder(person.id, body.name, repo)


@router.patch("/folders/{folder_id}")
def change_folder(
    folder_id: str, body: FolderChange, person: CurrentPerson, repo: Folders
) -> Folder:
    return service.change_folder(person.id, folder_id, body.name, body.position, repo)


@router.delete("/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: str, person: CurrentPerson, repo: Folders) -> Response:
    service.delete_folder(person.id, folder_id, repo)
    return Response(status_code=204)


@router.get("/trash")
def list_trash(
    person: CurrentPerson, boards: Annotated[BoardRepo, Depends(deps.boards)]
) -> TrashList:
    return TrashList(boards=boards_service.list_trash(person, boards))
