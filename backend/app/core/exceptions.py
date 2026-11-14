"""Unified business exceptions and FastAPI global exception handlers."""

from datetime import datetime, timezone
import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.logging import mask_secrets, request_id_ctx
from app.schemas.common import ErrorCode, ErrorResponse

logger = logging.getLogger(__name__)


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _resolve_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", None) or request_id_ctx.get("-")


class AppBaseException(Exception):
    """Base domain/API exception mapped to API_SPEC unified error response."""

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        detail: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.detail = detail


class InvalidFenError(AppBaseException):
    def __init__(self, reason: str, fen_preview: str | None = None) -> None:
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.INVALID_FEN,
            message=f"Invalid FEN string: {reason}",
            detail={"field": "fen", "reason": reason, **({"value": fen_preview} if fen_preview else {})},
        )


class PersonaNotFoundError(AppBaseException):
    def __init__(self, persona_id: str) -> None:
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.PERSONA_NOT_FOUND,
            message=f"Unknown persona_id: {persona_id}",
            detail={"field": "persona_id", "reason": "persona not found in registry"},
        )


class UnsupportedGameForPersonaError(AppBaseException):
    def __init__(self, persona_id: str, game_type: str) -> None:
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.UNSUPPORTED_GAME_FOR_PERSONA,
            message=f"Persona '{persona_id}' does not support game_type '{game_type}'",
            detail={"field": "game_type", "persona_id": persona_id, "game_type": game_type},
        )


class InvalidCandidatesError(AppBaseException):
    def __init__(self, reason: str, field: str = "candidates") -> None:
        super().__init__(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.INVALID_CANDIDATES,
            message=f"Invalid candidates: {reason}",
            detail={"field": field, "reason": reason},
        )


class RateLimitedError(AppBaseException):
    def __init__(self, reason: str = "Too many requests") -> None:
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            code=ErrorCode.RATE_LIMITED,
            message=reason,
            detail={"reason": reason},
        )


class ProviderNotConfiguredError(AppBaseException):
    def __init__(self, provider: str, persona_id: str) -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code=ErrorCode.PROVIDER_NOT_CONFIGURED,
            message=f"Model provider '{provider}' is not configured on the server",
            detail={"provider": provider, "persona_id": persona_id},
        )


def _error_json_response(
    status_code: int,
    code: ErrorCode,
    message: str,
    detail: dict[str, Any] | None,
    request_id: str,
) -> JSONResponse:
    payload = ErrorResponse(
        code=code,
        message=mask_secrets(message),
        detail=detail,
        request_id=request_id,
        timestamp=_utc_timestamp(),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def register_exception_handlers(app: FastAPI) -> None:
    """Attach unified error handlers onto the FastAPI application."""

    @app.exception_handler(AppBaseException)
    async def handle_app_exception(request: Request, exc: AppBaseException) -> JSONResponse:
        request_id = _resolve_request_id(request)
        logger.warning(
            "Business error code=%s status=%s message=%s",
            exc.code.value,
            exc.status_code,
            exc.message,
        )
        return _error_json_response(
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            detail=exc.detail,
            request_id=request_id,
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_exception(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        request_id = _resolve_request_id(request)
        sanitized_errors = [
            {
                "loc": list(err.get("loc", [])),
                "msg": str(err.get("msg", "")),
                "type": str(err.get("type", "")),
            }
            for err in exc.errors()
        ]
        logger.warning("Request validation failed: %s", sanitized_errors)
        return _error_json_response(
            status_code=getattr(status, "HTTP_422_UNPROCESSABLE_CONTENT", 422),
            code=ErrorCode.VALIDATION_ERROR,
            message="Request payload validation failed",
            detail={"errors": sanitized_errors},
            request_id=request_id,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(request: Request, exc: Exception) -> JSONResponse:
        request_id = _resolve_request_id(request)
        logger.exception("Unhandled internal error: %s", mask_secrets(str(exc)))
        return _error_json_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=ErrorCode.INTERNAL_SERVER_ERROR,
            message="Internal server error",
            detail=None,
            request_id=request_id,
        )
