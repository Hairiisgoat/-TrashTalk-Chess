"""Move decision request, response, and strict LLM output validation schemas."""

from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)

from app.schemas.common import Difficulty, Emotion, FallbackReason, GameType, ModelProvider

MAX_COMMENT_LENGTH = 140


class CandidateMove(BaseModel):
    """Single top-K candidate move computed by the client-side engine."""

    model_config = ConfigDict(extra="forbid")

    uci: str = Field(..., min_length=4, max_length=5)
    score_cp: int = Field(..., ge=-30000, le=30000)
    notation: str | None = Field(default=None, max_length=24)
    is_capture: bool = False
    is_check: bool = False


class HistoryItem(BaseModel):
    """Single move entry in the 3-step sliding window history."""

    model_config = ConfigDict(extra="forbid")

    side: Literal["player", "ai"]
    uci: str = Field(..., min_length=4, max_length=5)
    notation: str | None = Field(default=None, max_length=24)
    eval_cp_after: int | None = Field(default=None, ge=-30000, le=30000)


class CustomPersonaConfig(BaseModel):
    """Temporary user-defined opponent persona overriding preset system prompts."""

    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., min_length=1, max_length=40)
    style_prompt: str = Field(..., min_length=1, max_length=500)
    catchphrase: str | None = Field(default=None, max_length=140)

    @field_validator("name", "style_prompt", mode="before")
    @classmethod
    def _strip_required_text(cls, value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("custom_persona fields must be non-empty strings")
        return " ".join(value.strip().split())

    @field_validator("catchphrase", mode="before")
    @classmethod
    def _strip_optional_text(cls, value: object) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("catchphrase must be a string")
        cleaned = " ".join(value.strip().split())
        return cleaned or None


class MoveRequest(BaseModel):
    """Request payload for POST /api/v1/ai/move."""

    model_config = ConfigDict(extra="forbid")

    game_type: GameType
    fen: str = Field(..., min_length=10, max_length=128)
    candidates: list[CandidateMove] = Field(..., min_length=1, max_length=10)
    persona_id: str = Field(..., min_length=1, max_length=64)
    difficulty: Difficulty
    recent_history: list[HistoryItem] = Field(..., min_length=0, max_length=3)
    win_rate_delta: float = Field(..., ge=-100.0, le=100.0)
    move_number: int | None = Field(default=None, ge=1)
    custom_persona: CustomPersonaConfig | None = None


class TestConnectionRequest(BaseModel):
    """Optional non-secret metadata for POST /api/v1/ai/test-connection."""

    model_config = ConfigDict(extra="forbid")

    provider: ModelProvider | None = None
    model: str | None = Field(default=None, max_length=128)


class TestConnectionResponse(BaseModel):
    """Connectivity check result returned by POST /api/v1/ai/test-connection."""

    model_config = ConfigDict(extra="forbid")

    ok: bool
    provider: ModelProvider
    model_name: str
    latency_ms: int = Field(..., ge=0)
    message: str
    using_custom_credentials: bool = False
    request_id: str


class MoveResponse(BaseModel):
    """Response payload for POST /api/v1/ai/move."""

    model_config = ConfigDict(extra="forbid")

    selected_move: str = Field(..., min_length=4, max_length=5)
    comment: str = Field(..., min_length=1, max_length=MAX_COMMENT_LENGTH)
    emotion: Emotion
    persona_id: str
    model_provider: ModelProvider
    model_name: str
    is_fallback: bool
    fallback_reason: FallbackReason | None
    latency_ms: int = Field(..., ge=0)
    request_id: str


class LLMDecisionOutput(BaseModel):
    """Strict Pydantic validator for raw JSON returned by upstream LLMs.

    Layer-1 fault tolerance: enforces `selected_move` membership in `candidates`
    via `ValidationInfo.context["allowed_moves"]`, non-empty `comment`, and valid `emotion`.
    """

    model_config = ConfigDict(extra="ignore")

    selected_move: str = Field(..., min_length=4, max_length=5)
    comment: str = Field(..., min_length=1, max_length=MAX_COMMENT_LENGTH)
    emotion: Emotion

    @field_validator("selected_move", mode="before")
    @classmethod
    def _normalize_move(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("selected_move must be a string")
        return value.strip().lower()

    @field_validator("comment", mode="before")
    @classmethod
    def _normalize_and_clamp_comment(cls, value: object) -> str:
        if not isinstance(value, str):
            raise ValueError("comment must be a string")
        cleaned = " ".join(value.strip().split())
        if not cleaned:
            raise ValueError("comment must not be empty")
        if len(cleaned) > MAX_COMMENT_LENGTH:
            return cleaned[: MAX_COMMENT_LENGTH - 1] + "…"
        return cleaned

    @field_validator("emotion", mode="before")
    @classmethod
    def _normalize_emotion(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @model_validator(mode="after")
    def _validate_move_in_candidates(self, info: ValidationInfo) -> "LLMDecisionOutput":
        context = info.context or {}
        allowed_moves = context.get("allowed_moves")
        if allowed_moves is not None and self.selected_move not in allowed_moves:
            raise ValueError(
                f"illegal_move: '{self.selected_move}' is not in candidates whitelist"
            )
        return self
