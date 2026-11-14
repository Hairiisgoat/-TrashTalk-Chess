"""FastAPI application entry point, shared httpx lifecycle, CORS, and request tracing."""

from contextlib import asynccontextmanager
import logging
from pathlib import Path
import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import httpx

from app.api.v1.router import router as v1_router
from app.core.config import get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging, request_id_ctx

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage shared httpx.AsyncClient across application startup and shutdown."""
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)
    timeout = httpx.Timeout(settings.LLM_REQUEST_TIMEOUT_SEC)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        app.state.http_client = client
        logger.info(
            "TrashTalk Chess backend started env=%s timeout=%.2fs",
            settings.APP_ENV,
            settings.LLM_REQUEST_TIMEOUT_SEC,
        )
        yield
    logger.info("TrashTalk Chess backend shutting down")


def create_app() -> FastAPI:
    """Instantiate and configure the FastAPI application."""
    settings = get_settings()

    application = FastAPI(
        title="棋逢嘴手 · TrashTalk Chess API",
        version=settings.APP_VERSION,
        description="Stateless Hybrid AI chess/xiangqi decision & persona banter gateway",
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ALLOW_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.middleware("http")
    async def request_context_middleware(request: Request, call_next) -> Response:
        incoming_id = (request.headers.get("X-Request-ID") or "").strip()
        request_id = incoming_id[:64] if incoming_id else f"req_{uuid.uuid4().hex[:12]}"
        request.state.request_id = request_id
        token = request_id_ctx.set(request_id)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "HTTP %s %s status=%s latency_ms=%d",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response

    register_exception_handlers(application)
    application.include_router(v1_router)

    static_dir = Path(__file__).resolve().parent.parent / "static"
    if static_dir.is_dir():
        application.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    return application


app = create_app()
