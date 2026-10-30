"""The starting pool: candidate cards gathered by plain code before the AI is called.

Without this, the agent spends most of its model calls searching ("find ramp", "find
removal", ...), and every call re-sends the whole conversation, so the token count grows
with each search. Running those standard searches ourselves (no model involved, just
database queries) and handing the model one compact list lets it pick a deck in one or
two calls instead of ten. The search tools stay available for anything the pool misses.

The LangGraph workflow uses the same pool, so both engines see the same candidates.
"""

import asyncio
from collections.abc import Iterable

from app.agent.tools import (
    CardSummary,
    FindSynergyArgs,
    SearchCollectionArgs,
    ToolContext,
    find_synergy_cards,
    search_collection,
)

FILLER = "utility"  # the role label for "everything else usable"
FILLER_PAGES = 3  # how many pages (40 cards each) of the whole pool to scan for fillers

# The collection searches that find candidates for each role.
ROLE_SEARCHES: dict[str, list[SearchCollectionArgs]] = {
    "ramp": [
        SearchCollectionArgs(text="add {", type_line="Artifact", limit=30),
        SearchCollectionArgs(text="search your library for a basic land", limit=20),
        SearchCollectionArgs(text="add {", type_line="Creature", limit=20),
    ],
    "card_draw": [SearchCollectionArgs(text="draw", limit=30)],
    "removal": [
        SearchCollectionArgs(text="destroy target", limit=20),
        SearchCollectionArgs(text="exile target", limit=20),
        SearchCollectionArgs(text="counter target", limit=15),
        SearchCollectionArgs(text="damage to any target", limit=15),
        SearchCollectionArgs(text="return target", limit=15),
    ],
    "board_wipe": [SearchCollectionArgs(text="destroy all", limit=15)],
    "land": [SearchCollectionArgs(type_line="Land", limit=30)],
}

POOL_LINE_TEXT = 90  # characters of rules text per card in the rendered pool


async def gather_pool(ctx: ToolContext, *, synergy_limit: int = 30) -> dict[str, list[CardSummary]]:
    """Run every role search plus a synergy search at once; return candidates by role."""

    async def run_role(role: str) -> tuple[str, list[CardSummary]]:
        results = await asyncio.gather(
            *(search_collection(ctx, args) for args in ROLE_SEARCHES[role])
        )
        return role, _unique(card for result in results for card in result.cards)

    async def run_synergy() -> tuple[str, list[CardSummary]]:
        # The commander's own text is the best description of what the deck wants.
        theme = f"{ctx.commander.type_line}. {ctx.commander.oracle_text}"[:300]
        found = await find_synergy_cards(ctx, FindSynergyArgs(theme=theme, limit=synergy_limit))
        return "synergy", found.cards

    async def run_filler() -> tuple[str, list[CardSummary]]:
        cards: list[CardSummary] = []
        offset: int | None = 0
        for _ in range(FILLER_PAGES):
            if offset is None:
                break
            page = await search_collection(ctx, SearchCollectionArgs(limit=40, offset=offset))
            cards += page.cards
            offset = page.next_offset
        return FILLER, cards

    pairs = await asyncio.gather(
        *(run_role(role) for role in ROLE_SEARCHES), run_synergy(), run_filler()
    )
    return dict(pairs)


def render_pool(pool: dict[str, list[CardSummary]], *, max_cards: int = 180) -> str:
    """The pool as compact text: one line per card, each card listed once.

    "Name | cost | type | short text" uses far fewer tokens than the same data as JSON.
    """
    seen: set[str] = set()
    sections: list[str] = []
    total = 0
    for role, cards in pool.items():
        lines: list[str] = []
        for card in cards:
            if card.name in seen or total >= max_cards:
                continue
            seen.add(card.name)
            total += 1
            lines.append(f"- {card_line(card)}")
        if lines:
            sections.append(f"{role.upper()} ({len(lines)}):\n" + "\n".join(lines))
    return "\n\n".join(sections)


def card_line(card: CardSummary, text_chars: int = POOL_LINE_TEXT) -> str:
    text = " ".join(card.text.split())  # rules text on one line
    if len(text) > text_chars:
        text = text[: text_chars - 1] + "…"
    return f"{card.name} | {card.mana_cost or '-'} | {card.type_line} | {text}"


def _unique(cards: Iterable[CardSummary]) -> list[CardSummary]:
    unique: dict[str, CardSummary] = {}
    for card in cards:
        unique.setdefault(card.name, card)
    return list(unique.values())
