"""Public persona metadata schemas (never exposes system_prompt)."""

from pydantic import BaseModel, ConfigDict

from app.schemas.common import GameType, ModelProvider


class PersonaPublicConfig(BaseModel):
    """Public persona descriptor returned by GET /api/v1/personas."""

    model_config = ConfigDict(extra="forbid")

    persona_id: str
    name: str
    title: str
    model_provider: ModelProvider
    model_name: str
    theme_color: str
    avatar_url: str
    tags: list[str]
    supported_games: list[GameType]
    greeting: str
    is_enabled: bool


class PersonaListResponse(BaseModel):
    """Response model for GET /api/v1/personas."""

    model_config = ConfigDict(extra="forbid")

    personas: list[PersonaPublicConfig]
    total: int
    request_id: str
