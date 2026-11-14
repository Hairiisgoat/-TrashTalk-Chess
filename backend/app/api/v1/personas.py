"""Personas endpoint: GET /api/v1/personas."""

from fastapi import APIRouter, Depends, Query, Request

from app.core.config import Settings, get_settings
from app.core.logging import request_id_ctx
from app.personas.registry import list_personas
from app.schemas.common import GameType
from app.schemas.persona import PersonaListResponse

router = APIRouter(tags=["personas"])


@router.get("/personas", response_model=PersonaListResponse)
async def get_personas(
    request: Request,
    game_type: GameType | None = Query(
        default=None,
        description="Optional filter: 'xiangqi' or 'chess'",
    ),
    settings: Settings = Depends(get_settings),
) -> PersonaListResponse:
    """Return available AI personas without exposing server-side system prompts."""
    request_id = getattr(request.state, "request_id", None) or request_id_ctx.get("-")
    items = list_personas(settings=settings, game_type=game_type)
    return PersonaListResponse(
        personas=items,
        total=len(items),
        request_id=request_id,
    )
