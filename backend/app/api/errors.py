import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.domain.errors import (
    AccountDisabled,
    BoardLimit,
    DemoFull,
    DependencyUnavailable,
    DomainError,
    Forbidden,
    HostMismatch,
    InvalidCredentials,
    InvalidJql,
    InvalidRef,
    InviteExpired,
    JiraNotConfigured,
    JiraUnauthorized,
    LastAdmin,
    NotEnoughSpace,
    NotFound,
    OwnerRequired,
    SecretKeyMissing,
    TaskNotFound,
    TooManyAttempts,
    TooManyRepositories,
    TrackerRateLimited,
    UpdateNotPossible,
    UsernameTaken,
    ValidationFailed,
    VersionConflict,
    WeakPassword,
)

log = logging.getLogger(__name__)

_STATUS = {
    ValidationFailed: 422,
    NotFound: 404,
    DependencyUnavailable: 503,
    VersionConflict: 409,
    InvalidRef: 422,
    InvalidJql: 422,
    HostMismatch: 422,
    TaskNotFound: 404,
    SecretKeyMissing: 400,
    JiraNotConfigured: 400,
    JiraUnauthorized: 401,
    TrackerRateLimited: 429,
    TooManyRepositories: 429,
    InvalidCredentials: 401,
    AccountDisabled: 403,
    UsernameTaken: 409,
    WeakPassword: 422,
    Forbidden: 403,
    LastAdmin: 409,
    InviteExpired: 410,
    OwnerRequired: 409,
    TooManyAttempts: 429,
    DemoFull: 429,
    BoardLimit: 409,
    UpdateNotPossible: 409,
    NotEnoughSpace: 507,
}


def _status(exc: DomainError) -> int:
    # Subclasses (JiraUnavailable → DependencyUnavailable) share their parent's status.
    for cls in type(exc).__mro__:
        if cls in _STATUS:
            return _STATUS[cls]
    return 400


def error_body(code: str, message: str) -> dict:
    return {"error": {"code": code, "message": message}}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def domain_error(_: Request, exc: DomainError) -> JSONResponse:
        retry_after = getattr(exc, "retry_after", None)
        headers = {"retry-after": str(retry_after)} if retry_after else None
        return JSONResponse(
            error_body(exc.code, exc.message), status_code=_status(exc), headers=headers
        )

    @app.exception_handler(RequestValidationError)
    async def request_invalid(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0]
        field = ".".join(str(part) for part in first["loc"][1:]) or "body"
        return JSONResponse(
            error_body("invalid_request", f"{field}: {first['msg']}"), status_code=422
        )

    @app.exception_handler(Exception)
    async def unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error")
        return JSONResponse(error_body("internal", "internal server error"), status_code=500)
