import asyncio
import os
from collections.abc import Iterator
from contextlib import contextmanager

# Tests must never depend on the developer's real .env values. These run before the app
# is imported, and real environment variables override .env.
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://mtg:mtg@localhost:5432/mtg_test"
)
TEST_API_KEY = "test-api-key"
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["GEMINI_MODEL"] = "test-model"
os.environ["GEMINI_API_KEY"] = ""  # never call the real Gemini API from tests
os.environ["API_KEY"] = TEST_API_KEY
os.environ["TASK_RUNNER"] = "inline"
os.environ["AGENT_ENGINE"] = "manual"

import httpx  # noqa: E402  (imports below need the environment set first)
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, create_schema, make_engine  # noqa: E402
from app.main import app  # noqa: E402
from app.scryfall import ScryfallClient  # noqa: E402
from tests.fakes import FakeScryfall  # noqa: E402


@pytest.fixture(autouse=True)
def _fresh_quota_memory() -> Iterator[None]:
    """Each test starts with no model marked as out of quota."""
    from app.gemini_client import QUOTA

    QUOTA.reset()
    yield
    QUOTA.reset()


async def _reset_schema() -> None:
    engine = make_engine(TEST_DATABASE_URL)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        await create_schema(engine)
    finally:
        await engine.dispose()


def reset_db() -> None:
    """Start every database test from empty tables (skips if Postgres isn't running)."""
    try:
        asyncio.run(_reset_schema())
    except OSError as exc:
        pytest.skip(f"Postgres not reachable at {TEST_DATABASE_URL}: {exc}")


async def _no_sleep(_: float) -> None:
    return None


@contextmanager
def running_app(known: dict[str, dict]) -> Iterator[tuple[TestClient, FakeScryfall]]:
    """The real app (startup included) with Scryfall faked and the API key header set."""
    fake = FakeScryfall(known)
    with TestClient(app, headers={"X-API-Key": TEST_API_KEY}) as client:
        transport = httpx.MockTransport(fake.handler)
        http = httpx.AsyncClient(base_url="https://api.test", transport=transport)
        app.state.scryfall = ScryfallClient(http, sleep=_no_sleep)
        try:
            yield client, fake
        finally:
            app.state.agent_model = None
            app.state.gemini = None
