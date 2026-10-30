"""The tools the deck-building agent can call.

A "tool" is a normal async Python function plus a description the model reads. The model
never runs code itself: it replies "please call search_collection with these arguments",
our loop runs the function, and the result is sent back to the model as data.

Every tool here follows the same contract, so it is predictable for the model and for
the other callers (REST API, MCP server):
- inputs are a Pydantic model: arguments are validated before the function runs, and the
  JSON schema the model sees is generated from the same model
- outputs are a Pydantic model: always the same shape, compact enough to keep prompts small
- errors become a normal result ({"error": "..."}) the model can read and recover from,
  instead of crashing the run
"""

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.agent.models import CardPick, DeckRecommendation, DeckRequest, SuggestedBuy
from app.agent.rules import (
    BASIC_LANDS,
    CollectionIndex,
    DeckCheck,
    DeckStats,
    card_categories,
    check_deck,
    deck_stats,
    distribute_basics,
)
from app.collection.queries import CardFilters, OwnedCard, search_owned_cards
from app.collection.synergy import embed_query, find_synergy
from app.db import SessionFactory
from app.gemini_client import GeminiService
from app.scryfall import ScryfallClient, ScryfallError

MAX_RESULT_CHARS = 15_000  # a single tool result never adds more than this to the prompt
SHORT_TEXT_CHARS = 120  # rules text is trimmed to this in search results


@dataclass
class ToolContext:
    """Everything a tool needs for one agent run. Built once per run."""

    sessions: SessionFactory
    request: DeckRequest
    commander: OwnedCard
    index: CollectionIndex  # in-memory view of the collection, for fast name lookups
    gemini: GeminiService | None = None  # used by semantic search (query embeddings)
    scryfall: ScryfallClient | None = None  # used by purchase suggestions
    # Cards found by suggest_purchases this run, so submit_deck can attach prices/links.
    purchase_candidates: dict[str, SuggestedBuy] = field(default_factory=dict)
    # Set by submit_deck once a deck passes every check. The loop stops when this is set.
    final: DeckRecommendation | None = None
    submit_attempts: int = 0


type Handler = Callable[[ToolContext, Any], Awaitable[BaseModel]]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    args_model: type[BaseModel]
    handler: Handler

    def parameters_schema(self) -> dict[str, Any]:
        """The JSON schema of the arguments, in the plain form LLM APIs accept."""
        return inline_schema(self.args_model.model_json_schema())


class ToolArgs(BaseModel):
    """Base for every tool's arguments. Unknown argument names are rejected (with an error
    the model reads) instead of silently ignored, so a mistake like `names=[...]` on a tool
    that takes `name` doesn't quietly run the wrong search and waste a turn."""

    model_config = ConfigDict(extra="forbid")


# --- Shared result shapes ------------------------------------------------------------


class CardSummary(BaseModel):
    """A compact card description: enough to choose cards without bloating the prompt."""

    name: str
    mana_cost: str
    cmc: float
    type_line: str
    text: str
    tags: list[str] = []  # estimated roles from the rules text, e.g. ["ramp"]


def summarize(card: OwnedCard) -> CardSummary:
    text = card.oracle_text
    if len(text) > SHORT_TEXT_CHARS:
        text = text[: SHORT_TEXT_CHARS - 1] + "…"
    return CardSummary(
        name=card.name,
        mana_cost=card.mana_cost,
        cmc=card.cmc,
        type_line=card.type_line,
        text=text,
        tags=sorted(card_categories(card)),
    )


# --- search_collection ----------------------------------------------------------------


class SearchCollectionArgs(ToolArgs):
    type_line: str | None = Field(
        default=None,
        description="Part of the type line, e.g. 'Creature', 'Instant', 'Artifact', 'Land'",
    )
    text: str | None = Field(
        default=None,
        description="Part of the rules text, e.g. 'draw a card', 'destroy target', 'token'",
    )
    name: str | None = Field(default=None, description="Part of the card name")
    min_cmc: float | None = Field(default=None, ge=0, le=20, description="Minimum mana value")
    max_cmc: float | None = Field(default=None, ge=0, le=20, description="Maximum mana value")
    limit: int = Field(default=25, ge=1, le=40, description="How many cards to return (max 40)")
    offset: int = Field(
        default=0, ge=0, le=100_000, description="Skip this many results (for the next page)"
    )


class SearchCollectionResult(BaseModel):
    total_matches: int
    returned: int
    next_offset: int | None  # pass this as `offset` to get more results; null when done
    cards: list[CardSummary]


async def search_collection(ctx: ToolContext, args: SearchCollectionArgs) -> SearchCollectionResult:
    # Always limited to cards the commander can legally use: the agent can't even see
    # off-color or banned cards, so it can't pick them by mistake.
    filters = CardFilters(
        name=args.name,
        text=args.text,
        type_line=args.type_line,
        min_cmc=args.min_cmc,
        max_cmc=args.max_cmc,
        identity_within=ctx.commander.color_identity,
        commander_legal=True,
    )
    async with ctx.sessions() as session:
        total, cards = await search_owned_cards(
            session, ctx.request.collection_id, filters, limit=args.limit, offset=args.offset
        )
    # Several printings of one card are one choice for the deck.
    unique: dict[str, OwnedCard] = {}
    for card in cards:
        if card.name != ctx.commander.name:
            unique.setdefault(card.name, card)
    end = args.offset + len(cards)
    return SearchCollectionResult(
        total_matches=total,
        returned=len(unique),
        next_offset=end if end < total else None,
        cards=[summarize(c) for c in unique.values()],
    )


# --- get_card_details -----------------------------------------------------------------


class CardDetailsArgs(ToolArgs):
    names: list[str] = Field(min_length=1, max_length=25, description="Exact card names")


class CardDetails(BaseModel):
    name: str
    owned: bool
    mana_cost: str = ""
    type_line: str = ""
    oracle_text: str = ""
    power: str | None = None
    toughness: str | None = None
    color_identity: list[str] = []
    keywords: list[str] = []
    legal_in_commander: bool = False


class CardDetailsResult(BaseModel):
    cards: list[CardDetails]


async def get_card_details(ctx: ToolContext, args: CardDetailsArgs) -> CardDetailsResult:
    details: list[CardDetails] = []
    for name in args.names:
        card = ctx.index.find(name)
        if card is None:
            details.append(CardDetails(name=name, owned=False))
            continue
        details.append(
            CardDetails(
                name=card.name,
                owned=True,
                mana_cost=card.mana_cost,
                type_line=card.type_line,
                oracle_text=card.oracle_text,
                power=card.power,
                toughness=card.toughness,
                color_identity=card.color_identity,
                keywords=card.keywords,
                legal_in_commander=card.legal_in_commander,
            )
        )
    return CardDetailsResult(cards=details)


# --- find_synergy_cards (semantic search) -----------------------------------------------


class FindSynergyArgs(ToolArgs):
    theme: str = Field(
        min_length=3,
        max_length=300,
        description=(
            "What you're looking for, in plain words, e.g. 'create lots of small creature "
            "tokens' or 'benefit when creatures die'. Matches by meaning, not exact words."
        ),
    )
    limit: int = Field(default=20, ge=1, le=30)


class FindSynergyResult(BaseModel):
    search_type: str  # "meaning + keywords", or "keywords only" if embeddings are unavailable
    cards: list[CardSummary]


async def find_synergy_cards(ctx: ToolContext, args: FindSynergyArgs) -> FindSynergyResult:
    vector = await embed_query(ctx.gemini, args.theme)  # before taking a DB connection
    async with ctx.sessions() as session:
        result = await find_synergy(
            session,
            ctx.request.collection_id,
            args.theme,
            identity_within=ctx.commander.color_identity,
            query_vector=vector,
            embedding_model=ctx.gemini.embedding_model if ctx.gemini else None,
            limit=args.limit,
            exclude_names={ctx.commander.name},
        )
    return FindSynergyResult(
        search_type="meaning + keywords" if result.semantic else "keywords only",
        cards=[summarize(c.card) for c in result.cards],
    )


# --- suggest_purchases (cards the user doesn't own) ---------------------------------------


class SuggestPurchasesArgs(ToolArgs):
    query: str = Field(
        min_length=2,
        max_length=200,
        description=(
            'Scryfall search terms for what the deck is missing, e.g. \'o:"draw a card" '
            "t:creature' or 'o:token o:elf'. Color identity, Commander legality, and "
            "'not already owned' are applied automatically."
        ),
    )
    max_results: int = Field(default=5, ge=1, le=10)


class PurchaseOption(BaseModel):
    name: str
    mana_cost: str
    type_line: str
    text: str
    price_usd: str | None
    scryfall_uri: str


class SuggestPurchasesResult(BaseModel):
    available: bool  # False if the card database couldn't be reached
    total_matches: int
    cards: list[PurchaseOption]
    note: str = ""


async def suggest_purchases(ctx: ToolContext, args: SuggestPurchasesArgs) -> SuggestPurchasesResult:
    if ctx.scryfall is None:
        return SuggestPurchasesResult(
            available=False, total_matches=0, cards=[], note="Card search is unavailable."
        )
    identity = "".join(ctx.commander.color_identity) or "c"
    # Scryfall syntax: id<=G means "color identity within green". The model's terms are
    # wrapped in parentheses, but a crafted query like "x) or (t:dragon" could still escape
    # them, so every result is ALSO checked in code below.
    full_query = f"({args.query}) id<={identity} legal:commander -is:digital"
    try:
        page = await ctx.scryfall.search_cards(full_query, max_pages=2)
    except ScryfallError as exc:
        return SuggestPurchasesResult(available=False, total_matches=0, cards=[], note=str(exc))

    options: list[PurchaseOption] = []
    for card in page.cards:
        if ctx.index.find(card.name) is not None:
            continue  # already owned: not a purchase
        if card.legalities.get("commander") != "legal" or not set(card.color_identity) <= set(
            ctx.commander.color_identity
        ):
            continue  # off-color or not legal: never suggest it
        text = card.oracle_text
        options.append(
            PurchaseOption(
                name=card.name,
                mana_cost=card.mana_cost,
                type_line=card.type_line,
                text=text if len(text) <= SHORT_TEXT_CHARS else text[: SHORT_TEXT_CHARS - 1] + "…",
                price_usd=card.prices.get("usd"),
                scryfall_uri=card.scryfall_uri,
            )
        )
        # Remember it, so submit_deck can attach the price and link to a suggestion.
        ctx.purchase_candidates[card.name.casefold()] = SuggestedBuy(
            name=card.name,
            reason="",
            price_usd=card.prices.get("usd"),
            scryfall_uri=card.scryfall_uri,
        )
        if len(options) == args.max_results:
            break
    return SuggestPurchasesResult(
        available=True,
        total_matches=page.total_cards,
        cards=options,
        note="Results are sorted by popularity in Commander decks.",
    )


# --- check_deck_rules and get_deck_stats ------------------------------------------------


class DraftDeckArgs(ToolArgs):
    cards: list[str] = Field(
        max_length=120,
        description=(
            "Names of every non-basic card in the draft deck, one entry per card. "
            "Don't include the commander or basic lands: basic lands are added "
            "automatically to fill the deck to 100."
        ),
    )


class DraftCheckResult(BaseModel):
    check: DeckCheck
    basic_lands_added: dict[str, int]


def _with_basics(ctx: ToolContext, names: list[str]) -> tuple[list[OwnedCard], dict[str, int]]:
    """Resolve names to owned cards and work out the basic lands that fill the deck."""
    owned: list[OwnedCard] = []
    for name in names:
        card = ctx.index.find(name)
        if card is not None and name.strip() not in BASIC_LANDS:
            owned.append(card)
    slots = 99 - len({c.oracle_id or c.name for c in owned})
    return owned, distribute_basics(ctx.commander, owned, slots)


async def check_deck_rules(ctx: ToolContext, args: DraftDeckArgs) -> DraftCheckResult:
    _, basics = _with_basics(ctx, args.cards)
    check = check_deck(
        ctx.commander,
        args.cards,
        basics,
        ctx.index,
        must_include=[*ctx.request.must_include, *ctx.request.accepted],
        rejected=ctx.request.rejected,
        max_lands=ctx.index.max_lands_for(ctx.commander),
    )
    return DraftCheckResult(check=check, basic_lands_added=basics)


async def get_deck_stats(ctx: ToolContext, args: DraftDeckArgs) -> DeckStats:
    owned, basics = _with_basics(ctx, args.cards)
    return deck_stats(owned, basics)


# --- submit_deck (the final answer) -----------------------------------------------------


class BuySuggestionArg(BaseModel):
    name: str = Field(max_length=200)
    reason: str = Field(max_length=400)


class SubmitDeckArgs(ToolArgs):
    picks: list[CardPick] = Field(
        max_length=99,
        description=(
            "Every non-basic card in the final deck with its role and a short reason. "
            "Don't include the commander or basic lands (they're added automatically)."
        ),
    )
    summary: str = Field(max_length=2000, description="The deck's game plan in 2-4 sentences")
    suggested_buys: list[BuySuggestionArg] = Field(
        default=[],
        max_length=10,
        description="Optional cards the user doesn't own but should consider buying",
    )


class SubmitResult(BaseModel):
    accepted: bool
    problems: list[str] = []
    message: str


async def submit_deck(ctx: ToolContext, args: SubmitDeckArgs) -> SubmitResult:
    """Validate the final deck in code. Only a deck with zero problems is accepted."""
    ctx.submit_attempts += 1
    names = [p.name for p in args.picks]
    _, basics = _with_basics(ctx, names)
    check = check_deck(
        ctx.commander,
        names,
        basics,
        ctx.index,
        must_include=[*ctx.request.must_include, *ctx.request.accepted],
        rejected=ctx.request.rejected,
        max_lands=ctx.index.max_lands_for(ctx.commander),
    )
    if not check.ok:
        return SubmitResult(
            accepted=False,
            problems=check.problems,
            message="Deck rejected. Fix every problem listed, then call submit_deck again.",
        )

    # Use the collection's exact spelling for every name, so the saved deck matches it.
    picks: list[CardPick] = []
    for pick in args.picks:
        card = ctx.index.find(pick.name)
        if card is not None:  # always true here: check_deck verified ownership
            picks.append(pick.model_copy(update={"name": card.name}))

    # Only keep buy suggestions that came from a real Scryfall search this run, so a card
    # name the model invented never reaches the user.
    buys: list[SuggestedBuy] = []
    for buy in args.suggested_buys:
        found = ctx.purchase_candidates.get(buy.name.casefold())
        if found is not None:
            buys.append(found.model_copy(update={"reason": buy.reason}))

    ctx.final = DeckRecommendation(
        commander=ctx.commander.name,
        picks=picks,
        basic_lands=basics,
        suggested_buys=buys,
        summary=args.summary,
    )
    return SubmitResult(accepted=True, message="Deck accepted.")


# --- The registry ------------------------------------------------------------------------

TOOLS: dict[str, Tool] = {
    tool.name: tool
    for tool in [
        Tool(
            "search_collection",
            "Search the user's collection for cards this commander can use (color identity "
            "and Commander legality are applied automatically). Combine filters, e.g. "
            "type_line='Creature' and text='token'. Returns compact card summaries with "
            "estimated role tags. Call it several times in one turn for different roles.",
            SearchCollectionArgs,
            search_collection,
        ),
        Tool(
            "get_card_details",
            "Get the full rules text and stats for specific owned cards by exact name. "
            "Use it when a search summary was cut short and you need the whole text.",
            CardDetailsArgs,
            get_card_details,
        ),
        Tool(
            "find_synergy_cards",
            "Find owned cards that fit a theme or strategy, matched by MEANING rather than "
            "exact words (semantic search combined with keyword search). Best for synergy: "
            "describe what the commander wants, e.g. 'sacrifice creatures for value'.",
            FindSynergyArgs,
            find_synergy_cards,
        ),
        Tool(
            "suggest_purchases",
            "Search ALL Magic cards (not just the collection) for cards the user could buy "
            "to fill a gap, using Scryfall search syntax. Use sparingly, only when the "
            "collection is clearly missing something; list the best ones in submit_deck's "
            "suggested_buys. Purchases are never part of the deck itself.",
            SuggestPurchasesArgs,
            suggest_purchases,
        ),
        Tool(
            "check_deck_rules",
            "Check a draft deck against the Commander rules (100 cards, singleton, color "
            "identity, ownership, land count, must-include and rejected cards). Basic lands "
            "are added automatically to fill the deck. Returns every problem found.",
            DraftDeckArgs,
            check_deck_rules,
        ),
        Tool(
            "get_deck_stats",
            "Get a draft deck's mana curve, land count, and estimated counts of ramp, card "
            "draw, removal, and board wipes, compared with recommended targets.",
            DraftDeckArgs,
            get_deck_stats,
        ),
        Tool(
            "submit_deck",
            "Submit the final deck. It is checked in code; if anything is wrong you get the "
            "list of problems and must fix them and submit again. Call this exactly once you "
            "have about 62-64 non-land cards plus a few non-basic lands.",
            SubmitDeckArgs,
            submit_deck,
        ),
    ]
}

FINAL_TOOL = "submit_deck"


def register(tool: Tool) -> None:
    """Add a tool to the registry (used by modules that define extra tools)."""
    TOOLS[tool.name] = tool


def tool_result_json(result: BaseModel | dict[str, Any]) -> dict[str, Any]:
    """Turn a tool result into a plain dict, trimmed so one result can't flood the prompt."""
    data = result.model_dump(mode="json") if isinstance(result, BaseModel) else result
    text = json.dumps(data)
    if len(text) <= MAX_RESULT_CHARS:
        return data
    return {
        "truncated": True,
        "note": "Result too large; narrow the search or use a smaller limit.",
        "partial": text[:MAX_RESULT_CHARS],
    }


def compact_for_model(output: dict[str, Any]) -> dict[str, Any]:
    """Shrink a tool result before it goes to the model (fewer tokens, same information).

    Card lists become one text line per card instead of a list of JSON objects, which
    roughly halves their size. Everything else passes through unchanged. Our own code
    (REST, MCP, tests) still sees the full structured result; only the model's copy shrinks.
    """
    cards = output.get("cards")
    if not isinstance(cards, list) or not cards or not all(isinstance(c, dict) for c in cards):
        return output
    lines: list[str] = []
    for card in cards:
        text = " ".join(str(card.get("text") or card.get("oracle_text") or "").split())
        parts = [
            str(card.get("name", "")),
            str(card.get("mana_cost") or "-"),
            str(card.get("type_line", "")),
        ]
        if card.get("owned") is False:
            parts.append("NOT OWNED")
        if card.get("price_usd"):
            parts.append(f"${card['price_usd']}")
        lines.append(" | ".join([*parts, text]))
    return {**output, "cards": lines}


# Validation-only keywords. Our Pydantic models enforce all of these on every call, so the
# model's copy of the schema doesn't need them, and Gemini rejects some of them (HTTP 400)
# when it is forced to call a tool, because it then compiles the schema into its output.
_VALIDATION_ONLY = {
    "maxLength", "minLength", "maxItems", "minItems", "default", "pattern",
    "maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum",
    "title", "additionalProperties", "$defs",
}  # fmt: skip


def inline_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """The plain schema LLM APIs accept: types, descriptions, enums, and required fields.

    - "$ref"/"$defs" references are expanded in place (some APIs need a self-contained schema)
    - optional fields (Pydantic's anyOf [X, null]) become plain X; omitting them is enough
    - validation-only keywords are dropped (see _VALIDATION_ONLY)
    """
    defs = schema.get("$defs", {})

    def expand(node: object) -> object:
        if isinstance(node, dict):
            if "$ref" in node:
                name = node["$ref"].split("/")[-1]
                return expand(defs[name])
            options = node.get("anyOf")
            if isinstance(options, list):
                not_null = [
                    o for o in options if not (isinstance(o, dict) and o.get("type") == "null")
                ]
                if len(not_null) == 1:
                    rest = {k: v for k, v in node.items() if k != "anyOf"}
                    return expand({**rest, **not_null[0]})
            return {k: expand(v) for k, v in node.items() if k not in _VALIDATION_ONLY}
        if isinstance(node, list):
            return [expand(v) for v in node]
        return node

    expanded = expand(schema)
    assert isinstance(expanded, dict)
    return expanded
