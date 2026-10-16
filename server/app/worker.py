"""Celery worker for long-running jobs: collection imports, card embeddings, deck builds.

Start it with: uv run celery -A app.worker worker --loglevel=info --concurrency=1
(on Windows add --pool=solo). One process keeps us inside Scryfall's and Gemini's rate
limits, because the rate limiters live in process memory.
"""

import asyncio
from collections.abc import Awaitable, Callable
from uuid import UUID

from celery import Celery

from app.agent.service import run_deck_build
from app.collection.importer import embed_collection, run_import
from app.config import get_settings
from app.db import SessionFactory, make_engine, make_session_factory
from app.gemini_client import GeminiNotConfiguredError, GeminiService
from app.observability import setup_tracing
from app.scryfall import ScryfallClient

settings = get_settings()
setup_tracing()

celery_app = Celery("mtg", broker=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    task_acks_late=True,  # ack only after the task finishes...
    task_reject_on_worker_lost=True,  # ...and requeue it if the worker process dies mid-job
    worker_prefetch_multiplier=1,  # long jobs: don't reserve tasks another worker could run
    task_ignore_result=True,  # progress lives in Postgres, not in a Celery result backend
    # No job may run forever and block the single worker. A stuck run is reported
    # as failed by GET /decks/runs/{id} once it's older than its timeout.
    task_soft_time_limit=14 * 60,
    task_time_limit=15 * 60,
)


@celery_app.task(name="collection.import")
def import_collection_task(job_id: str) -> None:
    async def job(sessions: SessionFactory, scryfall: ScryfallClient) -> None:
        collection_id = await run_import(UUID(job_id), sessions, scryfall)
        # Once the cards are stored, embed the new ones for semantic search. This runs
        # after the import is already marked "succeeded", so the user isn't kept waiting.
        if collection_id is not None:
            await embed_collection(collection_id, sessions, _gemini_or_none())

    _run_async(job)


@celery_app.task(name="collection.embed")
def embed_collection_task(collection_id: str) -> None:
    async def job(sessions: SessionFactory, _: ScryfallClient) -> None:
        await embed_collection(int(collection_id), sessions, _gemini_or_none())

    _run_async(job)


@celery_app.task(name="deck.build")
def build_deck_task(run_id: str) -> None:
    async def job(sessions: SessionFactory, scryfall: ScryfallClient) -> None:
        await run_deck_build(UUID(run_id), sessions, gemini=_gemini_or_none(), scryfall=scryfall)

    _run_async(job)


def _gemini_or_none() -> GeminiService | None:
    try:
        return GeminiService.from_settings(settings)
    except GeminiNotConfiguredError:
        return None


def _run_async(job: Callable[[SessionFactory, ScryfallClient], Awaitable[None]]) -> None:
    """Celery tasks are plain (synchronous) functions; asyncio.run gives the async job its
    own event loop. Database connections can't be shared across event loops, so every task
    gets a fresh engine and Scryfall client and closes them at the end."""

    async def main() -> None:
        engine = make_engine(settings.database_url)
        try:
            async with ScryfallClient.build_http_client(settings.scryfall_user_agent) as http:
                await job(make_session_factory(engine), ScryfallClient(http))
        finally:
            await engine.dispose()

    asyncio.run(main())
