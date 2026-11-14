"""Common enums, error response, and health check schemas aligned with API_SPEC.md."""

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class GameType(str, Enum):
    XIANGQI = "xiangqi"
    CHESS = "chess"


class Difficulty(str, Enum):
    CASUAL = "casual"
    BALANCED = "balanced"
    TRYHARD = "tryhard"


class Emotion(str, Enum):
    NEUTRAL = "neutral"
    SMUG = "smug"
    TAUNTING = "taunting"
    PANICKED = "panicked"
    IMPRESSED = "impressed"
    RAGE = "rage"


class ModelProvider(str, Enum):
    DEEPSEEK = "deepseek"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    FALLBACK = "fallback"


class FallbackReason(str, Enum):
    LLM_TIMEOUT = "llm_timeout"
    LLM_API_ERROR = "llm_api_error"
    INVALID_JSON = "invalid_json"
    ILLEGAL_MOVE = "illegal_move"


class ErrorCode(int, Enum):
    INVALID_FEN = 40001
    PERSONA_NOT_FOUND = 40002
    UNSUPPORTED_GAME_FOR_PERSONA = 40003
    INVALID_CANDIDATES = 40004
    VALIDATION_ERROR = 42200
    RATE_LIMITED = 42900
    INTERNAL_SERVER_ERROR = 50000
    PROVIDER_NOT_CONFIGURED = 50300


class ErrorResponse(BaseModel):
    """Unified non-200 error response payload."""

    model_config = ConfigDict(extra="forbid")

    code: ErrorCode
    message: str
    detail: dict[str, Any] | None = None
    request_id: str
    timestamp: str


class HealthResponse(BaseModel):
    """Response model for GET /api/v1/health."""

    model_config = ConfigDict(extra="forbid")

    status: str = Field(default="ok")
    providers_configured: dict[str, bool]
    version: str
