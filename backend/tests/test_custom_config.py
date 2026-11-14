"""Tests for stateless X-Custom-* BYOK header overrides, /ai/test-connection, and custom_persona."""

import json
from typing import Any

from fastapi.testclient import TestClient
import httpx

from app.api.v1.ai import get_http_client
from app.core.config import Settings, get_settings
from app.core.logging import mask_secrets
from app.main import create_app
from tests.test_move_contract import XIANGQI_PAYLOAD


def _empty_settings(**overrides: Any) -> Settings:
    defaults: dict[str, Any] = {
        "DEEPSEEK_API_KEY": "",
        "OPENAI_API_KEY": "",
        "ANTHROPIC_API_KEY": "",
        "LLM_REQUEST_TIMEOUT_SEC": 6.0,
        "FALLBACK_ON_UNCONFIGURED_PROVIDER": False,
    }
    defaults.update(overrides)
    return Settings(**defaults)


def test_mask_secrets_redacts_custom_api_key_header() -> None:
    masked = mask_secrets("header X-Custom-Api-Key: custom-relay-token-xyz Authorization: Bearer abcdef123456")
    assert "custom-relay-token-xyz" not in masked
    assert "abcdef123456" not in masked
    assert "***REDACTED***" in masked


def test_custom_headers_override_openai_relay_and_model() -> None:
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
                                    "comment": "中转站模型已就位，接招吧！",
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
    app.dependency_overrides[get_settings] = lambda: _empty_settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        resp = client.post(
            "/api/v1/ai/move",
            json=XIANGQI_PAYLOAD,
            headers={
                "X-Custom-Provider": "openai",
                "X-Custom-Base-Url": "https://relay.example.com/v1/chat/completions",
                "X-Custom-Api-Key": "relay-secret-key-007",
                "X-Custom-Model": "gpt-4o-custom",
            },
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["selected_move"] == "b9c7"
    assert data["model_provider"] == "openai"
    assert data["model_name"] == "gpt-4o-custom"
    assert captured["url"] == "https://relay.example.com/v1/chat/completions"
    assert captured["auth"] == "Bearer relay-secret-key-007"
    assert captured["body"]["model"] == "gpt-4o-custom"


def test_custom_headers_override_anthropic_and_empty_headers_fallback() -> None:
    captured: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured.append(
            {
                "url": str(request.url),
                "x_api_key": request.headers.get("x-api-key"),
                "auth": request.headers.get("Authorization"),
                "model": body.get("model"),
            }
        )
        if "messages" in str(request.url) and request.headers.get("x-api-key"):
            return httpx.Response(
                200,
                json={
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps(
                                {
                                    "selected_move": "h9g7",
                                    "comment": "请用茶，这一步我看得很清楚呢。",
                                    "emotion": "neutral",
                                },
                                ensure_ascii=False,
                            ),
                        }
                    ]
                },
            )
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "selected_move": "b9c7",
                                    "comment": "服务端默认配置接管。",
                                    "emotion": "neutral",
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
    app.dependency_overrides[get_settings] = lambda: _empty_settings(DEEPSEEK_API_KEY="sk-server-default")
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        # 1. Anthropic custom header override
        r_ant = client.post(
            "/api/v1/ai/move",
            json=XIANGQI_PAYLOAD,
            headers={
                "X-Custom-Provider": "anthropic",
                "X-Custom-Api-Key": "custom-claude-secret",
                "X-Custom-Model": "claude-sonnet-5-5",
            },
        )
        assert r_ant.status_code == 200
        assert r_ant.json()["model_provider"] == "anthropic"
        assert r_ant.json()["model_name"] == "claude-sonnet-5-5"
        assert captured[0]["x_api_key"] == "custom-claude-secret"
        assert captured[0]["url"].endswith("/messages")

        # 2. Empty headers gracefully fallback to server .env config
        r_srv = client.post(
            "/api/v1/ai/move",
            json=XIANGQI_PAYLOAD,
            headers={
                "X-Custom-Provider": "   ",
                "X-Custom-Api-Key": "",
                "X-Custom-Model": "",
            },
        )
        assert r_srv.status_code == 200
        assert r_srv.json()["model_provider"] == "deepseek"
        assert captured[1]["auth"] == "Bearer sk-server-default"


def test_custom_persona_overrides_prompt_and_allows_custom_id() -> None:
    captured_messages: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content.decode("utf-8"))
        captured_messages.extend(body.get("messages", []))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "selected_move": "b9c7",
                                    "comment": "得闲饮茶啦喂，让先两步照样赢你！",
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
    app.dependency_overrides[get_settings] = lambda: _empty_settings(DEEPSEEK_API_KEY="sk-server-default")
    app.dependency_overrides[get_http_client] = lambda: mock_client

    payload = {
        **XIANGQI_PAYLOAD,
        "persona_id": "custom_canton_king",
        "custom_persona": {
            "name": "暴躁广州棋王",
            "style_prompt": "暴躁傲娇的广州棋王，爱喝早茶、嘴硬心软",
            "catchphrase": "得闲饮茶啦喂！",
        },
    }

    with TestClient(app) as client:
        resp = client.post("/api/v1/ai/move", json=payload)

    assert resp.status_code == 200
    data = resp.json()
    assert data["persona_id"] == "custom_canton_king"
    system_prompt = captured_messages[0]["content"]
    assert "暴躁广州棋王" in system_prompt
    assert "爱喝早茶" in system_prompt
    assert "得闲饮茶啦喂" in system_prompt
    assert "selected_move" in system_prompt


def test_test_connection_endpoint_success_and_failure_no_secret_leak() -> None:
    secret_key = "custom-super-secret-xyz"

    def handler(request: httpx.Request) -> httpx.Response:
        auth = request.headers.get("Authorization", "")
        if auth == f"Bearer {secret_key}":
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": "OK"}}]},
            )
        return httpx.Response(401, json={"error": {"message": "Unauthorized"}})

    app = create_app()
    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_settings] = lambda: _empty_settings()
    app.dependency_overrides[get_http_client] = lambda: mock_client

    with TestClient(app) as client:
        ok_resp = client.post(
            "/api/v1/ai/test-connection",
            json={},
            headers={
                "X-Custom-Provider": "openai",
                "X-Custom-Base-Url": "https://proxy.test/v1",
                "X-Custom-Api-Key": secret_key,
                "X-Custom-Model": "gpt-4o-mini",
            },
        )
        assert ok_resp.status_code == 200
        ok_data = ok_resp.json()
        assert ok_data["ok"] is True
        assert ok_data["provider"] == "openai"
        assert ok_data["model_name"] == "gpt-4o-mini"
        assert ok_data["using_custom_credentials"] is True
        assert secret_key not in json.dumps(ok_data)

        bad_resp = client.post(
            "/api/v1/ai/test-connection",
            json={},
            headers={
                "X-Custom-Provider": "openai",
                "X-Custom-Api-Key": "wrong-key-999",
                "X-Custom-Model": "gpt-4o-mini",
            },
        )
        assert bad_resp.status_code == 200
        bad_data = bad_resp.json()
        assert bad_data["ok"] is False
        assert "HTTP 401" in bad_data["message"]
        assert "wrong-key-999" not in json.dumps(bad_data)
