"""Tests for 3-layer fallback: timeouts, HTTP errors, malformed JSON, and illegal moves."""

import asyncio
import json
from typing import Any

from fastapi.testclient import TestClient
import httpx

from app.api.v1.ai import get_http_client
from app.core.config import Settings, get_settings
from app.main import create_app

BASE_PAYLOAD: dict[str, Any] = {
    "game_type": "xiangqi",
    "fen": "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1",
    "candidates": [
        {"uci": "b9c7", "score_cp": 25, "notation": "马2进3", "is_capture": False, "is_check": False},
        {"uci": "h9g7", "score_cp": 10, "notation": "马8进7", "is_capture": False, "is_check": False},
    ],
    "persona_id": "deepseek_master",
    "difficulty": "balanced",
    "recent_history": [],
    "win_rate_delta": 0.0,
    "move_number": 1,
}


def _run_with_mock_handler(
    handler: Any,
    *,
    payload: dict[str, Any] | None = None,
    timeout_sec: float = 6.0,
    fallback_on_missing_key: bool = False,
    deepseek_key: str = "sk-test-key",
) -> httpx.Response:
    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    test_settings = Settings(
        DEEPSEEK_API_KEY=deepseek_key,
        OPENAI_API_KEY="sk-test-openai",
        ANTHROPIC_API_KEY="sk-ant-test-claude",
        LLM_REQUEST_TIMEOUT_SEC=timeout_sec,
        FALLBACK_ON_UNCONFIGURED_PROVIDER=fallback_on_missing_key,
    )
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        return client.post("/api/v1/ai/move", json=payload or BASE_PAYLOAD)


def test_fallback_on_httpx_timeout_exception() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("Upstream read timed out", request=request)

    resp = _run_with_mock_handler(handler)
    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_move"] == "b9c7"
    assert body["is_fallback"] is True
    assert body["fallback_reason"] == "llm_timeout"
    assert body["model_provider"] == "fallback"
    assert body["model_name"] == "engine_top1"
    assert len(body["comment"]) >= 1


def test_fallback_on_slow_llm_exceeding_timeout_budget() -> None:
    async def slow_handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.35)
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})

    resp = _run_with_mock_handler(slow_handler, timeout_sec=0.12)
    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_move"] == "b9c7"
    assert body["is_fallback"] is True
    assert body["fallback_reason"] == "llm_timeout"


def test_fallback_on_upstream_http_500_or_429() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "rate limited"}})

    resp = _run_with_mock_handler(handler)
    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_move"] == "b9c7"
    assert body["is_fallback"] is True
    assert body["fallback_reason"] == "llm_api_error"
    assert body["model_provider"] == "fallback"


def test_fallback_on_gibberish_non_json_output() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "哈哈我觉得应该走炮八平五才对！"}}]},
        )

    resp = _run_with_mock_handler(handler)
    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_move"] == "b9c7"
    assert body["is_fallback"] is True
    assert body["fallback_reason"] == "invalid_json"


def test_fallback_on_incomplete_json_missing_emotion() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps({"selected_move": "b9c7", "comment": "这一手不错"})
                        }
                    }
                ]
            },
        )

    resp = _run_with_mock_handler(handler)
    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_move"] == "b9c7"
    assert body["is_fallback"] is True
    assert body["fallback_reason"] == "invalid_json"


def test_fallback_on_hallucinated_illegal_move_outside_candidates() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "selected_move": "a0a9",  # Not in candidates whitelist
                                    "comment": "看我飞车直取老将！",
                                    "emotion": "taunting",
                                },
                                ensure_ascii=False,
                            )
                        }
                    }
                ]
            },
        )

    resp = _run_with_mock_handler(handler)
    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_move"] == "b9c7"
    assert body["is_fallback"] is True
    assert body["fallback_reason"] == "illegal_move"
    assert body["model_provider"] == "fallback"
    assert body["model_name"] == "engine_top1"


def test_fallback_when_unconfigured_key_and_flag_enabled() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError("HTTP transport should not be called when provider key is missing")

    resp = _run_with_mock_handler(
        handler,
        deepseek_key="",
        fallback_on_missing_key=True,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["selected_move"] == "b9c7"
    assert body["is_fallback"] is True
    assert body["fallback_reason"] == "llm_api_error"
