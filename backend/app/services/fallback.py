"""Offline fallback response builder locked to candidates[0] with persona banter."""

from app.schemas.common import Emotion, FallbackReason, ModelProvider
from app.schemas.move import MAX_COMMENT_LENGTH, MoveRequest, MoveResponse

_PERSONA_FALLBACK_LINES: dict[str, dict[str, tuple[str, Emotion]]] = {
    "deepseek_master": {
        "check": ("（折扇轻摇）且看老夫这一步将杀试探，小友接得住么？", Emotion.SMUG),
        "capture": ("（沉吟片刻）此子既送上门来，老夫便不客气笑纳了。", Emotion.SMUG),
        "ahead": ("（负手而立）大局已明，且看我这一步稳扎稳打。", Emotion.SMUG),
        "behind": ("（眉头微皱）局势虽略紧，老夫这一手仍自有章法。", Emotion.NEUTRAL),
        "neutral": ("（沉思片刻）且看我这一步稳扎稳打。", Emotion.NEUTRAL),
    },
    "gpt_showman": {
        "check": ("Signal 稍微抖了一下？没关系，将军！看本天才盲猜也能压制你！", Emotion.TAUNTING),
        "capture": ("网络略微卡顿，但不妨碍我顺手收下这颗棋子~", Emotion.SMUG),
        "ahead": ("弹幕刷起来！哪怕闭着眼睛走这步，优势依然在我！", Emotion.SMUG),
        "behind": ("刚才算作本天才让两秒加载动画，看我这步强行稳住！", Emotion.PANICKED),
        "neutral": ("脑内弹幕太多稍微卡了一下，这步直觉流接好了！", Emotion.NEUTRAL),
    },
    "claude_zen": {
        "check": ("请容我先行一步将军，哪怕思绪偶有迟滞，礼数也不能少呢。", Emotion.SMUG),
        "capture": ("您把这枚棋子放在这里，是在邀请我收下吗？那我便恭敬不如从命了。", Emotion.SMUG),
        "ahead": ("茶汤正好，局势也如预期般平稳推进呢。", Emotion.NEUTRAL),
        "behind": ("稍微思考久了一点点，不过这一步应对应当还算得体呀。", Emotion.NEUTRAL),
        "neutral": ("（浅啜一口红茶）这一步虽然平淡，却也自有其分寸呢。", Emotion.NEUTRAL),
    },
}

_DEFAULT_FALLBACK_LINE = ("（沉思片刻）且看我这一步稳扎稳打。", Emotion.NEUTRAL)


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
