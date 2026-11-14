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
    pv: list[str] = Field(default_factory=list, max_length=6)
    tactics_tags: list[str] = Field(default_factory=list, max_length=8)


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


class ActualMoveAnalysis(BaseModel):
    """2-step lookahead material & tactical breakdown for the player's/AI's actual move."""

    model_config = ConfigDict(extra="ignore")

    uci: str | None = Field(default=None, max_length=8)
    notation: str | None = Field(default=None, max_length=32)
    pv: list[str] = Field(default_factory=list, max_length=6)
    net_material_cp: int = Field(default=0, ge=-30000, le=30000)
    captured_by_mover: list[str] = Field(default_factory=list, max_length=6)
    captured_by_opponent: list[str] = Field(default_factory=list, max_length=6)
    tactics_tags: list[str] = Field(default_factory=list, max_length=8)
    eval_loss_cp: int | None = Field(default=None, ge=-30000, le=30000)
    summary: str | None = Field(default=None, max_length=300)


class CoachChatTurn(BaseModel):
    """Single historical dialogue turn for multi-turn coach follow-up."""

    model_config = ConfigDict(extra="ignore")

    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=1200)

    @field_validator("content", mode="before")
    @classmethod
    def _clean_content(cls, value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("chat_history turn content must be non-empty")
        return " ".join(value.strip().split())


class CoachAskRequest(BaseModel):
    """Request payload for POST /api/v1/ai/coach/ask (post-game replay coach)."""

    model_config = ConfigDict(extra="forbid")

    game_type: GameType
    fen: str = Field(..., min_length=10, max_length=128)
    last_move_notation: str | None = Field(default=None, max_length=32)
    score_cp: int = Field(..., ge=-30000, le=30000)
    win_rate: float = Field(..., ge=0.0, le=100.0)
    top_candidates: list[CandidateMove] = Field(default_factory=list, max_length=5)
    question: str = Field(..., min_length=1, max_length=500)
    persona_id: str = Field(default="deepseek_master", min_length=1, max_length=64)
    custom_persona: CustomPersonaConfig | None = None
    win_rate_delta: float | None = Field(default=None, ge=-100.0, le=100.0)
    alternative_candidates: list[CandidateMove] | None = Field(default=None, max_length=5)
    actual_move_analysis: ActualMoveAnalysis | None = None
    chat_history: list[CoachChatTurn] = Field(default_factory=list, max_length=12)
    summary_context: str | None = Field(default=None, max_length=1000)

    @field_validator("question", mode="before")
    @classmethod
    def _clean_question(cls, value: object) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("question must be a non-empty string")
        return " ".join(value.strip().split())


class CoachAskResponse(BaseModel):
    """Response payload for POST /api/v1/ai/coach/ask."""

    model_config = ConfigDict(extra="forbid")

    answer: str = Field(..., min_length=1, max_length=2000)
    persona_id: str
    model_provider: ModelProvider
    model_name: str
    is_fallback: bool = False
    fallback_reason: FallbackReason | None = None
    question_type: str | None = None
    tactical_summary: str | None = None
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
