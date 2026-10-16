from uuid import uuid4

from app.agent.rules import (
    CollectionIndex,
    can_be_commander,
    card_categories,
    check_deck,
    distribute_basics,
    normalize_name,
)
from app.agent.tools import TOOLS, inline_schema
from app.collection.queries import OwnedCard


def owned(
    name: str, type_line: str = "Instant", text: str = "", identity: str = "", **kw: object
) -> OwnedCard:
    data: dict[str, object] = {
        "scryfall_id": uuid4(),
        "oracle_id": uuid4(),
        "name": name,
        "quantity": 1,
        "mana_cost": "",
        "cmc": 2,
        "type_line": type_line,
        "oracle_text": text,
        "colors": list(identity),
        "color_identity": list(identity),
        "keywords": [],
        "power": None,
        "toughness": None,
        "rarity": "common",
        "set_code": "tst",
        "collector_number": "1",
        "legal_in_commander": True,
        "image_url": None,
        "image_url_small": None,
        "price_usd": None,
        "multiverse_ids": [],
    }
    data.update(kw)
    return OwnedCard.model_validate(data)


LEADER = owned("Leader", "Legendary Creature — Elf", identity="GU", mana_cost="{G}{U}")


def test_normalize_and_double_faced_lookup() -> None:
    assert normalize_name("  Urza" + chr(0x2019) + "s   SAGA ") == "urza's saga"
    dfc = owned("Delver of Secrets // Insectile Aberration", "Creature", identity="U")
    index = CollectionIndex([dfc])
    assert index.find("delver of secrets") is dfc
    assert index.find("Delver of Secrets // Insectile Aberration") is dfc


def test_singleton_counts_printings_of_one_card_once() -> None:
    oracle = uuid4()
    first = owned("Sol Ring", "Artifact", oracle_id=oracle, set_code="c21")
    second = owned("Sol Ring", "Artifact", oracle_id=oracle, set_code="cmm")
    check = check_deck(
        LEADER,
        ["Sol Ring", "sol ring"],
        {},
        CollectionIndex([first, second]),
        require_complete=False,
    )
    assert check.problems == ["Sol Ring: listed more than once (singleton format)"]


def test_check_deck_reports_every_problem() -> None:
    index = CollectionIndex(
        [
            owned("Bolt", identity="R"),
            owned("Relic", "Artifact", legal_in_commander=False),
            owned("Island Hopper", "Creature", identity="U"),
        ]
    )
    check = check_deck(
        LEADER,
        ["Bolt", "Relic", "Black Lotus", "Leader", "Forest"],
        {"Mountain": 1, "Island": 5},
        index,
        must_include=["Island Hopper"],
    )
    problems = "\n".join(check.problems)
    assert "Bolt: color identity R is outside the commander's (GU)" in problems
    assert "Relic: not legal in Commander" in problems
    assert "Black Lotus: not in the user's collection" in problems
    assert "Forest: list basic lands in basic_lands" in problems
    assert "Mountain: produces a color outside" in problems
    assert "Island Hopper: the user asked for this card" in problems
    assert "needs exactly 100" in problems
    assert not check.ok


def test_distribute_basics_follows_color_weight() -> None:
    picks = [owned(f"G{i}", mana_cost="{G}{G}") for i in range(6)] + [owned("U", mana_cost="{U}")]
    basics = distribute_basics(LEADER, picks, 30)
    assert sum(basics.values()) == 30
    assert basics["Forest"] > basics["Island"] > 0  # green dominates but blue isn't starved
    colorless = owned("Golem", "Legendary Artifact Creature — Golem")
    assert distribute_basics(colorless, [], 10) == {"Wastes": 10}


def test_card_categories_and_commanders() -> None:
    assert card_categories(owned("Rock", "Artifact", "{T}: Add {C}{C}.")) == {"ramp"}
    assert card_categories(owned("Wrath", "Sorcery", "Destroy all creatures.")) == {"board_wipe"}
    assert card_categories(owned("Murder", "Instant", "Destroy target creature.")) == {"removal"}
    assert card_categories(owned("Divination", "Sorcery", "Draw two cards.")) == {"card_draw"}
    assert card_categories(owned("Grove", "Land", "{T}: Add {G}.")) == set()
    assert can_be_commander(LEADER)
    assert can_be_commander(
        owned("Walker", "Legendary Planeswalker", "Walker can be your commander.")
    )
    assert not can_be_commander(owned("Bear", "Creature — Bear"))


def test_tool_schemas_are_self_contained() -> None:
    for tool in TOOLS.values():
        schema = tool.parameters_schema()
        text = str(schema)
        assert "$ref" not in text and "$defs" not in text, tool.name
        # Gemini rejects validation keywords in forced tool calls (HTTP 400)
        assert "maxLength" not in text and "anyOf" not in text and "default" not in text, tool.name
        assert schema["type"] == "object"
    nested = inline_schema(
        {
            "$defs": {"A": {"type": "string", "title": "A"}},
            "properties": {"a": {"$ref": "#/$defs/A"}},
        }
    )
    assert nested == {"properties": {"a": {"type": "string"}}}


def test_land_cap_rises_for_a_thin_collection() -> None:
    spells = [owned(f"Spell {i}", identity="G") for i in range(30)]
    index = CollectionIndex(spells)
    assert index.max_lands_for(LEADER) == 69  # 99 - 30 usable spells
    names = [c.name for c in spells]
    check = check_deck(LEADER, names, {"Forest": 69}, index, max_lands=index.max_lands_for(LEADER))
    assert check.ok, check.problems
    assert (
        CollectionIndex([owned(f"S{i}", identity="G") for i in range(80)]).max_lands_for(LEADER)
        == 40
    )
