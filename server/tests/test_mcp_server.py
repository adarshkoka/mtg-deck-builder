"""The MCP server's tools, called in-process against the test database."""

from collections.abc import Iterator

import httpx
import pytest
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import CallToolResult, TextContent

from app import mcp_server
from app.db import make_engine, make_session_factory
from app.scryfall import ScryfallClient
from tests.conftest import TEST_DATABASE_URL, reset_db, running_app
from tests.deck_data import COMMANDER, CSV, KNOWN, OFF_COLOR, legal_picks
from tests.fakes import FakeScryfall


def text(result: object) -> str:
    """The text of a tool result's first content block."""
    assert isinstance(result, CallToolResult)
    block = result.content[0]
    assert isinstance(block, TextContent)
    return block.text


@pytest.fixture
def collection_id() -> Iterator[int]:
    reset_db()
    with running_app(dict(KNOWN)) as (client, _fake):
        cid = client.post("/collections/import", files={"file": ("c.csv", CSV, "text/csv")}).json()[
            "collection_id"
        ]
    http = httpx.AsyncClient(
        base_url="https://api.test", transport=httpx.MockTransport(FakeScryfall({}).handler)
    )
    sessions = make_session_factory(make_engine(TEST_DATABASE_URL))
    mcp_server.set_state(mcp_server._State(sessions, ScryfallClient(http), gemini=None))
    yield cid
    mcp_server.set_state(None)


async def test_tools_are_listed_with_descriptions_and_schemas() -> None:
    tools = {t.name: t for t in await mcp_server.mcp.list_tools()}
    assert {
        "list_collections",
        "list_commanders",
        "search_owned_cards",
        "check_deck",
        "save_deck",
    } <= set(tools)
    search = tools["search_owned_cards"]
    assert "color identity" in (search.description or "")
    assert search.input_schema["required"] == ["collection_id", "commander"]
    list_annotations, save_annotations = (
        tools["list_collections"].annotations,
        tools["save_deck"].annotations,
    )
    assert list_annotations is not None and list_annotations.read_only_hint is True
    assert save_annotations is not None and save_annotations.read_only_hint is False


async def test_mcp_tools_share_the_agent_logic(collection_id: int) -> None:
    mcp = mcp_server.mcp
    collections = await mcp.call_tool("list_collections", {})
    assert f'"id": {collection_id}' in text(collections)

    leaders = await mcp.call_tool("list_commanders", {"collection_id": collection_id})
    assert COMMANDER in text(leaders)

    found = await mcp.call_tool(
        "search_owned_cards",
        {"collection_id": collection_id, "commander": COMMANDER, "text": "damage"},
    )
    assert OFF_COLOR not in text(found)  # color identity applied, like the agent

    bad = await mcp.call_tool(
        "check_deck", {"collection_id": collection_id, "commander": COMMANDER, "cards": [OFF_COLOR]}
    )
    assert "outside the commander" in text(bad)

    saved = await mcp.call_tool(
        "save_deck",
        {
            "collection_id": collection_id,
            "commander": COMMANDER,
            "name": "From MCP",
            "picks": legal_picks(),
        },
    )
    assert '"card_count": 100' in text(saved)

    with pytest.raises(ToolError, match="not in this collection"):
        await mcp.call_tool(
            "check_deck", {"collection_id": collection_id, "commander": "Nobody", "cards": []}
        )


async def test_guide_prompt() -> None:
    prompt = await mcp_server.mcp.get_prompt("commander_deckbuilding_guide", {})
    assert "Deck shape" in str(prompt)
