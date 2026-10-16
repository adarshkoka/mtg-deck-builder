"""Data shapes for deck building: what the user asks for and what the agent returns.

These Pydantic models are the contract between every part of the feature: the REST API
validates requests with them, the agent's final answer is parsed into them, and the
database stores them as JSON.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, Field

# The job each card does in the deck. The agent must label every pick with one of these,
# which lets the UI group recommendations and lets code check the deck is balanced.
type Role = Literal[
    "ramp",  # makes extra mana (mana rocks, land search)
    "card_draw",  # draws or otherwise gains extra cards
    "removal",  # deals with one opposing threat
    "board_wipe",  # deals with many threats at once
    "synergy",  # works with the commander's strategy
    "win_condition",  # how the deck actually wins
    "protection",  # protects the commander or key cards
    "land",  # non-basic lands
    "utility",  # anything else useful
]

ROLES: tuple[Role, ...] = (
    "ramp",
    "card_draw",
    "removal",
    "board_wipe",
    "synergy",
    "win_condition",
    "protection",
    "land",
    "utility",
)


class CardPick(BaseModel):
    """One recommended card and why it belongs in the deck."""

    name: str = Field(max_length=200, description="Exact card name from the collection")
    role: Role
    reason: str = Field(max_length=400, description="One or two sentences on why it fits")


class SuggestedBuy(BaseModel):
    """A card the user doesn't own but might want. Never part of the deck itself."""

    name: str = Field(max_length=200)
    reason: str = Field(max_length=400)
    price_usd: str | None = None
    scryfall_uri: str | None = None


class DeckRecommendation(BaseModel):
    """The agent's finished deck: the commander, 99 other cards, and the reasoning."""

    commander: str
    picks: list[CardPick]  # every non-basic card, one copy each
    basic_lands: dict[str, int]  # e.g. {"Forest": 12, "Island": 10}; filled in by code
    suggested_buys: list[SuggestedBuy] = []
    summary: str = Field(max_length=2000, description="The deck's game plan in a few sentences")


# A card name inside a request: bounded so stored requests stay small.
CardName = Annotated[str, Field(min_length=1, max_length=200)]


class DeckRequest(BaseModel):
    """What the user asked for. Revision runs also carry the earlier result and feedback."""

    collection_id: int
    commander: str = Field(min_length=1, max_length=200)
    must_include: list[CardName] = Field(default=[], max_length=30)
    notes: str | None = Field(
        default=None,
        max_length=500,
        description="Optional strategy wishes, e.g. 'go wide with tokens'",
    )
    # --- set only when revising an earlier recommendation ---
    previous: DeckRecommendation | None = None
    accepted: list[CardName] = Field(default=[], description="Picks the user approved: keep them")
    rejected: list[CardName] = Field(
        default=[], description="Picks the user rejected: replace them"
    )
    feedback: str | None = Field(default=None, max_length=1000)
