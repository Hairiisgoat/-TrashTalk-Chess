"""Abstract base LLM client with unified timeout handling and JSON extraction."""

from abc import ABC, abstractmethod
import json
import logging
import re
from typing import Any

import httpx

from app.core.config import Settings, normalize_base_url
from app.core.logging import mask_secrets
from app.schemas.common import FallbackReason

logger = logging.getLogger(__name__)

_CODE_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)


class LLMUpstreamError(Exception):
    """Typed upstream LLM error mapped directly to a FallbackReason."""

    def __init__(self, reason: FallbackReason, detail: str) -> None:
        super().__init__(mask_secrets(detail))
        self.reason = reason
        self.detail = mask_secrets(detail)


def extract_json_payload(raw_text: str) -> dict[str, Any]:
    """Parse a JSON object from raw LLM text, stripping optional markdown fences."""
    if not isinstance(raw_text, str) or not raw_text.strip():
        raise LLMUpstreamError(FallbackReason.INVALID_JSON, "Empty LLM output")

    text = raw_text.strip()

    # 1. Direct JSON parse
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # 2. Markdown ```json ... ``` fence
    fence_match = _CODE_FENCE_RE.search(text)
    if fence_match:
        try:
            parsed = json.loads(fence_match.group(1))
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    # 3. Fallback scan for the outermost JSON object
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            parsed = json.loads(text[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    raise LLMUpstreamError(
        FallbackReason.INVALID_JSON,
        "LLM response did not contain a valid JSON object",
    )


class BaseLLMClient(ABC):
    """Base asynchronous client sharing an `httpx.AsyncClient` instance."""

    provider_name: str = "base"

    def __init__(self, http_client: httpx.AsyncClient, settings: Settings) -> None:
        self.http_client = http_client
        self.settings = settings

    @abstractmethod
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
        """Request structured move decision JSON from upstream LLM provider."""

    @abstractmethod
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
        """Request free-form text response (e.g. post-game coach analysis) from LLM."""

    @abstractmethod
    async def test_connection(
        self,
        *,
        model_name: str,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        """Perform a minimal connectivity probe against the upstream LLM provider."""

    def _resolve_credentials(
        self,
        *,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> tuple[str, str]:
        """Resolve per-request API key and normalized base URL with server fallback."""
        api_key = (api_key_override or "").strip() or self.settings.get_provider_api_key(
            self.provider_name
        )
        raw_base = (base_url_override or "").strip() or self.settings.get_provider_base_url(
            self.provider_name
        )
        return api_key, normalize_base_url(raw_base)

    async def _post_openai_chat(
        self,
        *,
        label: str,
        model_name: str,
        messages: list[dict[str, str]],
        temperature: float,
        max_tokens: int,
        json_mode: bool = False,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        api_key, base_url = self._resolve_credentials(
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
        url = f"{base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        data = await self._post_json(url=url, headers=headers, payload=payload)
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMUpstreamError(
                FallbackReason.INVALID_JSON,
                f"{label} response missing choices[0].message.content",
            ) from exc
        return str(content)

    async def _generate_openai_compatible_decision(
        self,
        *,
        label: str,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> dict[str, Any]:
        content = await self._post_openai_chat(
            label=label,
            model_name=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=300,
            json_mode=True,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
        return extract_json_payload(content)

    async def _generate_openai_compatible_text(
        self,
        *,
        label: str,
        model_name: str,
        system_prompt: str,
        user_prompt: str,
        history_messages: list[dict[str, str]] | None = None,
        temperature: float,
        max_tokens: int,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
        if history_messages:
            for item in history_messages:
                role = item.get("role")
                content = item.get("content")
                if role in {"user", "assistant"} and content:
                    messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": user_prompt})
        content = await self._post_openai_chat(
            label=label,
            model_name=model_name,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=False,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
        return content.strip()

    async def _test_openai_compatible(
        self,
        *,
        label: str,
        model_name: str,
        api_key_override: str | None = None,
        base_url_override: str | None = None,
    ) -> str:
        content = await self._post_openai_chat(
            label=f"{label} test",
            model_name=model_name,
            messages=[{"role": "user", "content": "Reply OK"}],
            temperature=0,
            max_tokens=8,
            json_mode=False,
            api_key_override=api_key_override,
            base_url_override=base_url_override,
        )
        return content.strip() or "OK"

    async def _post_json(
        self,
        *,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute POST with strict timeout and zero-leakage error translation."""
        timeout = httpx.Timeout(self.settings.LLM_REQUEST_TIMEOUT_SEC)
        try:
            response = await self.http_client.post(
                url,
                headers=headers,
                json=payload,
                timeout=timeout,
            )
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            logger.warning(
                "LLM request timed out provider=%s timeout=%.2fs",
                self.provider_name,
                self.settings.LLM_REQUEST_TIMEOUT_SEC,
            )
            raise LLMUpstreamError(
                FallbackReason.LLM_TIMEOUT,
                f"{self.provider_name} timed out after {self.settings.LLM_REQUEST_TIMEOUT_SEC}s",
            ) from exc
        except httpx.HTTPStatusError as exc:
            status_code = exc.response.status_code if exc.response is not None else 0
            logger.warning(
                "LLM HTTP error provider=%s status=%s",
                self.provider_name,
                status_code,
            )
            raise LLMUpstreamError(
                FallbackReason.LLM_API_ERROR,
                f"{self.provider_name} returned HTTP {status_code}",
            ) from exc
        except httpx.RequestError as exc:
            logger.warning(
                "LLM network error provider=%s err=%s",
                self.provider_name,
                mask_secrets(str(exc)),
            )
            raise LLMUpstreamError(
                FallbackReason.LLM_API_ERROR,
                f"{self.provider_name} network error",
            ) from exc

        try:
            data = response.json()
        except ValueError as exc:
            raise LLMUpstreamError(
                FallbackReason.INVALID_JSON,
                f"{self.provider_name} returned non-JSON HTTP body",
            ) from exc

        if not isinstance(data, dict):
            raise LLMUpstreamError(
                FallbackReason.INVALID_JSON,
                f"{self.provider_name} HTTP body was not a JSON object",
            )
        return data
