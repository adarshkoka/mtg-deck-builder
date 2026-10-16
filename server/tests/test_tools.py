"""Tool-level tests: suggest_purchases (Scryfall search with pagination)."""

from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.agent.llm import ModelTurn, ScriptedModel, ToolCall, ToolResult
from app.agent.models import DeckRequest
from app.agent.rules import CollectionIndex
from app.agent.tools import SuggestPurchasesArgs, ToolContext, suggest_purchases
from app.main import app
from app.scryfall import ScryfallClient
from tests.conftest import reset_db, running_app
from tests.deck_data import COMMANDER, CSV, KNOWN, legal_picks, mtg_card
from tests.fakes import FakeScryfall
from tests.test_rules import LEADER, owned


async def _no_sleep(_: float) -> None:
    return None


def _context(fake: FakeScryfall, owned_names: list[str]) -> ToolContext:
    http = httpx.AsyncClient(
        base_url="https://api.test", transport=httpx.MockTransport(fake.handler)
    )
    return ToolContext(
        sessions=None,  # type: ignore[arg-type]  # this tool never touches the database
        request=DeckRequest(collection_id=1, commander=LEADER.name),
        commander=LEADER,
        index=CollectionIndex([owned(n) for n in owned_names]),
        scryfall=ScryfallClient(http, sleep=_no_sleep),
    )


def _for_sale(name: str, price: str) -> dict:
    card = mtg_card(name, "Creature — Elf", "Draw a card.", "{G}", ["G"])
    card |= {"prices": {"usd": price}, "scryfall_uri": f"https://scryfall.test/{name}"}
    return card


async def test_suggest_purchases_pages_filters_owned_and_scopes_the_query() -> None:
    fake = FakeScryfall({})
    fake.search_results = [_for_sale(f"Elf {i}", f"{i}.00") for i in range(1, 6)]
    ctx = _context(fake, owned_names=["Elf 1"])

    result = await suggest_purchases(ctx, SuggestPurchasesArgs(query="t:elf", max_results=10))

    assert result.available and result.total_matches == 5
    # Two pages of 2 were followed (max_pages=2); "Elf 1" is owned so it's skipped.
    assert [c.name for c in result.cards] == ["Elf 2", "Elf 3", "Elf 4"]
    assert fake.search_queries[0] == "(t:elf) id<=GU legal:commander -is:digital"
    assert ctx.purchase_candidates["elf 2"].price_usd == "2.00"


async def test_no_matches_and_outages_are_normal_results() -> None:
    empty = await suggest_purchases(
        _context(FakeScryfall({}), []), SuggestPurchasesArgs(query="zzz")
    )
    assert empty.available and empty.cards == []

    down = FakeScryfall({}, fail_with=[500] * 10)
    result = await suggest_purchases(_context(down, []), SuggestPurchasesArgs(query="t:elf"))
    assert not result.available and "HTTP 500" in result.note


@pytest.fixture
def api() -> Iterator[tuple[TestClient, FakeScryfall, int]]:
    reset_db()
    with running_app(dict(KNOWN)) as (client, fake):
        collection_id = client.post(
            "/collections/import", files={"file": ("c.csv", CSV, "text/csv")}
        ).json()["collection_id"]
        yield client, fake, collection_id


def test_agent_attaches_real_purchase_data_and_drops_invented_cards(
    api: tuple[TestClient, FakeScryfall, int],
) -> None:
    client, fake, collection_id = api
    fake.search_results = [_for_sale("Priest of Titania", "3.50")]

    def finish(results: str | list[ToolResult]) -> ModelTurn:
        assert isinstance(results, list)
        assert results[0].output["cards"][0]["name"] == "Priest of Titania"
        buys = [
            {"name": "Priest of Titania", "reason": "Huge mana with many elves."},
            {"name": "Totally Real Card", "reason": "Invented by the model."},
        ]
        return ModelTurn(
            "",
            [
                ToolCall(
                    "submit_deck",
                    {"picks": legal_picks(), "summary": "Elves.", "suggested_buys": buys},
                )
            ],
        )

    app.state.agent_model = ScriptedModel(
        [ModelTurn("", [ToolCall("suggest_purchases", {"query": "t:elf o:add"})]), finish]
    )
    run_id = client.post(
        "/decks/build", json={"collection_id": collection_id, "commander": COMMANDER}
    ).json()["run_id"]
    run = client.get(f"/decks/runs/{run_id}").json()
    assert run["status"] == "succeeded"
    assert run["result"]["suggested_buys"] == [
        {
            "name": "Priest of Titania",
            "reason": "Huge mana with many elves.",
            "price_usd": "3.50",
            "scryfall_uri": "https://scryfall.test/Priest of Titania",
        }
    ]
