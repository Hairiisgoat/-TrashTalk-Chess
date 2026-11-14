"""Unified LLM provider router dispatching calls to provider-specific clients."""

from typing import Any

import httpx

from app.core.config import Settings
from app.llm.base import BaseLLMClient, LLMUpstreamError
from app.llm.claude_client import ClaudeClient
from app.llm.deepseek_client import DeepSeekClient
from app.llm.openai_client import OpenAIClient
from app.schemas.common import FallbackReason, ModelProvider


class LLMRouter:
    """Routes persona requests to DeepSeek, OpenAI, or Anthropic async clients."""

    def __init__(self, http_client: httpx.AsyncClient, settings: Settings) -> None:
        self._clients: dict[ModelProvider, BaseLLMClient] = {
            ModelProvider.DEEPSEEK: DeepSeekClient(http_client=http_client, settings=settings),
            ModelProvider.OPENAI: OpenAIClient(http_client=http_client, settings=settings),
            ModelProvider.ANTHROPIC: ClaudeClient(http_client=http_client, settings=settings),
        }

    async def generate_decision(
        self,
        *,
        provider: ModelProvider,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.7,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> dict[str, Any]:
        """Dispatch decision generation to the requested provider client."""
        client = self._get_client(provider)
        return await client.generate_decision(
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
        provider: ModelProvider,
        model_name: str,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        """Verify upstream provider connectivity using server or custom credentials."""
        client = self._get_client(provider)
        return await client.test_connection(
            model_name=model_name,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )

    def _get_client(self, provider: ModelProvider) -> BaseLLMClient:
        client = self._clients.get(provider)
        if client is None:
            raise LLMUpstreamError(
                FallbackReason.LLM_API_ERROR,
                f"Unsupported model provider: {provider}",
            )
        return client
