"""Card embeddings: turning each card's text into a vector for search by meaning.

An embedding model reads text and returns a list of numbers (here 768 of them). Texts
with similar meaning get vectors that point in similar directions. So "create a 1/1
white Soldier creature token" ends up close to "go wide with tokens", even though they
share almost no words. That's what lets semantic search find synergies keyword search misses.

Cards are embedded once per oracle_id (shared by all printings) and stored in Postgres
with pgvector, right next to the rest of the data.
"""

import logging

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import distinct_on, insert

from app.db import Card, CardEmbedding, CollectionCard, SessionFactory
from app.gemini_client import GeminiService

logger = logging.getLogger(__name__)

CHUNK = 100  # cards embedded and saved per round


def card_document_text(name: str, type_line: str, oracle_text: str) -> str:
    """How a card is described to the embedding model ("document" side of retrieval).

    gemini-embedding-2 expects retrieval documents as "title: ... | text: ...".
    """
    return f"title: {name} | text: {type_line}. {oracle_text}"


def search_query_text(query: str) -> str:
    """How a search is described to the embedding model ("query" side of retrieval)."""
    return f"task: search result | query: {query}"


async def embed_missing_cards(
    sessions: SessionFactory, gemini: GeminiService, *, collection_id: int | None = None
) -> int:
    """Embed every card (optionally only those in one collection) that has no vector yet.

    Returns how many cards were embedded. Safe to run repeatedly: cards that already have
    a vector from the current model are skipped, so an interrupted run just continues.
    """
    already_done = exists().where(
        CardEmbedding.oracle_id == Card.oracle_id,
        CardEmbedding.model == gemini.embedding_model,
    )
    query = (
        select(Card.oracle_id, Card.name, Card.type_line, Card.oracle_text)
        .ext(distinct_on(Card.oracle_id))  # one row per card, not per printing
        .where(Card.oracle_id.is_not(None), ~already_done)
        .order_by(Card.oracle_id)
    )
    if collection_id is not None:
        query = query.join(CollectionCard, CollectionCard.card_id == Card.id).where(
            CollectionCard.collection_id == collection_id
        )

    async with sessions() as session:
        rows = (await session.execute(query)).all()
    if not rows:
        return 0
    logger.info("Embedding %d cards with %s", len(rows), gemini.embedding_model)

    done = 0
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start : start + CHUNK]
        texts = [card_document_text(r.name, r.type_line, r.oracle_text) for r in chunk]
        vectors = await gemini.embed(texts)  # raises GeminiQuotaError if the quota runs out
        values = [
            {"oracle_id": r.oracle_id, "model": gemini.embedding_model, "embedding": v}
            for r, v in zip(chunk, vectors, strict=True)
        ]
        # Save each chunk as soon as it's ready, so progress isn't lost if a later chunk fails.
        async with sessions() as session:
            stmt = insert(CardEmbedding).values(values)
            stmt = stmt.on_conflict_do_update(
                index_elements=[CardEmbedding.oracle_id],
                set_={"embedding": stmt.excluded.embedding, "model": stmt.excluded.model},
            )
            await session.execute(stmt)
            await session.commit()
        done += len(chunk)
    return done
