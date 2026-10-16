"""Database models and engine setup (SQLAlchemy 2.0, async, asyncpg driver)."""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from pgvector.sqlalchemy import VECTOR
from sqlalchemy import ForeignKey, Index, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

type SessionFactory = async_sessionmaker[AsyncSession]


class Base(DeclarativeBase):
    pass


class Card(Base):
    """A Scryfall printing. Doubles as a persistent cache so re-imports skip Scryfall."""

    __tablename__ = "cards"

    id: Mapped[UUID] = mapped_column(primary_key=True)  # Scryfall card id
    oracle_id: Mapped[UUID | None]
    name: Mapped[str] = mapped_column(String(200))
    set_code: Mapped[str] = mapped_column(String(8))
    collector_number: Mapped[str] = mapped_column(String(16))
    mana_cost: Mapped[str] = mapped_column(String(100))
    cmc: Mapped[float]
    type_line: Mapped[str] = mapped_column(String(200))
    oracle_text: Mapped[str] = mapped_column(Text)
    colors: Mapped[list[str]] = mapped_column(ARRAY(String(1)))
    color_identity: Mapped[list[str]] = mapped_column(ARRAY(String(1)))
    legal_in_commander: Mapped[bool]
    # Full mapped Scryfall record, so we can rebuild a ScryfallCard without refetching.
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (Index("ix_cards_set_number", "set_code", "collector_number"),)


# Case-insensitive name lookups (the importer matches CSV names against stored cards).
Index("ix_cards_lower_name", func.lower(Card.name))


class CardEmbedding(Base):
    """A card's meaning as a vector (a list of numbers), used for semantic search.

    Keyed by oracle_id, which every printing of a card shares, so each card is embedded
    only once no matter how many printings or collections contain it.
    """

    __tablename__ = "card_embeddings"

    oracle_id: Mapped[UUID] = mapped_column(primary_key=True)
    model: Mapped[str] = mapped_column(String(64))  # which embedding model made the vector
    # The vector size must match settings.embedding_dimensions.
    embedding: Mapped[list[float]] = mapped_column(VECTOR(768))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        # HNSW is an approximate nearest-neighbour index: it finds the closest vectors
        # quickly without comparing the query against every row.
        Index(
            "ix_card_embeddings_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CollectionCard(Base):
    """How many copies of a card a collection owns. The composite key de-duplicates rows."""

    __tablename__ = "collection_cards"

    collection_id: Mapped[int] = mapped_column(
        ForeignKey("collections.id", ondelete="CASCADE"), primary_key=True
    )
    card_id: Mapped[UUID] = mapped_column(ForeignKey("cards.id"), primary_key=True)
    quantity: Mapped[int]

    card: Mapped[Card] = relationship(lazy="joined")


class ImportJob(Base):
    """A background CSV import. The API creates it; the worker fills in progress and results."""

    __tablename__ = "import_jobs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|running|...
    source_format: Mapped[str] = mapped_column(String(16))
    rows: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)  # validated rows to import
    row_errors: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    not_found: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    batches_done: Mapped[int] = mapped_column(default=0)
    batches_total: Mapped[int] = mapped_column(default=0)
    unique_cards: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[datetime | None]


class AgentRun(Base):
    """One run of the deck-building agent. The API creates it; the worker fills it in.

    `trace` grows step by step while the agent works (every model call and tool call), so
    the UI can show what the agent is doing in near real time.
    """

    __tablename__ = "agent_runs"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"))
    # Set when this run revises an earlier one (the user's accept/reject feedback).
    parent_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued|running|...
    engine: Mapped[str] = mapped_column(String(32))  # which agent implementation ran
    model: Mapped[str] = mapped_column(String(64))  # which LLM it used
    request: Mapped[dict[str, Any]] = mapped_column(JSONB)  # the DeckRequest
    trace: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)  # the DeckRecommendation
    error: Mapped[str | None] = mapped_column(Text)
    model_calls: Mapped[int] = mapped_column(default=0)
    input_tokens: Mapped[int] = mapped_column(default=0)
    output_tokens: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[datetime | None]


class Deck(Base):
    """A deck the user approved and saved."""

    __tablename__ = "decks"

    id: Mapped[int] = mapped_column(primary_key=True)
    collection_id: Mapped[int] = mapped_column(ForeignKey("collections.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(100))
    commander: Mapped[str] = mapped_column(String(200))
    # [{"name", "role", "reason"}] for every non-basic card, and {"Forest": 12, ...}.
    cards: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    basic_lands: Mapped[dict[str, int]] = mapped_column(JSONB, default=dict)
    source_run_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


def make_engine(url: str) -> AsyncEngine:
    # pool_pre_ping drops dead connections (e.g. after a database restart) before use.
    return create_async_engine(url, pool_pre_ping=True)


def make_session_factory(engine: AsyncEngine) -> SessionFactory:
    # expire_on_commit=False: objects stay readable after commit without another query.
    return async_sessionmaker(engine, expire_on_commit=False)


# Full-text search over card name + rules text. Queries must use this exact expression
# (see app/collection/synergy.py) for Postgres to use the index.
CARD_TSVECTOR_SQL = "to_tsvector('english', name || ' ' || oracle_text)"


async def create_schema(engine: AsyncEngine) -> None:
    """Create the extension, any missing tables, and extra indexes. Safe to run every start.

    create_all only creates tables that don't exist yet; it never changes existing ones.
    Changing an existing table's columns would need a migration tool (Alembic).
    """
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(
            text(
                f"CREATE INDEX IF NOT EXISTS ix_cards_fts ON cards USING gin ({CARD_TSVECTOR_SQL})"
            )
        )
