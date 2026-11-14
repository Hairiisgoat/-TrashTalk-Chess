"""Tests for /api/v1/ai/move contract, multi-provider mocking, and error codes."""

import json
from typing import Any

from fastapi.testclient import TestClient
import httpx
import pytest
from pydantic import ValidationError

from app.api.v1.ai import get_http_client
from app.core.config import Settings, get_settings
from app.main import create_app
from app.personas.prompts import build_user_prompt
from app.schemas.move import LLMDecisionOutput, MoveRequest

XIANGQI_PAYLOAD: dict[str, Any] = {
    "game_type": "xiangqi",
    "fen": "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1",
    "candidates": [
        {"uci": "b9c7", "score_cp": 15, "notation": "马2进3", "is_capture": False, "is_check": False},
        {"uci": "h9g7", "score_cp": 12, "notation": "马8进7", "is_capture": False, "is_check": False},
        {"uci": "h7e7", "score_cp": 5, "notation": "炮8平5", "is_capture": False, "is_check": False},
    ],
    "persona_id": "deepseek_master",
    "difficulty": "balanced",
    "recent_history": [
        {"side": "player", "uci": "h2e2", "notation": "炮二平五", "eval_cp_after": 10}
    ],
    "win_rate_delta": -1.8,
    "move_number": 1,
}

CHESS_PAYLOAD: dict[str, Any] = {
    "game_type": "chess",
    "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    "candidates": [
        {"uci": "e7e5", "score_cp": 10, "notation": "e5", "is_capture": False, "is_check": False},
        {"uci": "c7c5", "score_cp": -5, "notation": "c5", "is_capture": False, "is_check": False},
        {"uci": "g8f6", "score_cp": -20, "notation": "Nf6", "is_capture": False, "is_check": False},
    ],
    "persona_id": "gpt_showman",
    "difficulty": "casual",
    "recent_history": [
        {"side": "player", "uci": "e2e4", "notation": "e4", "eval_cp_after": 12}
    ],
    "win_rate_delta": 6.5,
    "move_number": 1,
}


def _configured_settings(**overrides: Any) -> Settings:
    defaults: dict[str, Any] = {
        "DEEPSEEK_API_KEY": "sk-test-deepseek-key",
        "OPENAI_API_KEY": "sk-test-openai-key",
        "ANTHROPIC_API_KEY": "sk-ant-test-claude-key",
        "LLM_REQUEST_TIMEOUT_SEC": 6.0,
        "FALLBACK_ON_UNCONFIGURED_PROVIDER": False,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def test_deepseek_normal_move_success() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "selected_move": "b9c7",
                                    "comment": "中炮开局？正合我意，跳个屏风马先给你架好阵势。",
                                    "emotion": "smug",
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
        )

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _configured_settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/ai/move",
            json=XIANGQI_PAYLOAD,
            headers={"X-Request-ID": "req_ds_001"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_move"] == "b9c7"
    assert data["emotion"] == "smug"
    assert data["persona_id"] == "deepseek_master"
    assert data["model_provider"] == "deepseek"
    assert data["model_name"] == "deepseek-chat"
    assert data["is_fallback"] is False
    assert data["fallback_reason"] is None
    assert data["request_id"] == "req_ds_001"
    assert captured["url"].endswith("/chat/completions")
    assert captured["auth"] == "Bearer sk-test-deepseek-key"
    assert captured["body"]["response_format"] == {"type": "json_object"}


def test_openai_casual_allows_candidate_variation() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "selected_move": "c7c5",
                                    "comment": "西西里防御走起！别以为我看不穿你的套路~",
                                    "emotion": "taunting",
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
        )

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _configured_settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        resp = client.post("/api/v1/ai/move", json=CHESS_PAYLOAD)

    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_move"] == "c7c5"
    assert data["emotion"] == "taunting"
    assert data["model_provider"] == "openai"
    assert data["is_fallback"] is False


def test_anthropic_tryhard_parses_fenced_json() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["api_key"] = request.headers.get("x-api-key")
        captured["version"] = request.headers.get("anthropic-version")
        return httpx.Response(
            200,
            json={
                "content": [
                    {
                        "type": "text",
                        "text": '```json\n{"selected_move": "e7e5", "comment": "对称应对最能试出您的成色呢。", "emotion": "neutral"}\n```',
                    }
                ]
            },
        )

    payload = {**CHESS_PAYLOAD, "persona_id": "claude_zen", "difficulty": "tryhard"}
    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _configured_settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        resp = client.post("/api/v1/ai/move", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_move"] == "e7e5"
    assert data["model_provider"] == "anthropic"
    assert data["is_fallback"] is False
    assert captured["url"].endswith("/messages")
    assert captured["api_key"] == "sk-ant-test-claude-key"
    assert captured["version"] == "2023-06-01"


def test_llm_decision_output_whitelist_and_clamping() -> None:
    allowed = {"b9c7", "h9g7"}

    valid = LLMDecisionOutput.model_validate(
        {"selected_move": " B9C7 ", "comment": "A" * 160, "emotion": "SMUG"},
        context={"allowed_moves": allowed},
    )
    assert valid.selected_move == "b9c7"
    assert len(valid.comment) == 140
    assert valid.emotion.value == "smug"

    with pytest.raises(ValidationError):
        LLMDecisionOutput.model_validate(
            {"selected_move": "a0a1", "comment": "非法走法", "emotion": "neutral"},
            context={"allowed_moves": allowed},
        )

    with pytest.raises(ValidationError):
        LLMDecisionOutput.model_validate(
            {"selected_move": "b9c7", "comment": "   ", "emotion": "neutral"},
            context={"allowed_moves": allowed},
        )


def test_prompt_reflects_difficulty_and_win_rate_delta() -> None:
    casual_even_payload = {
        **CHESS_PAYLOAD,
        "difficulty": "casual",
        "win_rate_delta": 18.0,
        "candidates": [
            {"uci": "e7e5", "score_cp": 20, "notation": "e5", "is_capture": False, "is_check": False},
            {"uci": "c7c5", "score_cp": 5, "notation": "c5", "is_capture": False, "is_check": False},
            {"uci": "g8f6", "score_cp": -10, "notation": "Nf6", "is_capture": False, "is_check": False},
            {"uci": "a7a6", "score_cp": -45, "notation": "a6", "is_capture": False, "is_check": False},
            {"uci": "f7f5", "score_cp": -95, "notation": "f5", "is_capture": False, "is_check": False},
        ],
    }
    casual_behind_payload = {
        **CHESS_PAYLOAD,
        "difficulty": "casual",
        "win_rate_delta": -16.0,
        "candidates": [
            {"uci": "e7e5", "score_cp": -120, "notation": "e5", "is_capture": False, "is_check": False},
            {"uci": "c7c5", "score_cp": -135, "notation": "c5", "is_capture": False, "is_check": False},
            {"uci": "g7g5", "score_cp": -220, "notation": "g5", "is_capture": False, "is_check": False},
        ],
    }
    casual_even_req = MoveRequest.model_validate(casual_even_payload)
    casual_behind_req = MoveRequest.model_validate(casual_behind_payload)
    tryhard_req = MoveRequest.model_validate({**CHESS_PAYLOAD, "difficulty": "tryhard", "win_rate_delta": -20.0})

    casual_even_prompt = build_user_prompt(casual_even_req)
    casual_behind_prompt = build_user_prompt(casual_behind_req)
    tryhard_prompt = build_user_prompt(tryhard_req)

    assert "120" not in casual_even_prompt
    assert "局势自适应放水" in casual_even_prompt
    assert "60%" in casual_even_prompt and "40%" in casual_even_prompt
    assert "[稳健对攻]" in casual_even_prompt
    assert "[温和次优-小破绽]" in casual_even_prompt
    assert "+18.0%" in casual_even_prompt

    assert "立即停止放水" in casual_behind_prompt
    assert "candidates[0..1]" in casual_behind_prompt
    assert "[防守反击首选]" in casual_behind_prompt
    assert "[劣势禁选-避免崩盘]" in casual_behind_prompt

    assert "15" in tryhard_prompt
    assert "绝不放水" in tryhard_prompt
    assert "-20.0%" in tryhard_prompt


def test_error_codes_for_invalid_inputs_and_unconfigured_provider() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: _configured_settings(DEEPSEEK_API_KEY="")

    with TestClient(app) as client:
        # 40002 PERSONA_NOT_FOUND
        r_persona = client.post("/api/v1/ai/move", json={**XIANGQI_PAYLOAD, "persona_id": "unknown_bot"})
        assert r_persona.status_code == 400
        assert r_persona.json()["code"] == 40002

        # 40001 INVALID_FEN
        r_fen = client.post("/api/v1/ai/move", json={**CHESS_PAYLOAD, "fen": "invalid/fen/string w"})
        assert r_fen.status_code == 400
        assert r_fen.json()["code"] == 40001

        # 40004 INVALID_CANDIDATES (chess promotion suffix is invalid in xiangqi)
        bad_candidates = [{"uci": "z9z9", "score_cp": 10}]
        r_cand = client.post("/api/v1/ai/move", json={**XIANGQI_PAYLOAD, "candidates": bad_candidates})
        assert r_cand.status_code == 400
        assert r_cand.json()["code"] == 40004

        # 42200 VALIDATION_ERROR
        r_val = client.post("/api/v1/ai/move", json={**XIANGQI_PAYLOAD, "win_rate_delta": 150.0})
        assert r_val.status_code == 422
        assert r_val.json()["code"] == 42200

        # 50300 PROVIDER_NOT_CONFIGURED
        r_unconf = client.post("/api/v1/ai/move", json=XIANGQI_PAYLOAD)
        assert r_unconf.status_code == 503
        assert r_unconf.json()["code"] == 50300
