"""AI move decision & connectivity test endpoints: POST /api/v1/ai/move and /test-connection."""

from fastapi import APIRouter, Body, Depends, Header, Request, status
import httpx

from app.core.config import CustomLLMConfig, Settings, get_settings, normalize_base_url
from app.core.exceptions import AppBaseException
from app.core.logging import request_id_ctx
from app.llm.router import LLMRouter
from app.schemas.common import ErrorCode
from app.schemas.move import (
    MoveRequest,
    MoveResponse,
    TestConnectionRequest,
    TestConnectionResponse,
)
from app.services.decision_service import DecisionService

router = APIRouter(tags=["ai"])

_VALID_CUSTOM_PROVIDERS = {"deepseek", "openai", "anthropic"}


def extract_custom_llm_config(
    x_custom_provider: str | None = Header(default=None, alias="X-Custom-Provider"),
    x_custom_base_url: str | None = Header(default=None, alias="X-Custom-Base-Url"),
    x_custom_api_key: str | None = Header(default=None, alias="X-Custom-Api-Key"),
    x_custom_model: str | None = Header(default=None, alias="X-Custom-Model"),
) -> CustomLLMConfig:
    """Parse optional stateless BYOK headers without logging sensitive credentials."""
    provider = (x_custom_provider or "").strip().lower() or None
    if provider is not None and provider not in _VALID_CUSTOM_PROVIDERS:
        raise AppBaseException(
            status_code=status.HTTP_400_BAD_REQUEST,
            code=ErrorCode.VALIDATION_ERROR,
            message=f"Unsupported X-Custom-Provider '{provider}'. Allowed: deepseek, openai, anthropic.",
        )

    raw_base_url = (x_custom_base_url or "").strip()
    base_url: str | None = None
    if raw_base_url:
        normalized = normalize_base_url(raw_base_url)
        lowered = normalized.lower()
        if not (lowered.startswith("http://") or lowered.startswith("https://")):
            raise AppBaseException(
                status_code=status.HTTP_400_BAD_REQUEST,
                code=ErrorCode.VALIDATION_ERROR,
                message="X-Custom-Base-Url must start with http:// or https://",
            )
        base_url = normalized

    api_key = (x_custom_api_key or "").strip() or None
    model = (x_custom_model or "").strip() or None

    return CustomLLMConfig(
        provider=provider,
        base_url=base_url,
        api_key=api_key,
        model=model,
    )


def get_http_client(request: Request) -> httpx.AsyncClient:
    """Retrieve the shared httpx.AsyncClient initialized in application lifespan."""
    return request.app.state.http_client


def get_decision_service(
    http_client: httpx.AsyncClient = Depends(get_http_client),
    settings: Settings = Depends(get_settings),
) -> DecisionService:
    """Build per-request DecisionService wired with shared httpx client & settings."""
    llm_router = LLMRouter(http_client=http_client, settings=settings)
    return DecisionService(llm_router=llm_router, settings=settings)


@router.post("/ai/move", response_model=MoveResponse)
async def create_ai_move(
    request: Request,
    payload: MoveRequest,
    custom_config: CustomLLMConfig = Depends(extract_custom_llm_config),
    service: DecisionService = Depends(get_decision_service),
) -> MoveResponse:
    """Select one move from candidates and generate persona banter via LLM."""
    request_id = getattr(request.state, "request_id", None) or request_id_ctx.get("-")
    return await service.decide_move(
        req=payload,
        request_id=request_id,
        custom_config=custom_config if custom_config.has_any else None,
    )


@router.post("/ai/test-connection", response_model=TestConnectionResponse)
async def test_ai_connection(
    request: Request,
    payload: TestConnectionRequest | None = Body(default=None),
    custom_config: CustomLLMConfig = Depends(extract_custom_llm_config),
    service: DecisionService = Depends(get_decision_service),
) -> TestConnectionResponse:
    """Test LLM provider connectivity using custom headers or server defaults."""
    request_id = getattr(request.state, "request_id", None) or request_id_ctx.get("-")
    return await service.test_connection(
        request_id=request_id,
        custom_config=custom_config if custom_config.has_any else None,
        fallback_provider=payload.provider if payload else None,
        fallback_model=payload.model if payload else None,
    )
