"""The golden set: fixed collections and commanders every engine is evaluated on.

Each case is a made-up collection served by the fake Scryfall, so results don't depend
on the network or on card data changing. Every case includes "trap" cards that must never
appear in a deck (wrong colors, banned, or carrying a prompt injection in their text).
"""

from dataclasses import dataclass
from typing import Any

from tests.deck_data import BANNED, CARDS, COMMANDER, INJECTION, OFF_COLOR, mtg_card


@dataclass(frozen=True)
class GoldenCase:
    name: str
    commander: str
    cards: list[dict[str, Any]]
    traps: frozenset[str]  # must never be picked
    rich: bool  # enough cards that every role should be filled
    notes: str = ""

    @property
    def csv(self) -> bytes:
        rows = "\n".join(f'1,"{card["name"]}"' for card in self.cards)
        return f"Count,Name\n{rows}".encode()


def _numbered(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for number, card in enumerate(cards, start=1):
        card["collector_number"] = str(number)
    return cards


def _thin_red() -> list[dict[str, Any]]:
    """A mono-red commander with only about 20 usable cards."""
    leader = mtg_card(
        "Grenzo Test, Goblin Boss",
        "Legendary Creature — Goblin",
        "Other Goblins you control get +1/+1.",
        "{1}{R}{R}",
        ["R"],
        cmc=3,
    )
    raiders = [
        mtg_card(f"Goblin Raider {i}", "Creature — Goblin", "Haste.", "{R}", ["R"], cmc=1)
        for i in range(1, 15)
    ]
    burn = [
        mtg_card(
            f"Fire Jab {i}",
            "Instant",
            "Fire Jab deals 2 damage to any target.",
            "{R}",
            ["R"],
            cmc=1,
        )
        for i in range(1, 5)
    ]
    extras = [
        mtg_card("Ruby Talisman", "Artifact", "{T}: Add {R}.", "{2}", cmc=2),
        mtg_card("Smoldering Crag", "Land", "{T}: Add {R}.", "", cmc=0),
        mtg_card("Grove Giant", "Creature — Giant", "Trample.", "{4}{G}", ["G"], cmc=5),  # trap
    ]
    return _numbered([leader, *raiders, *burn, *extras])


def _simic() -> list[dict[str, Any]]:
    """A green-blue commander with a full pool and off-color/banned traps."""
    leader = mtg_card(
        "Tidewild Druid",
        "Legendary Creature — Merfolk Druid",
        "Whenever you draw your second card each turn, put a +1/+1 counter on target creature.",
        "{1}{G}{U}",
        ["G", "U"],
        cmc=3,
    )
    cards = [leader]
    cards += [
        mtg_card(f"Tide Insight {i}", "Instant", "Draw two cards.", "{1}{U}", ["U"], cmc=2)
        for i in range(1, 14)
    ]
    cards += [
        mtg_card(
            f"Wild Sprout {i}",
            "Sorcery",
            "Search your library for a basic land card, put it onto the battlefield tapped.",
            "{1}{G}",
            ["G"],
            cmc=2,
        )
        for i in range(1, 7)
    ]
    cards += [
        mtg_card(f"Mana Shard {i}", "Artifact", "{T}: Add {C}.", "{1}", cmc=1) for i in range(1, 7)
    ]
    cards += [
        mtg_card(f"Deny {i}", "Instant", "Counter target spell.", "{U}{U}", ["U"], cmc=2)
        for i in range(1, 9)
    ]
    cards += [
        mtg_card(
            f"Reef Collapse {i}", "Sorcery", "Destroy all creatures.", "{3}{U}{U}", ["U"], cmc=5
        )
        for i in range(1, 4)
    ]
    cards += [
        mtg_card(
            f"Merfolk Tidecaller {i}",
            "Creature — Merfolk",
            "Whenever you draw a card, scry 1.",
            "{G}{U}",
            ["G", "U"],
            cmc=2,
        )
        for i in range(1, 26)
    ]
    cards += [
        mtg_card(f"Delta Shore {i}", "Land", "{T}: Add {G} or {U}.", "", cmc=0) for i in range(1, 5)
    ]
    cards += [  # traps
        mtg_card(
            "Night Feast",
            "Sorcery",
            "Destroy target creature. You lose 2 life.",
            "{1}{B}",
            ["B"],
            cmc=2,
        ),
        mtg_card(
            "Blazing Fury",
            "Instant",
            "Blazing Fury deals 4 damage to any target.",
            "{1}{R}",
            ["R"],
            cmc=2,
        ),
        mtg_card("Forbidden Engine", "Artifact", "{T}: Add {C}{C}{C}.", "{0}", cmc=0, legal=False),
    ]
    return _numbered(cards)


GOLDEN: list[GoldenCase] = [
    GoldenCase(
        "elves_rich",
        COMMANDER,
        CARDS,
        frozenset({OFF_COLOR, BANNED, INJECTION, "Black Lotus"}),
        rich=True,
        notes="Plenty of cards in every role; one card's text is a prompt injection.",
    ),
    GoldenCase(
        "goblins_thin",
        "Grenzo Test, Goblin Boss",
        _thin_red(),
        frozenset({"Grove Giant"}),
        rich=False,
        notes="Only ~20 usable cards: the deck must be finished with basic lands.",
    ),
    GoldenCase(
        "simic_two_color",
        "Tidewild Druid",
        _simic(),
        frozenset({"Night Feast", "Blazing Fury", "Forbidden Engine"}),
        rich=True,
        notes="Two colors, with off-color and banned traps.",
    ),
]
