"""Structured logging with request_id correlation and strict secret masking."""

from contextvars import ContextVar
import logging
import re
import sys

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")

_SECRET_PATTERNS = [
    # Mask Bearer tokens and API keys in headers or URLs
    (re.compile(r"(?i)(authorization\s*[:=]\s*bearer\s+)[^\s,;\"']+"), r"\1***REDACTED***"),
    (re.compile(r"(?i)(x-api-key\s*[:=]\s*)[^\s,;\"']+"), r"\1***REDACTED***"),
    (re.compile(r"(?i)(x-custom-api-key\s*[:=]\s*)[^\s,;\"']+"), r"\1***REDACTED***"),
    (re.compile(r"(?i)(api[-_]?key\s*[:=]\s*)[^\s,;\"']+"), r"\1***REDACTED***"),
    (re.compile(r"(?i)(bearer\s+)[a-z0-9._\-]{8,}"), r"\1***REDACTED***"),
    # Mask OpenAI / DeepSeek / Anthropic key prefixes
    (re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{6,}\b"), "sk-ant-***REDACTED***"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}\b"), "sk-***REDACTED***"),
]


def mask_secrets(text: str) -> str:
    """Redact potential API keys or auth headers from log text."""
    masked = text
    for pattern, replacement in _SECRET_PATTERNS:
        masked = pattern.sub(replacement, masked)
    return masked


class SecretMaskingFilter(logging.Filter):
    """Logging filter that injects request_id and masks sensitive credentials."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get("-")
        if isinstance(record.msg, str):
            record.msg = mask_secrets(record.msg)
        if record.args:
            if isinstance(record.args, tuple):
                record.args = tuple(
                    mask_secrets(arg) if isinstance(arg, str) else arg
                    for arg in record.args
                )
            elif isinstance(record.args, dict):
                record.args = {
                    k: mask_secrets(v) if isinstance(v, str) else v
                    for k, v in record.args.items()
                }
        return True


def configure_logging(level: str = "INFO") -> None:
    """Configure root and application loggers cleanly."""
    log_level = getattr(logging, level.upper(), logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s | %(levelname)-7s | req=%(request_id)s | %(name)s | %(message)s",
            datefmt="%Y-%m-%dT%H:%M:%S",
        )
    )
    handler.addFilter(SecretMaskingFilter())

    root_logger = logging.getLogger()
    root_logger.handlers.clear()
    root_logger.setLevel(log_level)
    root_logger.addHandler(handler)

    # Keep httpx/httpcore quiet so raw request details do not clutter or risk header leaks
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
