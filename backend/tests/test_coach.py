"""Tests for POST /api/v1/ai/coach/ask post-game replay coach, BYOK headers, and fallback."""

import json
from typing import Any

from fastapi.testclient import TestClient
import httpx

from app.api.v1.ai import get_http_client
from app.core.config import Settings, get_settings
from app.main import create_app


def _settings(**overrides: Any) -> Settings:
    defaults: dict[str, Any] = {
        "DEEPSEEK_API_KEY": "sk-test-deepseek-coach",
        "OPENAI_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
        "LLM_REQUEST_TIMEOUT_SEC": 6.0,
        "FALLBACK_ON_UNCONFIGURED_PROVIDER": False,
    }
    defaults.update(overrides)
    return Settings(**defaults)


COACH_PAYLOAD: dict[str, Any] = {
    "game_type": "chess",
    "fen": "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2",
    "last_move_notation": "Nf3",
    "score_cp": -35,
    "win_rate": 52.9,
    "top_candidates": [
        {"uci": "b8c6", "score_cp": 25, "notation": "Nc6", "is_capture": False, "is_check": False},
        {"uci": "g8f6", "score_cp": 18, "notation": "Nf6", "is_capture": False, "is_check": False},
        {"uci": "d7d6", "score_cp": 5, "notation": "d6", "is_capture": False, "is_check": False},
    ],
    "question": "这步棋为什么好，后续黑方最优应对是什么？",
    "persona_id": "deepseek_master",
    "win_rate_delta": 2.9,
}


def test_coach_ask_grounds_prompt_in_top_candidates_and_fen() -> None:
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured["messages"] = body["messages"]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "小友这手 Nf3 抢占先手、直指中心 e5 兵，算路尚可；黑方最优应对自当出 Nc6 护兵控心。"
                        }
                    }
                ]
            },
        )

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        resp = client.post("/api/v1/ai/coach/ask", json=COACH_PAYLOAD)

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_fallback"] is False
    assert data["model_provider"] == "deepseek"
    assert "Nf3" in data["answer"]

    system_msg = captured["messages"][0]["content"]
    user_msg = captured["messages"][1]["content"]
    assert "绝对禁止脱离端侧引擎算力胡编乱造" in system_msg
    assert "深求" in system_msg
    assert COACH_PAYLOAD["fen"] in user_msg
    assert "Nc6 (b8c6)" in user_msg
    assert "Nf6 (g8f6)" in user_msg
    assert "52.9%" in user_msg


def test_coach_ask_supports_custom_byok_headers_and_custom_persona() -> None:
    captured: dict[str, Any] = {}
    secret = "byok-coach-secret-777"

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("Authorization")
        captured["body"] = json.loads(request.content.decode("utf-8"))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "得闲饮茶啦喂！这步按引擎算就是 Nc6 最稳阵！"}}
                ]
            },
        )

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _settings(DEEPSEEK_API_KEY="")
    app.dependency_overrides[get_http_client] = lambda: mock_client

    payload = {
        **COACH_PAYLOAD,
        "persona_id": "custom_coach_gz",
        "custom_persona": {
            "name": "暴躁广州棋王",
            "style_prompt": "爱喝早茶、说话直接的粤语高手",
            "catchphrase": "得闲饮茶啦喂！",
        },
    }

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/ai/coach/ask",
            json=payload,
            headers={
                "X-Custom-Provider": "openai",
                "X-Custom-Base-Url": "https://coach-relay.example.com/v1",
                "X-Custom-Api-Key": secret,
                "X-Custom-Model": "gpt-4o-coach",
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["persona_id"] == "custom_coach_gz"
    assert data["model_provider"] == "openai"
    assert data["model_name"] == "gpt-4o-coach"
    assert secret not in json.dumps(data)
    assert captured["url"] == "https://coach-relay.example.com/v1/chat/completions"
    assert captured["auth"] == f"Bearer {secret}"
    assert "暴躁广州棋王" in captured["body"]["messages"][0]["content"]


def test_coach_ask_falls_back_cleanly_on_upstream_error() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "upstream down"})

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    payload = {
        **COACH_PAYLOAD,
        "win_rate_delta": -18.5,
    }

    with TestClient(app) as client:
        resp = client.post("/api/v1/ai/coach/ask", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["is_fallback"] is True
    assert data["fallback_reason"] == "llm_api_error"
    assert "Nc6" in data["answer"]
    assert "18.5%" in data["answer"]


def test_coach_ask_validates_fen_and_unconfigured_provider() -> None:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: _settings(DEEPSEEK_API_KEY="")

    with TestClient(app) as client:
        bad_fen = client.post(
            "/api/v1/ai/coach/ask",
            json={**COACH_PAYLOAD, "fen": "invalid/fen/string w"},
        )
        assert bad_fen.status_code == 400
        assert bad_fen.json()["code"] == 40001

        unconf = client.post("/api/v1/ai/coach/ask", json=COACH_PAYLOAD)
        assert unconf.status_code == 503
        assert unconf.json()["code"] == 50300


def test_langgraph_coach_workflow_synthesizes_pv_tactics_and_routes_questions() -> None:
    captured_requests: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured_requests.append(body)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "针对白后 h5e5（吃兵后反丢后），属于典型的漏防丢子；若改走马d2，虽经历一换一兑子但能保住先手。"
                        }
                    }
                ]
            },
        )

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    pv_payload = {
        **COACH_PAYLOAD,
        "last_move_notation": "Qxe5+",
        "win_rate": 12.4,
        "win_rate_delta": -38.5,
        "top_candidates": [
            {
                "uci": "g8f6",
                "score_cp": 880,
                "notation": "Nf6",
                "is_capture": False,
                "is_check": False,
                "pv": ["1. 马g8-f6", "2. 后e5xf6", "3. 兵g7xf6"],
                "tactics_tags": ["一换一兑子", "中心控制"],
            }
        ],
        "alternative_candidates": [
            {
                "uci": "g1f3",
                "score_cp": 45,
                "notation": "Nf3",
                "is_capture": False,
                "is_check": False,
                "pv": ["1. 马g1-f3", "2. 马b8-c6", "3. 象f1-c4"],
                "tactics_tags": ["中心控制"],
            }
        ],
        "actual_move_analysis": {
            "uci": "h5e5",
            "notation": "Qxe5+",
            "pv": ["1. 后h5xe5+", "2. 车d8xe5", "3. 兵d2-d4"],
            "net_material_cp": -800,
            "captured_by_mover": ["兵(100)"],
            "captured_by_opponent": ["后(900)"],
            "tactics_tags": ["白丢大子", "漏防丢子"],
            "eval_loss_cp": 820,
            "summary": "实走后2步子力净变化 -800cp（吃掉兵，损失后），较引擎正解亏损约 820cp。",
        },
        "question": "第5步我走 Qxe5+ 为什么亏这么多？请对比正解说明得失。",
    }

    with TestClient(app) as client:
        r_diag = client.post("/api/v1/ai/coach/ask", json=pv_payload)
        assert r_diag.status_code == 200
        d1 = r_diag.json()
        assert d1["question_type"] == "step_diagnosis"
        assert "白丢大子" in d1["tactical_summary"]
        assert "1. 马g1-f3 -> 2. 马b8-c6 -> 3. 象f1-c4" in d1["tactical_summary"]

        diag_sys = captured_requests[0]["messages"][0]["content"]
        diag_usr = captured_requests[0]["messages"][1]["content"]
        assert "后续 2 步攻防变化" in diag_sys
        assert "一换一兑子" in diag_sys
        assert "单步诊断" in diag_usr
        assert "白丢大子" in diag_usr
        assert "1. 马g1-f3 -> 2. 马b8-c6 -> 3. 象f1-c4" in diag_usr

        # 验证条件路由：最佳变例推演 & 全局总结
        r_best = client.post(
            "/api/v1/ai/coach/ask",
            json={**pv_payload, "question": "基于当前局面，引擎推荐的最佳主变怎么走？"},
        )
        assert r_best.status_code == 200
        assert r_best.json()["question_type"] == "best_line_pv"
        assert "最佳变例推演" in captured_requests[1]["messages"][1]["content"]

        r_sum = client.post(
            "/api/v1/ai/coach/ask",
            json={**pv_payload, "question": "请总结全盘胜负手与关键战犯步"},
        )
        assert r_sum.status_code == 200
        assert r_sum.json()["question_type"] == "global_summary"
        assert "全局胜负手总结" in captured_requests[2]["messages"][1]["content"]


def test_langgraph_coach_what_if_routing_and_multiturn_chat_history_on_anthropic() -> None:
    captured_body: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_body.update(json.loads(request.content.decode("utf-8")))
        return httpx.Response(
            200,
            json={
                "content": [
                    {
                        "type": "text",
                        "text": "若对手不跟你一换一兑子而选择退防，你正好借助车马协同抢下中路先手！",
                    }
                ]
            },
        )

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _settings(DEEPSEEK_API_KEY="")
    app.dependency_overrides[get_http_client] = lambda: mock_client

    payload = {
        **COACH_PAYLOAD,
        "question": "那如果他不跟我换子怎么办？",
        "chat_history": [
            {"role": "user", "content": "第4步为什么要先手兑子？"},
            {"role": "assistant", "content": "通过马换炮可以消除对手中路反击点，属于一换一兑子抢先手。"},
        ],
    }

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/ai/coach/ask",
            json=payload,
            headers={
                "X-Custom-Provider": "anthropic",
                "X-Custom-Api-Key": "sk-ant-coach-multiturn",
                "X-Custom-Model": "claude-sonnet-test",
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["question_type"] == "what_if_followup"
    assert data["model_provider"] == "anthropic"
    assert len(captured_body["messages"]) == 3
    assert captured_body["messages"][0]["role"] == "user"
    assert captured_body["messages"][1]["role"] == "assistant"
    assert captured_body["messages"][2]["role"] == "user"
    assert "自由假设追问" in captured_body["messages"][2]["content"]
    assert "如果他不跟我换子" in captured_body["messages"][2]["content"]
