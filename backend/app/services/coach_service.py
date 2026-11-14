"""LangGraph-orchestrated post-game replay AI coach workflow grounded in client PV & tactics."""

import asyncio
import logging
import re
import time
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph

from app.core.config import CustomLLMConfig, Settings
from app.core.exceptions import ProviderNotConfiguredError
from app.core.logging import mask_secrets
from app.llm.base import LLMUpstreamError
from app.llm.router import LLMRouter
from app.personas.prompts import build_coach_system_prompt, build_coach_user_prompt
from app.personas.registry import PersonaConfig
from app.schemas.common import FallbackReason, ModelProvider
from app.schemas.move import CoachAskRequest, CoachAskResponse
from app.services.decision_service import (
    resolve_llm_target,
    resolve_persona_for_request,
    validate_candidate_list_ucis,
    validate_fen_for_game,
)

logger = logging.getLogger(__name__)

QuestionType = Literal[
    "step_diagnosis",
    "best_line_pv",
    "what_if_followup",
    "global_summary",
]

_GLOBAL_SUMMARY_RE = re.compile(r"(全局|全盘|整盘|总结|胜负手|走势|改进建议|复盘建议)")
_WHAT_IF_RE = re.compile(r"(如果|假若|假如|要是|万一|不换|不跟我换|为什么不能|改为|改成|那岂不是|不走这步)")
_STEP_DIAGNOSIS_RE = re.compile(r"(诊断|第\s*\d+\s*步|这步|刚才这手|得失|怎么样|好不好|失误|漏着|战犯)")
_BEST_LINE_RE = re.compile(r"(最佳|最优|推荐|主变|正解|强在哪|前3手|战略思路|怎么走)")


class CoachWorkflowState(TypedDict, total=False):
    """Typed state passed across LangGraph coach nodes."""

    req: CoachAskRequest
    persona: PersonaConfig
    provider: ModelProvider
    model_name: str
    api_key_override: str | None
    base_url_override: str | None
    has_custom_key: bool
    tactical_comparison: str
    question_type: QuestionType
    strategy_instruction: str
    system_prompt: str
    user_prompt: str
    history_messages: list[dict[str, str]]
    raw_answer: str
    is_fallback: bool
    fallback_reason: FallbackReason | None


def classify_coach_question(question: str, has_history: bool = False) -> QuestionType:
    """Route question to step diagnosis, best PV, what-if follow-up, or global summary."""
    q = (question or "").strip()
    if _GLOBAL_SUMMARY_RE.search(q):
        return "global_summary"
    if _WHAT_IF_RE.search(q):
        return "what_if_followup"
    if _STEP_DIAGNOSIS_RE.search(q):
        return "step_diagnosis"
    if _BEST_LINE_RE.search(q):
        return "best_line_pv"
    if has_history and (q.startswith("那") or q.startswith("为什么")):
        return "what_if_followup"
    return "step_diagnosis"


def build_tactical_comparison_summary(req: CoachAskRequest) -> str:
    """Node 1 output: objective comparison between actual play consequences and top PV lines."""
    lines: list[str] = []
    actual = req.actual_move_analysis
    ref_candidates = req.alternative_candidates or req.top_candidates

    if actual is not None:
        move_lbl = actual.notation or actual.uci or req.last_move_notation or "实际着法"
        tags_str = f" | 战术特征：[{'、'.join(actual.tactics_tags)}]" if actual.tactics_tags else ""
        pv_str = f" | 后续2~3步主变：{' -> '.join(actual.pv)}" if actual.pv else ""
        loss_str = (
            f" | 较引擎正解亏损约 {actual.eval_loss_cp} cp"
            if actual.eval_loss_cp is not None and actual.eval_loss_cp > 0
            else ""
        )
        lines.append(
            f"- 实走表现（{move_lbl}）：子力净变化 {actual.net_material_cp:+d} cp{loss_str}{tags_str}{pv_str}"
        )
        if actual.summary:
            lines.append(f"  实走事实摘要：{actual.summary}")
    elif req.last_move_notation:
        delta_note = (
            f"（我方胜率变化 {req.win_rate_delta:+.1f}%）"
            if req.win_rate_delta is not None
            else ""
        )
        lines.append(f"- 停驻着法：{req.last_move_notation}{delta_note}")

    if ref_candidates:
        best = ref_candidates[0]
        best_lbl = best.notation or best.uci
        best_tags = f" | 战术特征：[{'、'.join(best.tactics_tags)}]" if best.tactics_tags else ""
        best_pv = f" | 预期主变：{' -> '.join(best.pv)}" if best.pv else ""
        lines.append(
            f"- 引擎正解基准（{best_lbl}，评估 {best.score_cp:+d} cp）：{best_tags.lstrip(' |')}{best_pv}"
        )
        if actual and actual.uci and actual.uci != best.uci:
            lines.append(
                f"- 对比结论：实走「{actual.notation or actual.uci}」偏离了引擎首选「{best_lbl}」，"
                "回答时需对比两者后续 2 步的子力与先手差。"
            )
        elif actual and actual.uci == best.uci:
            lines.append("- 对比结论：实走与引擎首选一致，重点解析该着法的后续兑子/先手衔接。")
    else:
        lines.append("- 当前已无合法后续着法，重点基于前序胜负拐点复盘。")

    return "\n".join(lines)


def _build_coach_fallback_answer(
    req: CoachAskRequest,
    persona_name: str,
    tactical_comparison: str | None = None,
) -> str:
    """Deterministic engine-grounded fallback answer when upstream LLM fails/times out."""
    move_label = req.last_move_notation or "当前开局"
    lines = [
        f"（{persona_name} · 引擎客观复盘速览）当前我方胜率约 {req.win_rate:.1f}%。",
    ]
    if req.win_rate_delta is not None and req.win_rate_delta < -15:
        lines.append(
            f"刚才这步「{move_label}」让胜率骤降 {req.win_rate_delta:.1f}%，属于明显失误步，容易丢失先手或漏防丢子。"
        )
    elif req.last_move_notation:
        lines.append(f"针对刚刚的「{move_label}」（当前盘面评估 {req.score_cp:+d} cp）：")

    if tactical_comparison:
        lines.append(tactical_comparison)

    target_cands = req.alternative_candidates or req.top_candidates
    if target_cands:
        top1 = target_cands[0]
        pv_desc = f"，预期主变：{' -> '.join(top1.pv)}" if top1.pv else ""
        tags_desc = f"（{'、'.join(top1.tactics_tags)}）" if top1.tactics_tags else ""
        top_str = "、".join(
            f"{c.notation or c.uci}({c.score_cp:+d})" for c in target_cands[:3]
        )
        lines.append(
            f"本地引擎演算的最优推荐变例为：{top_str}；其中首选「{top1.notation or top1.uci}」{tags_desc}最稳妥{pv_desc}。"
        )
    else:
        lines.append("当前局面已无合法后续着法，胜负手已在前序关键回合分晓。")

    return "\n".join(lines)[:1950]


_STRATEGY_INSTRUCTIONS: dict[QuestionType, str] = {
    "step_diagnosis": (
        "【当前路由策略：单步诊断】\n"
        "1. 紧扣实走与引擎正解的对比，明确点出具体棋子走法及后续 2 步攻防变化。\n"
        "2. 结合战术标签与子力净变化，直白解释属于“一换一兑子 / 弃子争先 / 漏防丢子 / 中心控制”中的哪种情形，点明为什么强或为什么亏。"
    ),
    "best_line_pv": (
        "【当前路由策略：最佳变例推演 (PV)】\n"
        "1. 按候选顺序拆解引擎 Top-1（必要时补充 Top-2）的主变线 `1. ... -> 2. ... -> 3. ...`。\n"
        "2. 逐手说明第 1 步如何抢先/攻杀、第 2 步对手的被迫应招、第 3 步如何兑子获利或稳固优势。"
    ),
    "what_if_followup": (
        "【当前路由策略：自由假设追问 (What-If 分支推演)】\n"
        "1. 承接历史对话上下文，直接回应玩家的假设场景（如“如果对手不跟我换子 / 为什么要避开某着”）。\n"
        "2. 结合候选主变与盘面子力结构，推演若对手拒兑或改走其他应对后，接下来 2 步我方如何趁势抢攻、捉双或顺势兑子占优。"
    ),
    "global_summary": (
        "【当前路由策略：全局胜负手总结】\n"
        "1. 结合全盘关键转折点与战犯步摘要，梳理整盘优势建立与失势的关键回合。\n"
        "2. 用通俗棋理概括 2~3 条可落地的改进建议（如子力配合、弃子/兑子时机、防守意识）。"
    ),
}


class CoachService:
    """LangGraph-powered AI coach answering post-game & follow-up questions with PV & tactics."""

    def __init__(self, llm_router: LLMRouter, settings: Settings) -> None:
        self.llm_router = llm_router
        self.settings = settings
        self._graph = self._build_workflow()

    def _build_workflow(self):
        graph = StateGraph(CoachWorkflowState)

        graph.add_node("analyze_tactics", self._node_analyze_tactics)
        graph.add_node("prep_step_diagnosis", self._node_prepare_strategy("step_diagnosis"))
        graph.add_node("prep_best_line", self._node_prepare_strategy("best_line_pv"))
        graph.add_node("prep_what_if", self._node_prepare_strategy("what_if_followup"))
        graph.add_node("prep_global_summary", self._node_prepare_strategy("global_summary"))
        graph.add_node("generate_coaching", self._node_generate_coaching)

        graph.add_edge(START, "analyze_tactics")
        graph.add_conditional_edges(
            "analyze_tactics",
            self._route_question,
            {
                "step_diagnosis": "prep_step_diagnosis",
                "best_line_pv": "prep_best_line",
                "what_if_followup": "prep_what_if",
                "global_summary": "prep_global_summary",
            },
        )
        graph.add_edge("prep_step_diagnosis", "generate_coaching")
        graph.add_edge("prep_best_line", "generate_coaching")
        graph.add_edge("prep_what_if", "generate_coaching")
        graph.add_edge("prep_global_summary", "generate_coaching")
        graph.add_edge("generate_coaching", END)

        return graph.compile()

    def _node_analyze_tactics(self, state: CoachWorkflowState) -> dict[str, object]:
        req = state["req"]
        comparison = build_tactical_comparison_summary(req)
        q_type = classify_coach_question(
            req.question, has_history=bool(req.chat_history)
        )
        return {
            "tactical_comparison": comparison,
            "question_type": q_type,
        }

    def _route_question(self, state: CoachWorkflowState) -> QuestionType:
        return state.get("question_type", "step_diagnosis")

    def _node_prepare_strategy(self, q_type: QuestionType):
        def _prepare(state: CoachWorkflowState) -> dict[str, object]:
            req = state["req"]
            persona = state["persona"]
            strategy = _STRATEGY_INSTRUCTIONS[q_type]
            system_prompt = build_coach_system_prompt(persona.persona_id, req.custom_persona)
            user_prompt = build_coach_user_prompt(
                req,
                tactical_comparison=state.get("tactical_comparison"),
                strategy_instruction=strategy,
            )
            history_messages = [
                {"role": turn.role, "content": turn.content}
                for turn in req.chat_history[-8:]
            ]
            return {
                "question_type": q_type,
                "strategy_instruction": strategy,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "history_messages": history_messages,
            }

        return _prepare

    async def _node_generate_coaching(
        self, state: CoachWorkflowState
    ) -> dict[str, object]:
        req = state["req"]
        persona = state["persona"]
        provider = state["provider"]
        model_name = state["model_name"]
        api_key_override = state.get("api_key_override")
        base_url_override = state.get("base_url_override")
        has_custom_key = bool(state.get("has_custom_key"))

        if not has_custom_key and not self.settings.is_provider_configured(provider.value):
            if self.settings.FALLBACK_ON_UNCONFIGURED_PROVIDER:
                return {
                    "raw_answer": _build_coach_fallback_answer(
                        req, persona.name, state.get("tactical_comparison")
                    ),
                    "is_fallback": True,
                    "fallback_reason": FallbackReason.LLM_API_ERROR,
                }
            raise ProviderNotConfiguredError(provider.value, req.persona_id)

        fallback_reason: FallbackReason | None = None
        raw_answer = ""
        try:
            raw_answer = await asyncio.wait_for(
                self.llm_router.generate_text(
                    provider=provider,
                    model_name=model_name,
                    system_prompt=state["system_prompt"],
                    user_prompt=state["user_prompt"],
                    history_messages=state.get("history_messages"),
                    temperature=0.6,
                    max_tokens=850,
                    api_key_override=api_key_override,
                    base_url_override=base_url_override,
                ),
                timeout=self.settings.LLM_REQUEST_TIMEOUT_SEC,
            )
        except asyncio.TimeoutError:
            fallback_reason = FallbackReason.LLM_TIMEOUT
        except LLMUpstreamError as exc:
            logger.warning(
                "Coach upstream failure persona=%s reason=%s detail=%s",
                persona.persona_id,
                exc.reason.value,
                exc.detail,
            )
            fallback_reason = exc.reason
        except Exception as exc:
            logger.warning(
                "Unexpected coach exception persona=%s err=%s",
                persona.persona_id,
                mask_secrets(str(exc)),
            )
            fallback_reason = FallbackReason.LLM_API_ERROR

        cleaned = (raw_answer or "").strip()
        if fallback_reason is not None or not cleaned:
            return {
                "raw_answer": _build_coach_fallback_answer(
                    req, persona.name, state.get("tactical_comparison")
                ),
                "is_fallback": True,
                "fallback_reason": fallback_reason or FallbackReason.INVALID_JSON,
            }

        return {
            "raw_answer": cleaned[:1950],
            "is_fallback": False,
            "fallback_reason": None,
        }

    def _validate_request(self, req: CoachAskRequest) -> PersonaConfig:
        persona = resolve_persona_for_request(
            req.persona_id, req.game_type, req.custom_persona
        )
        validate_fen_for_game(req.game_type, req.fen)
        if req.top_candidates:
            validate_candidate_list_ucis(req.game_type, req.top_candidates, "top_candidates")
        if req.alternative_candidates:
            validate_candidate_list_ucis(
                req.game_type, req.alternative_candidates, "alternative_candidates"
            )
        return persona

    async def ask_coach(
        self,
        req: CoachAskRequest,
        request_id: str,
        custom_config: CustomLLMConfig | None = None,
    ) -> CoachAskResponse:
        """Run the LangGraph coach workflow and return engine-grounded persona reply."""
        start_time = time.perf_counter()
        persona = self._validate_request(req)
        persona_default_model = persona.resolve_model_name(self.settings)

        provider, model_name, api_key_override, base_url_override, has_custom_key = (
            resolve_llm_target(
                self.settings,
                default_provider=persona.model_provider,
                default_model=persona_default_model,
                custom_config=custom_config,
            )
        )

        final_state = await self._graph.ainvoke(
            {
                "req": req,
                "persona": persona,
                "provider": provider,
                "model_name": model_name,
                "api_key_override": api_key_override,
                "base_url_override": base_url_override,
                "has_custom_key": has_custom_key,
            }
        )

        latency_ms = max(0, int((time.perf_counter() - start_time) * 1000))
        is_fallback = bool(final_state.get("is_fallback"))

        return CoachAskResponse(
            answer=str(final_state.get("raw_answer") or "")[:1950],
            persona_id=persona.persona_id,
            model_provider=ModelProvider.FALLBACK if is_fallback else provider,
            model_name="engine_coach_fallback" if is_fallback else model_name,
            is_fallback=is_fallback,
            fallback_reason=final_state.get("fallback_reason"),
            question_type=final_state.get("question_type"),
            tactical_summary=final_state.get("tactical_comparison"),
            latency_ms=latency_ms,
            request_id=request_id,
        )
