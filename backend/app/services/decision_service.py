"""Core decision service: validation, prompt assembly, LLM call, and fallback handling."""

import asyncio
import logging
import re
import time

from pydantic import ValidationError

from app.core.config import CustomLLMConfig, Settings, is_api_key_configured
from app.core.exceptions import (
    InvalidCandidatesError,
    InvalidFenError,
    PersonaNotFoundError,
    ProviderNotConfiguredError,
    UnsupportedGameForPersonaError,
)
from app.core.logging import mask_secrets
from app.llm.base import LLMUpstreamError
from app.llm.router import LLMRouter
from app.personas.prompts import (
    build_custom_system_prompt,
    build_user_prompt,
    get_system_prompt,
)
from app.personas.registry import PersonaConfig, get_persona
from app.schemas.common import FallbackReason, GameType, ModelProvider
from app.schemas.move import (
    LLMDecisionOutput,
    MoveRequest,
    MoveResponse,
    TestConnectionResponse,
)
from app.services.fallback import build_fallback_response

logger = logging.getLogger(__name__)

_CHESS_UCI_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")
_XIANGQI_UCI_RE = re.compile(r"^[a-i][0-9][a-i][0-9]$")

_CHESS_PIECES = set("pnbrqkPNBRQK")
_XIANGQI_PIECES = set("kabnrpcKABNRPCehEH")
_CHESS_CASTLING_RE = re.compile(r"^(-|[KQkq]{1,4})$")
_CHESS_EP_RE = re.compile(r"^(-|[a-h][36])$")


def validate_fen_for_game(game_type: GameType, fen: str) -> None:
    """Validate FEN syntax against chess or xiangqi (WXF) rules."""
    parts = fen.strip().split()
    if game_type == GameType.CHESS:
        if len(parts) != 6:
            raise InvalidFenError("Chess FEN must have 6 space-separated fields")
        board_str, turn, castling, ep, halfmove, fullmove = parts
        ranks = board_str.split("/")
        if len(ranks) != 8:
            raise InvalidFenError("Chess FEN board must have 8 ranks")
        for rank in ranks:
            col_count = 0
            for ch in rank:
                if "1" <= ch <= "8":
                    col_count += int(ch)
                elif ch in _CHESS_PIECES:
                    col_count += 1
                else:
                    raise InvalidFenError(f"Illegal chess piece character '{ch}'")
            if col_count != 8:
                raise InvalidFenError("Each chess FEN rank must span 8 squares")
        if turn not in ("w", "b"):
            raise InvalidFenError("Chess FEN active side must be 'w' or 'b'")
        if not _CHESS_CASTLING_RE.match(castling):
            raise InvalidFenError("Invalid chess FEN castling rights")
        if not _CHESS_EP_RE.match(ep):
            raise InvalidFenError("Invalid chess FEN en-passant target")
        if not halfmove.isdigit() or not fullmove.isdigit() or int(fullmove) < 1:
            raise InvalidFenError("Invalid chess FEN move counters")
        return

    # Xiangqi WXF FEN: minimum `<board> <turn>`, commonly 6 fields `<board> <turn> - - <half> <full>`
    if len(parts) < 2 or len(parts) > 6:
        raise InvalidFenError("Xiangqi FEN must contain 2 to 6 space-separated fields")
    board_str, turn = parts[0], parts[1]
    ranks = board_str.split("/")
    if len(ranks) != 10:
        raise InvalidFenError("Xiangqi FEN board must have 10 ranks")
    for rank in ranks:
        col_count = 0
        for ch in rank:
            if "1" <= ch <= "9":
                col_count += int(ch)
            elif ch in _XIANGQI_PIECES:
                col_count += 1
            else:
                raise InvalidFenError(f"Illegal xiangqi piece character '{ch}'")
        if col_count != 9:
            raise InvalidFenError("Each xiangqi FEN rank must span 9 files")
    if turn not in ("w", "b"):
        raise InvalidFenError("Xiangqi FEN active side must be 'w' or 'b'")


def validate_ucis_for_game(req: MoveRequest) -> None:
    """Validate that candidate and history UCIs conform to the active game's notation."""
    pattern = _CHESS_UCI_RE if req.game_type == GameType.CHESS else _XIANGQI_UCI_RE
    for idx, cand in enumerate(req.candidates):
        if not pattern.match(cand.uci):
            raise InvalidCandidatesError(
                f"candidates[{idx}].uci '{cand.uci}' is invalid for {req.game_type.value}",
                field="candidates",
            )
    for idx, item in enumerate(req.recent_history):
        if not pattern.match(item.uci):
            raise InvalidCandidatesError(
                f"recent_history[{idx}].uci '{item.uci}' is invalid for {req.game_type.value}",
                field="recent_history",
            )


def _classify_validation_error(exc: ValidationError) -> FallbackReason:
    for err in exc.errors():
        msg = str(err.get("msg", ""))
        loc = err.get("loc", ())
        if "illegal_move" in msg or "selected_move" in loc:
            return FallbackReason.ILLEGAL_MOVE
    return FallbackReason.INVALID_JSON


class DecisionService:
    """Stateless AI move decision orchestrator with 2-layer backend fault tolerance."""

    def __init__(self, llm_router: LLMRouter, settings: Settings) -> None:
        self.llm_router = llm_router
        self.settings = settings

    def _validate_request(self, req: MoveRequest) -> PersonaConfig:
        persona = get_persona(req.persona_id)
        if persona is None:
            if req.custom_persona is None:
                raise PersonaNotFoundError(req.persona_id)
            persona = PersonaConfig(
                persona_id=req.persona_id,
                name=req.custom_persona.name,
                title="玩家自定义对手",
                model_provider=ModelProvider.DEEPSEEK,
                default_model_name="",
                theme_color="#8B5CF6",
                avatar_url="",
                tags=("自定义",),
                supported_games=(GameType.CHESS, GameType.XIANGQI),
                greeting=req.custom_persona.catchphrase or "请赐教！",
                temperature=0.75,
            )

        if req.game_type not in persona.supported_games:
            raise UnsupportedGameForPersonaError(req.persona_id, req.game_type.value)

        validate_fen_for_game(req.game_type, req.fen)
        validate_ucis_for_game(req)
        return persona

    def _resolve_llm_target(
        self,
        *,
        default_provider: ModelProvider,
        default_model: str,
        custom_config: CustomLLMConfig | None,
    ) -> tuple[ModelProvider, str, str | None, str | None, bool]:
        """Resolve effective provider, model name, and stateless BYOK credentials."""
        provider = default_provider
        if custom_config and custom_config.provider:
            provider = ModelProvider(custom_config.provider)

        if custom_config and custom_config.model:
            model_name = custom_config.model
        elif provider != default_provider or not default_model:
            model_name = self.settings.get_provider_default_model(provider.value)
        else:
            model_name = default_model

        api_key_override = custom_config.api_key if custom_config else None
        base_url_override = custom_config.base_url if custom_config else None
        has_custom_key = is_api_key_configured(api_key_override)
        return provider, model_name, api_key_override, base_url_override, has_custom_key

    async def test_connection(
        self,
        *,
        request_id: str,
        custom_config: CustomLLMConfig | None = None,
        fallback_provider: ModelProvider | None = None,
        fallback_model: str | None = None,
    ) -> TestConnectionResponse:
        """Probe upstream LLM connectivity using custom headers or server defaults."""
        start_time = time.perf_counter()
        base_provider = fallback_provider or ModelProvider.DEEPSEEK
        base_model = (fallback_model or "").strip() or self.settings.get_provider_default_model(
            base_provider.value
        )
        provider, model_name, api_key_override, base_url_override, has_custom_key = (
            self._resolve_llm_target(
                default_provider=base_provider,
                default_model=base_model,
                custom_config=custom_config,
            )
        )
        using_custom = bool(
            custom_config and (has_custom_key or custom_config.base_url or custom_config.model)
        )

        if not has_custom_key and not self.settings.is_provider_configured(provider.value):
            latency_ms = max(0, int((time.perf_counter() - start_time) * 1000))
            return TestConnectionResponse(
                ok=False,
                provider=provider,
                model_name=model_name,
                latency_ms=latency_ms,
                message=f"未检测到 {provider.value} 的可用 API Key（请填写自定义密钥或配置服务端环境变量）",
                using_custom_credentials=using_custom,
                request_id=request_id,
            )

        try:
            await asyncio.wait_for(
                self.llm_router.test_connection(
                    provider=provider,
                    model_name=model_name,
                    api_key_override=api_key_override,
                    base_url_override=base_url_override,
                ),
                timeout=self.settings.LLM_REQUEST_TIMEOUT_SEC,
            )
            latency_ms = max(0, int((time.perf_counter() - start_time) * 1000))
            return TestConnectionResponse(
                ok=True,
                provider=provider,
                model_name=model_name,
                latency_ms=latency_ms,
                message=f"连接成功 ({provider.value} / {model_name})",
                using_custom_credentials=using_custom,
                request_id=request_id,
            )
        except asyncio.TimeoutError:
            latency_ms = max(0, int((time.perf_counter() - start_time) * 1000))
            return TestConnectionResponse(
                ok=False,
                provider=provider,
                model_name=model_name,
                latency_ms=latency_ms,
                message=f"连接超时（超过 {self.settings.LLM_REQUEST_TIMEOUT_SEC}s）",
                using_custom_credentials=using_custom,
                request_id=request_id,
            )
        except LLMUpstreamError as exc:
            latency_ms = max(0, int((time.perf_counter() - start_time) * 1000))
            return TestConnectionResponse(
                ok=False,
                provider=provider,
                model_name=model_name,
                latency_ms=latency_ms,
                message=mask_secrets(exc.detail),
                using_custom_credentials=using_custom,
                request_id=request_id,
            )
        except Exception as exc:
            latency_ms = max(0, int((time.perf_counter() - start_time) * 1000))
            logger.warning("Unexpected test_connection error err=%s", mask_secrets(str(exc)))
            return TestConnectionResponse(
                ok=False,
                provider=provider,
                model_name=model_name,
                latency_ms=latency_ms,
                message="连接测试失败，请检查 Base URL、模型名与密钥格式",
                using_custom_credentials=using_custom,
                request_id=request_id,
            )

    async def decide_move(
        self,
        req: MoveRequest,
        request_id: str,
        custom_config: CustomLLMConfig | None = None,
    ) -> MoveResponse:
        """Validate input, call LLM with hard timeout, enforce whitelist, or degrade safely."""
        start_time = time.perf_counter()
        persona = self._validate_request(req)

        persona_default_model = persona.resolve_model_name(self.settings)
        provider, model_name, api_key_override, base_url_override, has_custom_key = (
            self._resolve_llm_target(
                default_provider=persona.model_provider,
                default_model=persona_default_model,
                custom_config=custom_config,
            )
        )

        if not has_custom_key and not self.settings.is_provider_configured(provider.value):
            if self.settings.FALLBACK_ON_UNCONFIGURED_PROVIDER:
                latency_ms = int((time.perf_counter() - start_time) * 1000)
                logger.warning(
                    "Provider '%s' unconfigured; degrading to engine_top1 for persona=%s",
                    provider.value,
                    req.persona_id,
                )
                return build_fallback_response(
                    req=req,
                    reason=FallbackReason.LLM_API_ERROR,
                    latency_ms=latency_ms,
                    request_id=request_id,
                )
            raise ProviderNotConfiguredError(provider.value, req.persona_id)

        system_prompt = (
            build_custom_system_prompt(req.custom_persona)
            if req.custom_persona is not None
            else get_system_prompt(persona.persona_id)
        )
        user_prompt = build_user_prompt(req)
        allowed_moves = {cand.uci for cand in req.candidates}

        try:
            raw_output = await asyncio.wait_for(
                self.llm_router.generate_decision(
                    provider=provider,
                    model_name=model_name,
                    system_prompt=system_prompt,
                    user_prompt=user_prompt,
                    temperature=persona.temperature,
                    api_key_override=api_key_override,
                    base_url_override=base_url_override,
                ),
                timeout=self.settings.LLM_REQUEST_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            logger.warning(
                "Decision timed out persona=%s provider=%s latency_ms=%d",
                persona.persona_id,
                provider.value,
                latency_ms,
            )
            return build_fallback_response(
                req=req,
                reason=FallbackReason.LLM_TIMEOUT,
                latency_ms=latency_ms,
                request_id=request_id,
            )
        except LLMUpstreamError as exc:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            logger.warning(
                "LLM upstream failure persona=%s reason=%s detail=%s",
                persona.persona_id,
                exc.reason.value,
                exc.detail,
            )
            return build_fallback_response(
                req=req,
                reason=exc.reason,
                latency_ms=latency_ms,
                request_id=request_id,
            )
        except Exception as exc:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            logger.warning(
                "Unexpected LLM exception persona=%s err=%s",
                persona.persona_id,
                mask_secrets(str(exc)),
            )
            return build_fallback_response(
                req=req,
                reason=FallbackReason.LLM_API_ERROR,
                latency_ms=latency_ms,
                request_id=request_id,
            )

        # Layer-1 fault tolerance: Pydantic strict candidate whitelist + schema validation
        try:
            decision = LLMDecisionOutput.model_validate(
                raw_output,
                context={"allowed_moves": allowed_moves},
            )
        except ValidationError as exc:
            reason = _classify_validation_error(exc)
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            logger.warning(
                "LLM output validation failed persona=%s reason=%s",
                persona.persona_id,
                reason.value,
            )
            return build_fallback_response(
                req=req,
                reason=reason,
                latency_ms=latency_ms,
                request_id=request_id,
            )

        latency_ms = int((time.perf_counter() - start_time) * 1000)
        return MoveResponse(
            selected_move=decision.selected_move,
            comment=decision.comment,
            emotion=decision.emotion,
            persona_id=persona.persona_id,
            model_provider=provider,
            model_name=model_name,
            is_fallback=False,
            fallback_reason=None,
            latency_ms=max(0, latency_ms),
            request_id=request_id,
        )
