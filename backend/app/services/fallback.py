"""Offline fallback response builder locked to candidates[0] with persona banter."""

from app.schemas.common import Emotion, FallbackReason, ModelProvider
from app.schemas.move import MAX_COMMENT_LENGTH, MoveRequest, MoveResponse

_PERSONA_FALLBACK_LINES: dict[str, dict[str, tuple[str, Emotion]]] = {
    "deepseek_master": {
        "check": ("将军，看你怎么接！", Emotion.SMUG),
        "capture": ("此子老夫笑纳了", Emotion.SMUG),
        "ahead": ("局势尽在掌握", Emotion.SMUG),
        "behind": ("这手有点棘手", Emotion.NEUTRAL),
        "neutral": ("小友请接招", Emotion.NEUTRAL),
    },
    "gpt_showman": {
        "check": ("将军！接得住吗？", Emotion.TAUNTING),
        "capture": ("感谢送来的大礼~", Emotion.SMUG),
        "ahead": ("节奏彻底拿下！", Emotion.SMUG),
        "behind": ("哎呀这步有点东西", Emotion.PANICKED),
        "neutral": ("本能光速落子！", Emotion.NEUTRAL),
    },
    "claude_zen": {
        "check": ("请容我先行将军呢", Emotion.SMUG),
        "capture": ("那我便恭敬收下了", Emotion.SMUG),
        "ahead": ("局势如预期推进呢", Emotion.NEUTRAL),
        "behind": ("容我沉着应这一步", Emotion.NEUTRAL),
        "neutral": ("静候您的回应呀", Emotion.NEUTRAL),
    },
}

_DEFAULT_FALLBACK_LINE = ("看你怎么接", Emotion.NEUTRAL)


def _select_fallback_line(req: MoveRequest) -> tuple[str, Emotion]:
    top_move = req.candidates[0]
    bank = _PERSONA_FALLBACK_LINES.get(req.persona_id)
    if bank is None:
        return _DEFAULT_FALLBACK_LINE

    if top_move.is_check:
        comment, emotion = bank["check"]
    elif top_move.is_capture:
        comment, emotion = bank["capture"]
    elif req.win_rate_delta >= 5.0 or top_move.score_cp >= 200:
        comment, emotion = bank["ahead"]
    elif req.win_rate_delta <= -5.0 or top_move.score_cp <= -200:
        comment, emotion = bank["behind"]
    else:
        comment, emotion = bank["neutral"]

    if len(comment) > MAX_COMMENT_LENGTH:
        comment = comment[: MAX_COMMENT_LENGTH - 1] + "…"
    return comment, emotion


def build_fallback_response(
    *,
    req: MoveRequest,
    reason: FallbackReason,
    latency_ms: int,
    request_id: str,
) -> MoveResponse:
    """Build guaranteed HTTP 200 fallback response selecting candidates[0].uci."""
    comment, emotion = _select_fallback_line(req)
    return MoveResponse(
        selected_move=req.candidates[0].uci,
        comment=comment,
        emotion=emotion,
        persona_id=req.persona_id,
        model_provider=ModelProvider.FALLBACK,
        model_name="engine_top1",
        is_fallback=True,
        fallback_reason=reason,
        latency_ms=max(0, latency_ms),
        request_id=request_id,
    )
