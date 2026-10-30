"""Deterministic Commander deck rules and statistics.

The language model is good at judgment ("this card fits a tokens strategy") but not at
bookkeeping ("is this exactly 100 cards?"). Everything that can be checked with plain
code is checked here, and the agent's final answer is rejected until it passes. So a
deck is never accepted just because the model said it was fine.

Commander deck rules enforced here:
- exactly 100 cards: 1 commander + 99 others
- singleton: only one copy of each card, except basic lands
- every card's color identity must fit inside the commander's color identity
- every card must be legal in the Commander format
- plus a product rule: every non-basic card must come from the user's collection
"""

import math
import re
from collections import Counter
from collections.abc import Iterable

from pydantic import BaseModel

from app.collection.queries import OwnedCard

DECK_SIZE = 100
MIN_LANDS, MAX_LANDS = 33, 40

# Basic lands are unlimited (the user can always get more), so they don't need to be owned.
BASIC_LANDS: dict[str, str | None] = {
    "Plains": "W",
    "Island": "U",
    "Swamp": "B",
    "Mountain": "R",
    "Forest": "G",
    "Wastes": None,  # colorless basic, used by colorless commanders
}
COLOR_TO_BASIC = {color: name for name, color in BASIC_LANDS.items() if color}

# Rough targets for a balanced deck. Shown to the agent by get_deck_stats.
TARGETS = {
    "lands": "35-38",
    "ramp": "10+",
    "card_draw": "10+",
    "removal": "8+",
    "board_wipe": "2-4",
}


CURLY_APOSTROPHE = chr(0x2019)  # some exports spell "Urza's" with a curly apostrophe


def normalize_name(name: str) -> str:
    """'  Sol  RING' -> 'sol ring'. Curly apostrophes (U+2019) become straight ones."""
    return " ".join(name.replace(CURLY_APOSTROPHE, "'").casefold().split())


class CollectionIndex:
    """An in-memory view of everything one collection owns, for fast lookups by name.

    Built once at the start of an agent run, so checking 99 names doesn't need 99 queries.
    A double-faced card can be found by its full name ("Delver of Secrets // Insectile
    Aberration") or just its front face ("Delver of Secrets").
    """

    def __init__(self, cards: Iterable[OwnedCard]) -> None:
        self._by_name: dict[str, OwnedCard] = {}
        for card in cards:
            names = [card.name, card.name.split(" // ")[0]]
            for name in names:
                self._by_name.setdefault(normalize_name(name), card)
        # One entry per card (printings of the same card collapse into one).
        unique: dict[object, OwnedCard] = {}
        for card in self._by_name.values():
            unique.setdefault(card.oracle_id or card.name, card)
        self.cards = list(unique.values())
        self.unique_count = len(self.cards)

    def find(self, name: str) -> OwnedCard | None:
        return self._by_name.get(normalize_name(name))

    def max_lands_for(self, commander: OwnedCard) -> int:
        """The most lands a deck for this commander may have.

        Normally MAX_LANDS. But a small collection may not own enough usable spells to
        fill 99 slots, and the rest has to be basic lands; then the cap rises so the
        deck stays buildable (finish with what you own, plus basics).
        """
        identity = set(commander.color_identity)
        usable_spells = sum(
            1
            for card in self.cards
            if card.legal_in_commander
            and "Land" not in card.type_line
            and set(card.color_identity) <= identity
            and normalize_name(card.name) != normalize_name(commander.name)
        )
        return max(MAX_LANDS, 99 - usable_spells)


def can_be_commander(card: OwnedCard) -> bool:
    """Legendary creatures can lead a deck, and so can cards that say so in their text."""
    type_line = card.type_line.casefold()
    return card.legal_in_commander and (
        ("legendary" in type_line and "creature" in type_line)
        or "can be your commander" in card.oracle_text.casefold()
    )


class DeckCheck(BaseModel):
    """The result of checking a (draft or final) deck against the rules."""

    ok: bool
    card_count: int  # including the commander and basic lands
    land_count: int
    problems: list[str]


class DeckStats(BaseModel):
    """Numbers that describe a deck's shape, compared against the TARGETS."""

    card_count: int
    land_count: int
    nonland_count: int
    average_cmc: float  # of non-land cards
    mana_curve: dict[str, int]  # mana value -> how many non-land cards cost that much
    category_counts: dict[str, int]  # ramp, card_draw, removal, board_wipe (estimated)
    targets: dict[str, str]
    notes: list[str]


def check_deck(
    commander: OwnedCard,
    picks: list[str],
    basic_lands: dict[str, int],
    index: CollectionIndex,
    *,
    must_include: Iterable[str] = (),
    rejected: Iterable[str] = (),
    require_complete: bool = True,
    max_lands: int = MAX_LANDS,
) -> DeckCheck:
    """Check a deck. `picks` are the non-basic cards (one name each, commander excluded)."""
    problems: list[str] = []
    identity = set(commander.color_identity)
    seen: dict[str, str] = {}  # card identity key -> the name it was first listed as
    land_count = 0

    for name in picks:
        if name.strip() in BASIC_LANDS:
            problems.append(f"{name}: list basic lands in basic_lands, not as picks")
            continue
        card = index.find(name)
        if card is None:
            problems.append(f"{name}: not in the user's collection (use exact names from tools)")
            continue
        key = str(card.oracle_id or normalize_name(card.name))
        if normalize_name(card.name) == normalize_name(commander.name):
            problems.append(f"{card.name}: is the commander; don't list it again")
            continue
        if key in seen:
            problems.append(f"{card.name}: listed more than once (singleton format)")
            continue
        seen[key] = card.name
        if not card.legal_in_commander:
            problems.append(f"{card.name}: not legal in Commander")
        outside = set(card.color_identity) - identity
        if outside:
            problems.append(
                f"{card.name}: color identity {''.join(sorted(outside))} is outside the "
                f"commander's ({''.join(sorted(identity)) or 'colorless'})"
            )
        if "Land" in card.type_line:
            land_count += 1

    for basic, count in basic_lands.items():
        if basic not in BASIC_LANDS:
            problems.append(f"{basic}: not a basic land")
        elif count < 0:
            problems.append(f"{basic}: count can't be negative")
        elif count and BASIC_LANDS[basic] is not None and BASIC_LANDS[basic] not in identity:
            problems.append(f"{basic}: produces a color outside the commander's identity")
    basics_total = sum(max(c, 0) for c in basic_lands.values())
    land_picks = land_count  # non-basic lands among the picks
    land_count += basics_total

    listed = {normalize_name(n) for n in seen.values()}
    for name in must_include:
        card = index.find(name)
        if card is not None and normalize_name(card.name) not in listed:
            problems.append(f"{card.name}: the user asked for this card; it must be included")
    for name in rejected:
        card = index.find(name)
        if card is not None and normalize_name(card.name) in listed:
            problems.append(f"{card.name}: the user rejected this card; replace it")

    card_count = 1 + len(seen) + basics_total
    if require_complete:
        if card_count != DECK_SIZE:
            diff = DECK_SIZE - card_count
            action = f"add {diff}" if diff > 0 else f"remove {-diff}"
            problems.append(f"Deck has {card_count} cards; it needs exactly 100 ({action})")
        # Basic lands fill every empty slot, so a land count that's off really means the
        # number of non-land cards is off. Say exactly that, with numbers, so the model can
        # fix it in one try instead of guessing.
        spells = len(seen) - land_picks
        if land_count > max_lands:
            add = land_count - 37
            problems.append(
                f"Deck has {land_count} lands (allowed {MIN_LANDS}-{max_lands}). Basic lands "
                f"fill every empty slot, so this means too few non-land cards: you listed "
                f"{spells} non-land cards and {land_picks} non-basic lands. Add about {add} more "
                f"non-land cards from the pool (or remove some non-basic lands)."
            )
        elif land_count < MIN_LANDS:
            remove = 36 - land_count
            problems.append(
                f"Deck has {land_count} lands (allowed {MIN_LANDS}-{max_lands}): too many "
                f"non-land cards ({spells}). Remove about {remove} non-land cards; basic lands "
                f"will fill the freed slots."
            )
    return DeckCheck(
        ok=not problems, card_count=card_count, land_count=land_count, problems=problems
    )


def distribute_basics(commander: OwnedCard, picks: list[OwnedCard], slots: int) -> dict[str, int]:
    """Fill `slots` with basic lands, split by how much each color shows up in mana costs.

    Example: a green-blue deck whose spells show 30 green symbols and 10 blue symbols
    gets about 3 Forests for every Island.
    """
    if slots <= 0:
        return {}
    colors = [c for c in ("W", "U", "B", "R", "G") if c in commander.color_identity]
    if not colors:
        return {"Wastes": slots}

    pips: Counter[str] = Counter()
    for card in [commander, *picks]:
        for color in colors:
            # Counts symbols like {G}, and hybrid ones like {G/U} for both colors.
            pips[color] += len(re.findall(r"\{[^}]*" + color + r"[^}]*\}", card.mana_cost))
    weights = {c: pips[c] or 1 for c in colors}  # every color gets at least some weight

    # Largest-remainder rounding so the counts add up to exactly `slots`.
    total = sum(weights.values())
    exact = {c: slots * w / total for c, w in weights.items()}
    counts = {c: math.floor(v) for c, v in exact.items()}
    leftover = slots - sum(counts.values())
    for c in sorted(colors, key=lambda c: exact[c] - counts[c], reverse=True)[:leftover]:
        counts[c] += 1
    return {COLOR_TO_BASIC[c]: n for c, n in counts.items() if n}


# --- Estimating what a card does from its rules text -----------------------------------
# These patterns are heuristics: good enough to tell the agent "you only have 3 removal
# spells", not a full rules engine.
_PATTERNS = {
    "ramp": re.compile(
        r"add \{|add (one|two|three) mana|search your library for (a|up to \w+) (basic )?"
        r"(land|forest|plains|island|swamp|mountain)",
    ),
    "card_draw": re.compile(r"\bdraws? (a|an|one|two|three|four|x|that many) (additional )?cards?"),
    "removal": re.compile(
        r"(destroy|exile) (target|up to one target|another target)|counter target spell"
        r"|deals? \d+ damage to (any target|target creature)|return target (creature|nonland"
        r" permanent)[^.]* to its owner's hand"
    ),
    "board_wipe": re.compile(
        r"(destroy|exile) all (creatures|nonland permanents|other creatures|artifacts)"
        r"|deals? \d+ damage to each creature|all creatures get -\d+/-\d+"
    ),
}


def card_categories(card: OwnedCard) -> set[str]:
    """Which of ramp / card_draw / removal / board_wipe a card's text suggests."""
    if "Land" in card.type_line:
        return set()  # lands that tap for mana aren't "ramp" in the deck-building sense
    text = card.oracle_text.casefold()
    return {name for name, pattern in _PATTERNS.items() if pattern.search(text)}


def deck_stats(picks: list[OwnedCard], basic_lands: dict[str, int]) -> DeckStats:
    """Mana curve, land count, and estimated role counts for a list of owned cards."""
    lands = [c for c in picks if "Land" in c.type_line]
    nonlands = [c for c in picks if "Land" not in c.type_line]
    basics = sum(max(n, 0) for n in basic_lands.values())

    curve: Counter[str] = Counter()
    categories: Counter[str] = Counter()
    for card in nonlands:
        curve["7+" if card.cmc >= 7 else str(int(card.cmc))] += 1
        categories.update(card_categories(card))

    land_count = len(lands) + basics
    counts = {name: categories[name] for name in _PATTERNS}
    notes: list[str] = []
    if land_count < 35:
        notes.append(f"Only {land_count} lands; most decks want 35-38.")
    for name, minimum in (("ramp", 10), ("card_draw", 10), ("removal", 8), ("board_wipe", 2)):
        if counts[name] < minimum:
            notes.append(f"Only about {counts[name]} {name} cards; aim for {TARGETS[name]}.")

    return DeckStats(
        card_count=1 + len(picks) + basics,
        land_count=land_count,
        nonland_count=len(nonlands),
        average_cmc=round(sum(c.cmc for c in nonlands) / len(nonlands), 2) if nonlands else 0.0,
        mana_curve={k: curve[k] for k in ["0", "1", "2", "3", "4", "5", "6", "7+"]},
        category_counts=counts,
        targets=TARGETS,
        notes=notes,
    )
