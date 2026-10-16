"""Shared FastAPI dependencies: API-key authentication and the long-lived clients.

Long-lived objects (the database session factory, the Scryfall and Gemini clients) are
created once at startup in main.py's lifespan and stored on `app.state`. Endpoints ask
for them through these dependencies instead of creating their own, and tests can swap
in fakes by replacing the objects on `app.state`.
"""

import hmac
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Security
from fastapi.concurrency import run_in_threadpool
from fastapi.security import APIKeyHeader

from app.config import get_settings
from app.db import SessionFactory
from app.gemini_client import GeminiService
from app.scryfall import ScryfallClient

# --- API-key authentication -----------------------------------------------------------
# Every protected route depends on `require_api_key`. The client sends the key in the
# `X-API-Key` header; we compare it to the API_KEY setting.

# Declaring the header this way also documents it on the /docs page ("Authorize" button).
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(provided: Annotated[str | None, Security(_api_key_header)]) -> None:
    expected = get_settings().api_key
    if expected is None:
        # Fail closed: a server without a configured key rejects everything rather than
        # silently running with no authentication.
        raise HTTPException(503, "Server API key is not configured")
    # compare_digest takes the same time whether the first or last character differs, so
    # an attacker can't guess the key one character at a time by measuring response times.
    if provided is None or not hmac.compare_digest(
        provided.encode(), expected.get_secret_value().encode()
    ):
        raise HTTPException(
            401, "Missing or invalid API key", headers={"WWW-Authenticate": "ApiKey"}
        )


# Add to a router or endpoint: dependencies=[ApiKeyRequired]
ApiKeyRequired = Depends(require_api_key)


# --- Shared clients ---------------------------------------------------------------------


def get_sessions(request: Request) -> SessionFactory:
    return request.app.state.sessions


def get_scryfall(request: Request) -> ScryfallClient:
    return request.app.state.scryfall


def get_gemini(request: Request) -> GeminiService:
    gemini: GeminiService | None = request.app.state.gemini
    if gemini is None:
        raise HTTPException(503, "AI features are unavailable: GEMINI_API_KEY is not set")
    return gemini


Sessions = Annotated[SessionFactory, Depends(get_sessions)]
Scryfall = Annotated[ScryfallClient, Depends(get_scryfall)]
Gemini = Annotated[GeminiService, Depends(get_gemini)]


async def send_celery_task(task_name: str, *args: str) -> None:
    """Put a task on the Redis queue for the Celery worker.

    Only small identifiers travel through the queue; the real data waits in Postgres.
    send_task is a blocking network call, so it runs in a worker thread to keep the
    event loop free.
    """
    from app.worker import celery_app  # imported lazily: only needed when Celery is in use

    await run_in_threadpool(celery_app.send_task, task_name, args=list(args))
