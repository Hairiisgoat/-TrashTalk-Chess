"""Tests for health check, persona metadata endpoints, and secret masking."""

from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.logging import mask_secrets
from app.main import create_app


def test_health_and_provider_flags() -> None:
    app = create_app()
    fake_settings = Settings(
        DEEPSEEK_API_KEY="sk-test-deepseek-12345678",
        OPENAI_API_KEY="your_openai_api_key_here",
        ANTHROPIC_API_KEY="",
    )
    app.dependency_overrides[get_settings] = lambda: fake_settings

    with TestClient(app) as client:
        resp = client.get("/api/v1/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"] == "1.0.0"
    assert body["providers_configured"] == {
        "deepseek": True,
        "openai": False,
        "anthropic": False,
    }


def test_list_personas_hides_system_prompt_and_tracks_enabled() -> None:
    app = create_app()
    fake_settings = Settings(
        DEEPSEEK_API_KEY="sk-test-deepseek-12345678",
        OPENAI_API_KEY="sk-test-openai-12345678",
        ANTHROPIC_API_KEY="your_anthropic_api_key_here",
    )
    app.dependency_overrides[get_settings] = lambda: fake_settings

    with TestClient(app) as client:
        resp = client.get("/api/v1/personas", headers={"X-Request-ID": "req_persona_01"})

    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID") == "req_persona_01"
    body = resp.json()
    assert body["total"] == 3
    assert body["request_id"] == "req_persona_01"

    personas_by_id = {p["persona_id"]: p for p in body["personas"]}
    assert set(personas_by_id.keys()) == {"deepseek_master", "gpt_showman", "claude_zen"}
    assert personas_by_id["deepseek_master"]["is_enabled"] is True
    assert personas_by_id["gpt_showman"]["is_enabled"] is True
    assert personas_by_id["claude_zen"]["is_enabled"] is False

    # Ensure system prompts are never exposed
    raw_text = resp.text
    assert "system_prompt" not in raw_text
    assert "核心职责与硬性输出规范" not in raw_text


def test_list_personas_filter_by_game_type() -> None:
    app = create_app()
    fake_settings = Settings()
    app.dependency_overrides[get_settings] = lambda: fake_settings

    with TestClient(app) as client:
        resp_xiangqi = client.get("/api/v1/personas?game_type=xiangqi")
        resp_chess = client.get("/api/v1/personas?game_type=chess")
        resp_invalid = client.get("/api/v1/personas?game_type=go")

    assert resp_xiangqi.status_code == 200
    assert resp_xiangqi.json()["total"] == 3

    assert resp_chess.status_code == 200
    assert resp_chess.json()["total"] == 3

    assert resp_invalid.status_code == 422
    assert resp_invalid.json()["code"] == 42200


def test_secret_masking_filter() -> None:
    sample = (
        "Authorization: Bearer sk-abc1234567890 "
        "x-api-key=sk-ant-secret987654"
    )
    masked = mask_secrets(sample)
    assert "sk-abc1234567890" not in masked
    assert "sk-ant-secret987654" not in masked
    assert "***REDACTED***" in masked
