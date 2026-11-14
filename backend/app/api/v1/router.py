"""API v1 router aggregation and health check endpoint."""

from fastapi import APIRouter, Depends

from app.api.v1 import ai, personas
from app.core.config import CustomLLMConfig, Settings, get_settings, is_api_key_configured
from app.schemas.common import HealthResponse

router = APIRouter(prefix="/api/v1")


@router.get("/health", response_model=HealthResponse, tags=["health"])
async def health_check(
    custom_config: CustomLLMConfig = Depends(ai.extract_custom_llm_config),
    settings: Settings = Depends(get_settings),
) -> HealthResponse:
    """Return service health status and provider key configuration readiness."""
    providers_map = settings.providers_configured_map()
    if custom_config.provider and is_api_key_configured(custom_config.api_key):
        providers_map[custom_config.provider] = True
    return HealthResponse(
        status="ok",
        providers_configured=providers_map,
        version=settings.APP_VERSION,
    )


router.include_router(personas.router)
router.include_router(ai.router)
