"""Semantic + keyword (hybrid) search over a collection, with a fake embedding model.

The fake turns text into a "bag of words" vector, so texts sharing words point the same
way. That's enough to exercise the real pgvector storage, the cosine-distance query, and
the rank fusion without calling Gemini.
"""

import math
import re
import zlib
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.collection.synergy import keyword_query
from app.main import app
from tests.conftest import reset_db, running_app
from tests.deck_data import COMMANDER, CSV, KNOWN, OFF_COLOR


class FakeEmbedder:
    embedding_model = "fake-embed"
    embedding_dimensions = 768

    def __init__(self) -> None:
        self.calls = 0

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls += 1
        vectors = []
        for text in texts:
            vector = [0.0] * 768
            for word in re.findall(r"[a-z]{3,}", text.lower()):
                vector[zlib.crc32(word.encode()) % 768] += 1.0
            norm = math.sqrt(sum(v * v for v in vector)) or 1.0
            vectors.append([v / norm for v in vector])
        return vectors


@pytest.fixture
def api() -> Iterator[tuple[TestClient, int]]:
    reset_db()
    with running_app(dict(KNOWN)) as (client, _fake):
        collection_id = client.post(
            "/collections/import", files={"file": ("c.csv", CSV, "text/csv")}
        ).json()["collection_id"]
        yield client, collection_id


def test_keyword_query_is_sanitized() -> None:
    assert (
        keyword_query("Create a 1/1 Elf token; DROP TABLE cards!")
        == "create | elf | token | drop | table"
    )
    assert keyword_query("the of a") is None


def test_keyword_only_without_embeddings(api: tuple[TestClient, int]) -> None:
    client, collection_id = api
    result = client.get(f"/collections/{collection_id}/synergy?commander={COMMANDER}").json()
    assert result["semantic"] is False
    names = [c["card"]["name"] for c in result["cards"]]
    assert names and all(n != COMMANDER for n in names)
    assert OFF_COLOR not in names  # outside the commander's colors


def test_hybrid_search_uses_pgvector(api: tuple[TestClient, int]) -> None:
    client, collection_id = api
    embedder = FakeEmbedder()
    app.state.gemini = embedder

    assert client.get(f"/collections/{collection_id}/embeddings").json()["coverage"] == 0
    assert client.post(f"/collections/{collection_id}/embeddings").status_code == 202
    assert client.get(f"/collections/{collection_id}/embeddings").json()["coverage"] == 1.0

    result = client.get(
        f"/collections/{collection_id}/synergy",
        params={"commander": COMMANDER, "theme": "elves entering with counters"},
    ).json()
    assert result["semantic"] is True
    top = result["cards"][0]
    assert top["card"]["name"].startswith("Elf Scout")
    assert set(top["matched_by"]) == {"meaning", "keywords"}
    # Re-running the embedding job finds nothing new to embed (it's idempotent).
    calls = embedder.calls
    client.post(f"/collections/{collection_id}/embeddings")
    assert embedder.calls == calls
