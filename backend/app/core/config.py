"""Application configuration loaded securely from environment variables."""

from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_PLACEHOLDER_PREFIXES = ("your_", "changeme", "placeholder", "<")


def normalize_base_url(raw_url: str) -> str:
    """Trim whitespace, trailing slashes, and accidental endpoint path suffixes."""
    cleaned = raw_url.strip().rstrip("/")
    for suffix in ("/chat/completions", "/messages"):
        if cleaned.lower().endswith(suffix):
            cleaned = cleaned[: -len(suffix)].rstrip("/")
            break
    return cleaned


@dataclass(frozen=True)
class CustomLLMConfig:
    """Stateless per-request LLM credentials and routing overrides from HTTP headers."""

    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None

    @property
    def has_any(self) -> bool:
        return bool(self.provider or self.base_url or self.api_key or self.model)


def is_api_key_configured(value: str | None) -> bool:
    """Return True if an API key is non-empty and not an example placeholder."""
    if not value:
        return False
    cleaned = value.strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    return not any(lowered.startswith(prefix) for prefix in _PLACEHOLDER_PREFIXES)


class Settings(BaseSettings):
    """Runtime settings read from environment or `.env` file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    APP_VERSION: str = "1.0.0"
    LOG_LEVEL: str = "INFO"
    CORS_ALLOW_ORIGINS: list[str] = Field(default_factory=lambda: ["*"])

    LLM_REQUEST_TIMEOUT_SEC: float = Field(default=6.0, gt=0.1, le=30.0)
    LLM_MAX_RETRIES: int = Field(default=0, ge=0, le=3)
    FALLBACK_ON_UNCONFIGURED_PROVIDER: bool = False

    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    DEEPSEEK_DEFAULT_MODEL: str = "deepseek-chat"

    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    OPENAI_DEFAULT_MODEL: str = "gpt-4o-mini"

    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com/v1"
    ANTHROPIC_DEFAULT_MODEL: str = "claude-3-5-sonnet-latest"

    @field_validator("DEEPSEEK_BASE_URL", "OPENAI_BASE_URL", "ANTHROPIC_BASE_URL")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        return v.strip().rstrip("/")

    def get_provider_api_key(self, provider: Literal["deepseek", "openai", "anthropic"] | str) -> str:
        """Retrieve the raw API key for a given model provider."""
        mapping = {
            "deepseek": self.DEEPSEEK_API_KEY,
            "openai": self.OPENAI_API_KEY,
            "anthropic": self.ANTHROPIC_API_KEY,
        }
        return mapping.get(provider, "").strip()

    def get_provider_base_url(self, provider: Literal["deepseek", "openai", "anthropic"] | str) -> str:
        """Retrieve the configured base URL for a given model provider."""
        mapping = {
            "deepseek": self.DEEPSEEK_BASE_URL,
            "openai": self.OPENAI_BASE_URL,
            "anthropic": self.ANTHROPIC_BASE_URL,
        }
        return mapping.get(provider, "")

    def get_provider_default_model(self, provider: Literal["deepseek", "openai", "anthropic"] | str) -> str:
        """Retrieve the default model identifier for a given provider."""
        mapping = {
            "deepseek": self.DEEPSEEK_DEFAULT_MODEL,
            "openai": self.OPENAI_DEFAULT_MODEL,
            "anthropic": self.ANTHROPIC_DEFAULT_MODEL,
        }
        return mapping.get(provider, self.DEEPSEEK_DEFAULT_MODEL)

    def is_provider_configured(self, provider: str) -> bool:
        """Check whether the given provider has a valid non-placeholder API key."""
        return is_api_key_configured(self.get_provider_api_key(provider))

    def providers_configured_map(self) -> dict[str, bool]:
        """Return configuration availability map for health check endpoint."""
        return {
            "deepseek": self.is_provider_configured("deepseek"),
            "openai": self.is_provider_configured("openai"),
            "anthropic": self.is_provider_configured("anthropic"),
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings instance."""
    return Settings()
