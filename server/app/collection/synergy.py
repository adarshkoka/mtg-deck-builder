"""Find owned cards that fit a theme or a commander: hybrid retrieval.

Two searches run over the same set of candidate cards (owned, legal in Commander, inside
the commander's colors), and their rankings are merged:

1. Semantic search (pgvector): the query is embedded and compared with every card's
   stored vector by cosine distance. This finds cards with the same MEANING, even when
   they use different words.
2. Keyword search (Postgres full-text search): ranks cards by how many of the query's
   important words they contain. This catches exact mechanics ("Treasure", "Proliferate")
   that a semantic search can rank too low.

The rankings are merged with Reciprocal Rank Fusion (RRF): each card scores
1 / (60 + its position) in every list it appears in. Cards near the top of BOTH lists
win. RRF only needs positions, not raw scores, so the two very different scoring
scales never have to be compared directly.

If the cards have no embeddings yet, or the embedding API fails (for example, quota),
the search quietly falls back to keyword-only results.
"""

import logging
import re
from collections import OrderedDict

from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.collection.queries import OwnedCard, owned_card_from_row
from app.db import Card, CardEmbedding, CollectionCard
from app.embeddings import search_query_text
from app.gemini_client import GeminiError, GeminiService

logger = logging.getLogger(__name__)

# The same search (e.g. a commander's text, which every build of that commander uses)
# embeds to the same vector, so remember recent ones instead of spending quota again.
MAX_CACHED_QUERIES = 256
_QUERY_VECTORS: OrderedDict[tuple[str, str], list[float]] = OrderedDict()

RRF_K = 60  # the standard RRF constant: dampens the advantage of the very top positions
CANDIDATES_PER_METHOD = 60  # how deep each method looks before fusing

# Common English and game words that say nothing about a card's theme.
_STOPWORDS = {
    "the", "and", "you", "your", "for", "with", "that", "this", "each", "from", "into",
    "onto", "its", "may", "card", "cards", "target", "turn", "until", "end", "control",
    "controls", "player", "players", "whenever", "when", "then", "have", "has", "can",
    "are", "one", "two", "three", "put", "get", "gets", "creature", "creatures", "other",
    "also", "any", "all", "only", "under", "where", "equal", "number", "time", "times",
}  # fmt: skip

# The same expression the full-text index was built on (see CARD_TSVECTOR_SQL in db.py).
_TSVECTOR = literal_column("to_tsvector('english', cards.name || ' ' || cards.oracle_text)")


class SynergyCard(BaseModel):
    card: OwnedCard
    score: float  # fused RRF score: higher is a better match
    matched_by: list[str]  # "meaning", "keywords", or both


class SynergyResult(BaseModel):
    query: str
    semantic: bool  # False when only keyword search could run
    cards: list[SynergyCard]


def keyword_query(text: str, max_terms: int = 30) -> str | None:
    """Turn free text into a Postgres OR-query of its meaningful words: "a | b | c".

    Only plain lowercase letters survive, so nothing from the user (or from card text)
    can inject full-text-search syntax.
    """
    words: list[str] = []
    for word in re.findall(r"[a-z]{3,}", text.casefold()):
        if word not in _STOPWORDS and word not in words:
            words.append(word)
    return " | ".join(words[:max_terms]) or None


async def embed_query(gemini: GeminiService | None, query: str) -> list[float] | None:
    """The query's vector, or None if semantic search isn't available right now.

    Call this BEFORE opening a database session: the embedding API can take seconds (rate
    limiting, retries), and a session holds a pooled connection the whole time.
    """
    if gemini is None:
        return None
    key = (gemini.embedding_model, query)
    if (cached := _QUERY_VECTORS.get(key)) is not None:
        _QUERY_VECTORS.move_to_end(key)  # recently used: keep it longer
        return cached
    try:
        [vector] = await gemini.embed([search_query_text(query)])
        _QUERY_VECTORS[key] = vector
        if len(_QUERY_VECTORS) > MAX_CACHED_QUERIES:
            _QUERY_VECTORS.popitem(last=False)  # drop the least recently used
        return vector
    except GeminiError as exc:
        logger.warning("Semantic search unavailable, using keywords only: %s", exc)
        return None


async def find_synergy(
    session: AsyncSession,
    collection_id: int,
    query: str,
    *,
    identity_within: list[str],
    query_vector: list[float] | None,
    embedding_model: str | None,
    limit: int = 20,
    exclude_names: set[str] | None = None,
) -> SynergyResult:
    exclude = {n.casefold() for n in exclude_names or set()}
    base: list[ColumnElement[bool]] = [
        CollectionCard.collection_id == collection_id,
        Card.legal_in_commander.is_(True),
        Card.color_identity.contained_by(sorted(identity_within)),
        ~Card.type_line.icontains("Basic Land", autoescape=True),
    ]

    # --- 1. Keyword ranking ----------------------------------------------------------
    keyword_rank: list[tuple[CollectionCard, Card]] = []
    if (ts_terms := keyword_query(query)) is not None:
        ts_query = func.to_tsquery("english", ts_terms)
        rank = func.ts_rank_cd(_TSVECTOR, ts_query)
        rows = await session.execute(
            select(CollectionCard, Card)
            .join(Card, CollectionCard.card_id == Card.id)
            .where(and_(*base), _TSVECTOR.op("@@")(ts_query))
            .order_by(rank.desc(), Card.name)
            .limit(CANDIDATES_PER_METHOD)
        )
        keyword_rank = [(cc, card) for cc, card in rows]

    # --- 2. Semantic ranking ---------------------------------------------------------
    semantic_rank: list[tuple[CollectionCard, Card]] = []
    semantic = False
    if query_vector is not None and embedding_model is not None:
        # The embeddings table holds every card from every collection. An approximate
        # (HNSW) index search first takes the nearest vectors overall and only THEN
        # applies our filters, so a small collection could get almost nothing back.
        # Iterative scanning keeps searching until enough rows pass the filters.
        # (Setting an unknown "hnsw.*" option is harmless on older pgvector versions.)
        await session.execute(text("SET LOCAL hnsw.iterative_scan = relaxed_order"))
        distance = CardEmbedding.embedding.cosine_distance(query_vector)
        rows = await session.execute(
            select(CollectionCard, Card)
            .join(Card, CollectionCard.card_id == Card.id)
            .join(CardEmbedding, CardEmbedding.oracle_id == Card.oracle_id)
            .where(and_(*base), CardEmbedding.model == embedding_model)
            .order_by(distance)
            .limit(CANDIDATES_PER_METHOD)
        )
        semantic_rank = [(cc, card) for cc, card in rows]
        semantic = bool(semantic_rank)

    # --- 3. Reciprocal Rank Fusion ---------------------------------------------------
    scores: dict[str, float] = {}
    matched: dict[str, list[str]] = {}
    cards: dict[str, OwnedCard] = {}
    for label, ranking in (("meaning", semantic_rank), ("keywords", keyword_rank)):
        position = 0
        for owned_row, card in ranking:
            key = str(card.oracle_id or card.name)
            if card.name.casefold() in exclude:
                continue
            if label in matched.get(key, []):
                continue  # a second printing of the same card: count it once per method
            position += 1
            scores[key] = scores.get(key, 0.0) + 1.0 / (RRF_K + position)
            matched.setdefault(key, []).append(label)
            cards.setdefault(key, owned_card_from_row(card, owned_row.quantity))

    best = sorted(scores, key=lambda k: scores[k], reverse=True)[:limit]
    return SynergyResult(
        query=query,
        semantic=semantic,
        cards=[
            SynergyCard(card=cards[k], score=round(scores[k], 5), matched_by=matched[k])
            for k in best
        ],
    )


async def embedding_coverage(session: AsyncSession, collection_id: int, model: str) -> float:
    """Fraction (0-1) of a collection's cards that already have an embedding."""
    total = await session.scalar(
        select(func.count(func.distinct(Card.oracle_id)))
        .select_from(CollectionCard)
        .join(Card, CollectionCard.card_id == Card.id)
        .where(CollectionCard.collection_id == collection_id)
    )
    embedded = await session.scalar(
        select(func.count(func.distinct(Card.oracle_id)))
        .select_from(CollectionCard)
        .join(Card, CollectionCard.card_id == Card.id)
        .join(CardEmbedding, CardEmbedding.oracle_id == Card.oracle_id)
        .where(CollectionCard.collection_id == collection_id, CardEmbedding.model == model)
    )
    return (embedded or 0) / total if total else 0.0
