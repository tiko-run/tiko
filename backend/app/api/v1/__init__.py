"""The public API v1 (spec 046): its own application, so its contract and errors stay apart
from the routes the web app uses."""

from fastapi import FastAPI, Request, Security
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from pydantic import BaseModel
from starlette.datastructures import State
from starlette.exceptions import HTTPException

from app.api.errors import error_body, register_error_handlers
from app.api.v1 import boards, me, tasks
from app.domain.errors import JiraUnauthorized

# Documents the scheme; the gate checks the key before any route runs.
bearer = HTTPBearer(auto_error=False, description="An API key from Settings → API keys.")

_HTTP_CODES = {404: "not_found", 405: "method_not_allowed"}


class ErrorDetail(BaseModel):
    code: str
    message: str


class Error(BaseModel):
    """Every error of v1; clients must ignore codes they do not know."""

    error: ErrorDetail


_RESPONSES = {
    status: {"model": Error, "description": text}
    for status, text in (
        (401, "No key, or a key that stopped working"),
        (403, "The key may not do this, or keys are switched off"),
        (404, "Not found, or not among what the key reaches"),
        (429, "Over a budget; see Retry-After"),
    )
}


def _our_errors(app: FastAPI) -> None:
    """FastAPI documents its own validation body; v1 answers with `Error` instead."""
    built = app.openapi

    def openapi() -> dict:
        if app.openapi_schema is None:
            schema = built()
            for operation in (o for path in schema["paths"].values() for o in path.values()):
                invalid = operation.get("responses", {}).get("422")
                if invalid:
                    invalid["description"] = "The request does not match the schema"
                    invalid["content"] = {
                        "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                    }
            for name in ("HTTPValidationError", "ValidationError"):
                schema["components"]["schemas"].pop(name, None)
        return app.openapi_schema

    app.openapi = openapi


def create(state: State) -> FastAPI:
    app = FastAPI(
        title="tiko API",
        version="1",
        docs_url=None,
        redoc_url=None,
        openapi_url="/openapi.json",
        dependencies=[Security(bearer)],
        responses=_RESPONSES,
    )
    # Routes read the main app's services through `request.app.state`.
    app.state = state
    app.include_router(me.router)
    app.include_router(boards.router)
    app.include_router(tasks.router)
    register_error_handlers(app)
    _our_errors(app)

    @app.exception_handler(JiraUnauthorized)
    async def tracker_unauthorized(_: Request, exc: JiraUnauthorized) -> JSONResponse:
        # A 401 here would read as a bad API key and send MCP clients looking for OAuth.
        message = f"{exc.message} Reconnect your tracker in Settings."
        return JSONResponse(error_body("tracker_unauthorized", message), status_code=403)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        code = _HTTP_CODES.get(exc.status_code, "http_error")
        return JSONResponse(error_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0]
        field = ".".join(str(part) for part in first["loc"][1:]) or "body"
        return JSONResponse(
            error_body("invalid_request", f"{field}: {first['msg']}"), status_code=422
        )

    return app
