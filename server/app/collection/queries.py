"""Read-side queries over a user's collection.

These functions are the single source of truth for "which cards does this user own and
what do they look like". The REST endpoints, the AI agent's tools, and the MCP server all
call them, so a filter behaves the same no matter who asks.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager

from app.db import Card, Collection, CollectionCard

# The five colors, as Scryfall writes them in color_identity.
COLORS = ("W", "U", "B", "R", "G")


class OwnedCard(BaseModel):
    """One printing the user owns, with the card data the UI and the agent need."""

    scryfall_id: UUID
    oracle_id: UUID | None  # shared by every printing of the same card
    name: str
    quantity: int
    mana_cost: str
    cmc: float
    type_line: str
    oracle_text: str
    colors: list[str]
    color_identity: list[str]
    keywords: list[str]
    power: str | None
    toughness: str | None
    rarity: str
    set_code: str
    collector_number: str
    legal_in_commander: bool
    image_url: str | None  # Scryfall's "normal" size image (front face for two-sided cards)
    image_url_small: str | None
    price_usd: str | None
    multiverse_ids: list[int]  # Gatherer ids; the deck view's "AI Analysis" looks cards up by these


class CardFilters(BaseModel):
    """Optional filters for searching a collection. Every filter left empty is ignored."""

    name: str | None = Field(default=None, max_length=200, description="Part of the card name")
    text: str | None = Field(default=None, max_length=200, description="Part of the rules text")
    type_line: str | None = Field(
        default=None,
        max_length=100,
        description="Part of the type line, e.g. 'Creature' or 'Instant'",
    )
    identity_within: list[str] | None = Field(
        default=None,
        description=(
            "Only cards whose color identity fits inside these colors (W/U/B/R/G). "
            "Pass the commander's color identity to get only cards legal in that deck."
        ),
    )
    min_cmc: float | None = Field(default=None, ge=0, le=20)
    max_cmc: float | None = Field(default=None, ge=0, le=20)
    commander_legal: bool = Field(default=False, description="Only cards legal in Commander")


class CollectionSummary(BaseModel):
    id: int
    name: str
    created_at: datetime
    unique_cards: int
    total_cards: int


def owned_card_from_row(card: Card, quantity: int) -> OwnedCard:
    """Build an OwnedCard from a database row. Extra details come from the stored JSON."""
    data: dict[str, Any] = card.data or {}
    images: dict[str, str] = data.get("image_uris") or {}
    prices: dict[str, str | None] = data.get("prices") or {}
    return OwnedCard(
        scryfall_id=card.id,
        oracle_id=card.oracle_id,
        name=card.name,
        quantity=quantity,
        mana_cost=card.mana_cost,
        cmc=card.cmc,
        type_line=card.type_line,
        oracle_text=card.oracle_text,
        colors=card.colors,
        color_identity=card.color_identity,
        keywords=data.get("keywords") or [],
        power=data.get("power"),
        toughness=data.get("toughness"),
        rarity=data.get("rarity", ""),
        set_code=card.set_code,
        collector_number=card.collector_number,
        legal_in_commander=card.legal_in_commander,
        image_url=images.get("normal"),
        image_url_small=images.get("small"),
        price_usd=prices.get("usd"),
        multiverse_ids=data.get("multiverse_ids") or [],
    )


def _filter_conditions(filters: CardFilters) -> list[ColumnElement[bool]]:
    """Translate CardFilters into SQL WHERE conditions."""
    conditions: list[ColumnElement[bool]] = []
    # icontains = case-insensitive "contains". autoescape stops a user's % or _ from
    # acting as SQL wildcards.
    if filters.name:
        conditions.append(Card.name.icontains(filters.name, autoescape=True))
    if filters.text:
        conditions.append(Card.oracle_text.icontains(filters.text, autoescape=True))
    if filters.type_line:
        conditions.append(Card.type_line.icontains(filters.type_line, autoescape=True))
    if filters.identity_within is not None:
        colors = sorted({c.upper() for c in filters.identity_within if c.upper() in COLORS})
        # Postgres "<@" (contained by): the card's identity must be a subset of these colors.
        # An empty list means "colorless only", which is right for a colorless commander.
        conditions.append(Card.color_identity.contained_by(colors))
    if filters.min_cmc is not None:
        conditions.append(Card.cmc >= filters.min_cmc)
    if filters.max_cmc is not None:
        conditions.append(Card.cmc <= filters.max_cmc)
    if filters.commander_legal:
        conditions.append(Card.legal_in_commander.is_(True))
    return conditions


async def search_owned_cards(
    session: AsyncSession,
    collection_id: int,
    filters: CardFilters,
    *,
    limit: int = 100,
    offset: int = 0,
) -> tuple[int, list[OwnedCard]]:
    """Owned cards matching the filters, alphabetical. Returns (total matches, this page)."""
    where = and_(CollectionCard.collection_id == collection_id, *_filter_conditions(filters))

    total = await session.scalar(
        select(func.count()).select_from(CollectionCard).join(CollectionCard.card).where(where)
    )
    rows = await session.scalars(
        select(CollectionCard)
        .join(CollectionCard.card)
        .options(contains_eager(CollectionCard.card))  # reuse the join to load the card
        .where(where)
        .order_by(Card.name, Card.id)  # id breaks ties, so pages never overlap or skip
        .limit(limit)
        .offset(offset)
    )
    return total or 0, [owned_card_from_row(r.card, r.quantity) for r in rows]


async def commander_candidates(session: AsyncSession, collection_id: int) -> list[OwnedCard]:
    """Owned cards that can lead a deck: legendary creatures, plus cards whose text says
    "can be your commander" (some planeswalkers)."""
    is_commander = or_(
        and_(
            Card.type_line.icontains("Legendary", autoescape=True),
            Card.type_line.icontains("Creature", autoescape=True),
        ),
        Card.oracle_text.icontains("can be your commander", autoescape=True),
    )
    rows = await session.scalars(
        select(CollectionCard)
        .join(CollectionCard.card)
        .options(contains_eager(CollectionCard.card))
        .where(CollectionCard.collection_id == collection_id, is_commander)
        .where(Card.legal_in_commander.is_(True))
        .order_by(Card.name, Card.id)
    )
    return _one_per_card([owned_card_from_row(r.card, r.quantity) for r in rows])


async def all_owned_cards(session: AsyncSession, collection_id: int) -> list[OwnedCard]:
    """Every owned printing. Used to build the agent's in-memory view of the collection."""
    rows = await session.scalars(
        select(CollectionCard)
        .join(CollectionCard.card)
        .options(contains_eager(CollectionCard.card))
        .where(CollectionCard.collection_id == collection_id)
        .order_by(Card.name, Card.id)
    )
    return [owned_card_from_row(r.card, r.quantity) for r in rows]


async def list_collections(session: AsyncSession) -> list[CollectionSummary]:
    """All collections, newest first, with how many cards each holds."""
    rows = await session.execute(
        select(
            Collection,
            func.count(CollectionCard.card_id),
            func.coalesce(func.sum(CollectionCard.quantity), 0),
        )
        .outerjoin(CollectionCard, CollectionCard.collection_id == Collection.id)
        .group_by(Collection.id)
        .order_by(Collection.created_at.desc(), Collection.id.desc())
    )
    return [
        CollectionSummary(
            id=c.id, name=c.name, created_at=c.created_at, unique_cards=n, total_cards=total
        )
        for c, n, total in rows
    ]


async def collection_exists(session: AsyncSession, collection_id: int) -> bool:
    return await session.get(Collection, collection_id) is not None


def _one_per_card(cards: list[OwnedCard]) -> list[OwnedCard]:
    """Collapse several printings of the same card (same oracle_id) into one entry."""
    seen: set[UUID | str] = set()
    unique: list[OwnedCard] = []
    for card in cards:
        key = card.oracle_id or card.name.casefold()
        if key not in seen:
            seen.add(key)
            unique.append(card)
    return unique
