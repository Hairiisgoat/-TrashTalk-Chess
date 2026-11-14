"""OpenAI Chat Completions API client (Structured / JSON Object mode)."""

from typing import Any

from app.llm.base import BaseLLMClient


class OpenAIClient(BaseLLMClient):
    """Asynchronous adapter for OpenAI GPT API."""

    provider_name = "openai"

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
            label="OpenAI",
            model_name=model_name,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
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
            label="OpenAI",
            model_name=model_name,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
