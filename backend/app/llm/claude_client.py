"""Anthropic Claude Messages API client."""

from typing import Any

from app.llm.base import BaseLLMClient, LLMUpstreamError, extract_json_payload
from app.schemas.common import FallbackReason


class ClaudeClient(BaseLLMClient):
    """Asynchronous adapter for Anthropic Messages API."""

    provider_name = "anthropic"
    ANTHROPIC_VERSION = "2023-06-01"

    async def generate_decision(
        self,
        *,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> dict[str, Any]:
        api_key, base_url = self._resolve_credentials(
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
        url = f"{base_url}/messages"

        headers = {
            "x-api-key": api_key,
            "anthropic-version": self.ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "model": model_name,
            "system": system_prompt,
            "messages": [
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "max_tokens": 300,
        }

        data = await self._post_json(url=url, headers=headers, payload=payload)
        content = self._extract_text(data)
        return extract_json_payload(content)

    async def generate_text(
        self,
        *,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        history_messages: list[dict[str, str]] | None = None,
        temperature: float = 0.6,
        max_tokens: int = 700,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        api_key, base_url = self._resolve_credentials(
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
        url = f"{base_url}/messages"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": self.ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }
        messages: list[dict[str, str]] = []
        if history_messages:
            for item in history_messages:
                role = item.get("role")
                content = item.get("content")
                if role not in {"user", "assistant"} or not content:
                    continue
                if not messages and role != "user":
                    continue
                if messages and messages[-1]["role"] == role:
                    messages[-1] = {
                        "role": role,
                        "content": f"{messages[-1]['content']}\n{content}",
                    }
                else:
                    messages.append({"role": role, "content": content})
        if messages and messages[-1]["role"] == "user":
            messages[-1] = {
                "role": "user",
                "content": f"{messages[-1]['content']}\n\n{user_prompt}",
            }
        else:
            messages.append({"role": "user", "content": user_prompt})
        payload: dict[str, Any] = {
            "model": model_name,
            "system": system_prompt,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        data = await self._post_json(url=url, headers=headers, payload=payload)
        return self._extract_text(data).strip()

    async def test_connection(
        self,
        *,
        model_name: str,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        api_key, base_url = self._resolve_credentials(
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
        url = f"{base_url}/messages"

        headers = {
            "x-api-key": api_key,
            "anthropic-version": self.ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": [{"role": "user", "content": "Reply OK"}],
            "temperature": 0,
            "max_tokens": 8,
        }

        data = await self._post_json(url=url, headers=headers, payload=payload)
        return self._extract_text(data).strip() or "OK"

    @staticmethod
    def _extract_text(data: dict[str, Any]) -> str:
        try:
            blocks = data["content"]
            text_parts = [
                block["text"]
                for block in blocks
                if isinstance(block, dict) and block.get("type") == "text"
            ]
            return "\n".join(text_parts)
        except (KeyError, TypeError) as exc:
            raise LLMUpstreamError(
                FallbackReason.INVALID_JSON,
                "Anthropic response missing content text block",
            ) from exc
