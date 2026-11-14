"""DeepSeek Chat Completions API client (OpenAI-compatible + JSON output)."""

from typing import Any

from app.llm.base import BaseLLMClient


class DeepSeekClient(BaseLLMClient):
    """Asynchronous adapter for DeepSeek API."""

    provider_name = "deepseek"

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
        return await self._generate_openai_compatible_decision(
            label="DeepSeek",
            model_name=model_name,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )

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
        return await self._generate_openai_compatible_text(
            label="DeepSeek",
            model_name=model_name,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            history_messages=history_messages,
            temperature=temperature,
            max_tokens=max_tokens,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )

    async def test_connection(
        self,
        *,
        model_name: str,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        return await self._test_openai_compatible(
            label="DeepSeek",
            model_name=model_name,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
