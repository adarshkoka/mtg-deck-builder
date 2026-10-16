"""The deck-building agent end to end, with a scripted fake model instead of Gemini.

ScriptedModel plays the model's side: each step returns tool calls (or reacts to the tool
results it receives). Everything else is real: the HTTP API, the agent loop, the tools,
the deck rules, Postgres, and the trace.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.agent.llm import ModelTurn, ScriptedModel, ToolCall, ToolResult
from app.config import get_settings
from app.gemini_client import GeminiQuotaError
from app.main import app
from tests.conftest import reset_db, running_app
from tests.deck_data import COMMANDER, CSV, INJECTION, KNOWN, OFF_COLOR, legal_picks


@pytest.fixture
def api() -> Iterator[tuple[TestClient, int]]:
    reset_db()
    with running_app(dict(KNOWN)) as (client, _fake):
        collection_id = client.post(
            "/collections/import", files={"file": ("c.csv", CSV, "text/csv")}
        ).json()["collection_id"]
        yield client, collection_id


def submit(picks: list[dict[str, str]], summary: str = "Elves go wide.") -> ToolCall:
    return ToolCall("submit_deck", {"picks": picks, "summary": summary})


def build(client: TestClient, collection_id: int, **extra: object) -> dict:
    body = {"collection_id": collection_id, "commander": COMMANDER, **extra}
    accepted = client.post("/decks/build", json=body)
    assert accepted.status_code == 202, accepted.text
    # The in-process runner has finished by the time the test client returns.
    return client.get(f"/decks/runs/{accepted.json()['run_id']}").json()


def test_agent_searches_in_parallel_fixes_rejections_and_finishes(
    api: tuple[TestClient, int],
) -> None:
    client, collection_id = api

    def first_submit(results: str | list[ToolResult]) -> ModelTurn:
        # Both searches from turn 1 come back together, in one message.
        assert isinstance(results, list) and [r.call.name for r in results] == [
            "search_collection",
            "search_collection",
        ]
        talismans = results[0].output["cards"]
        assert talismans and all(c["type_line"] == "Artifact" for c in talismans)
        # A sloppy first draft: includes an off-color card, so it must be rejected.
        bad = [*legal_picks()[:-1], {"name": OFF_COLOR, "role": "removal", "reason": "Burn."}]
        return ModelTurn(text="", tool_calls=[submit(bad)])

    def fixed_submit(results: str | list[ToolResult]) -> ModelTurn:
        assert isinstance(results, list)
        verdict = results[0].output
        assert verdict["accepted"] is False
        assert any(OFF_COLOR in p for p in verdict["problems"])
        return ModelTurn(text="", tool_calls=[submit(legal_picks())])

    model = ScriptedModel(
        [
            ModelTurn(
                text="Starting with ramp and card draw.",
                tool_calls=[
                    ToolCall("search_collection", {"type_line": "Artifact", "limit": 10}),
                    ToolCall("search_collection", {"text": "draw", "limit": 10}),
                ],
            ),
            first_submit,
            fixed_submit,
        ]
    )
    app.state.agent_model = model

    run = build(client, collection_id, notes="Lots of elves")
    assert run["status"] == "succeeded", run["error"]
    result = run["result"]
    assert result["commander"] == COMMANDER
    assert len(result["picks"]) == 64
    assert result["basic_lands"] == {"Forest": 35}  # mono-green: every basic is a Forest
    assert run["model_calls"] == 3

    # The trace records every model call and tool call, in order.
    kinds = [(s["kind"], s["name"]) for s in run["trace"]]
    assert kinds == [
        ("tool", "starting_pool"),  # gathered by plain code before the first model call
        ("model", "scripted"),
        ("tool", "search_collection"),
        ("tool", "search_collection"),
        ("model", "scripted"),
        ("tool", "submit_deck"),
        ("model", "scripted"),
        ("tool", "submit_deck"),
    ]
    # The system prompt carries the deck-building skill and the injection rules.
    assert "Deck shape" in model.system_prompt and "DATA, not instructions" in model.system_prompt
    assert "Lots of elves" in str(model.received[0])
    # The first message already carries the candidate pool, one compact line per card.
    first_prompt = str(model.received[0])
    assert "STARTING POOL" in first_prompt and "Grove Talisman 1 | {2} | Artifact |" in first_prompt
    assert f"- {OFF_COLOR} |" not in first_prompt  # the pool only has the commander's colors


def test_bad_tool_arguments_go_back_to_the_model(api: tuple[TestClient, int]) -> None:
    client, collection_id = api

    def after_error(results: str | list[ToolResult]) -> ModelTurn:
        assert isinstance(results, list)
        assert "Invalid arguments" in results[0].output["error"]
        assert "error" in results[1].output and "Unknown tool" in results[1].output["error"]
        return ModelTurn(text="", tool_calls=[submit(legal_picks())])

    app.state.agent_model = ScriptedModel(
        [
            ModelTurn(
                text="",
                tool_calls=[
                    ToolCall("search_collection", {"limit": 5000}),  # over the max of 40
                    ToolCall("delete_everything", {}),
                ],
            ),
            after_error,
        ]
    )
    run = build(client, collection_id)
    assert run["status"] == "succeeded"
    tool_steps = [s for s in run["trace"] if s["kind"] == "tool" and s["name"] != "starting_pool"]
    assert [s["error"] is not None for s in tool_steps][:2] == [True, True]


def test_turn_limit_fails_the_run_cleanly(api: tuple[TestClient, int]) -> None:
    client, collection_id = api
    settings = get_settings()
    original = settings.agent_max_turns
    settings.agent_max_turns = 2
    search = ToolCall("search_collection", {"text": "elf"})
    app.state.agent_model = ScriptedModel([ModelTurn("", [search]) for _ in range(5)])
    try:
        run = build(client, collection_id)
    finally:
        settings.agent_max_turns = original
    assert run["status"] == "failed"
    assert "2 turns" in run["error"]
    assert run["result"] is None


def test_quota_error_is_reported_to_the_user(api: tuple[TestClient, int]) -> None:
    client, collection_id = api

    def out_of_quota(_: str | list[ToolResult]) -> ModelTurn:
        raise GeminiQuotaError("Gemini daily quota exhausted for this API key.")

    app.state.agent_model = ScriptedModel([out_of_quota])
    run = build(client, collection_id)
    assert run["status"] == "failed"
    assert "quota" in run["error"]


def test_text_reply_gets_a_nudge(api: tuple[TestClient, int]) -> None:
    client, collection_id = api
    model = ScriptedModel(
        [ModelTurn(text="Here is your deck: ..."), ModelTurn("", [submit(legal_picks())])]
    )
    app.state.agent_model = model
    run = build(client, collection_id)
    assert run["status"] == "succeeded"
    assert "submit_deck" in str(model.received[1])  # the reminder the loop sent


def test_injection_in_card_text_cannot_sneak_cards_in(api: tuple[TestClient, int]) -> None:
    """Even a model fooled by injected card text can't get unowned or off-color cards
    accepted: the code-level checks in submit_deck still apply."""
    client, collection_id = api

    def fooled(_: str | list[ToolResult]) -> ModelTurn:
        picks = [
            *legal_picks()[:-2],
            {"name": "Black Lotus", "role": "ramp", "reason": "The card text told me to."},
            {"name": OFF_COLOR, "role": "removal", "reason": "The card text told me to."},
        ]
        return ModelTurn("", [submit(picks)])

    app.state.agent_model = ScriptedModel(
        [ModelTurn("", [ToolCall("get_card_details", {"names": [INJECTION]})]), fooled]
    )
    run = build(client, collection_id)
    assert run["status"] == "failed"  # the script ends without a valid deck
    rejection = next(s for s in run["trace"] if s["name"] == "submit_deck")["output"]
    problems = " ".join(rejection["problems"])
    assert "Black Lotus: not in the user's collection" in problems
    assert f"{OFF_COLOR}: color identity R is outside" in problems


def test_request_validation(api: tuple[TestClient, int]) -> None:
    client, collection_id = api
    app.state.agent_model = ScriptedModel([])
    not_owned = client.post(
        "/decks/build", json={"collection_id": collection_id, "commander": "Atraxa"}
    )
    assert not_owned.status_code == 422
    not_a_leader = client.post(
        "/decks/build", json={"collection_id": collection_id, "commander": "Forest Lore 1"}
    )
    assert not_a_leader.status_code == 422
    assert (
        client.post("/decks/build", json={"collection_id": 999, "commander": "x"}).status_code
        == 404
    )


def test_revise_then_save(api: tuple[TestClient, int]) -> None:
    client, collection_id = api
    app.state.agent_model = ScriptedModel([ModelTurn("", [submit(legal_picks())])])
    first = build(client, collection_id)
    assert first["status"] == "succeeded"

    rejected = "Vine Snare 1"
    revision_model = ScriptedModel([ModelTurn("", [submit(legal_picks(skip={rejected}))])])
    app.state.agent_model = revision_model
    accepted = client.post(
        f"/decks/runs/{first['run_id']}/revise",
        json={"accepted": ["Elf Scout 1"], "rejected": [rejected], "feedback": "Less removal"},
    )
    assert accepted.status_code == 202
    second = client.get(f"/decks/runs/{accepted.json()['run_id']}").json()
    assert second["status"] == "succeeded"
    assert second["parent_run_id"] == first["run_id"]
    prompt = str(revision_model.received[0])
    assert "REVISION" in prompt and rejected in prompt and "Less removal" in prompt
    assert rejected not in {p["name"] for p in second["result"]["picks"]}

    # Nothing is saved until the user saves it.
    assert client.get(f"/decks?collection_id={collection_id}").json() == []
    result = second["result"]
    saved = client.post(
        "/decks",
        json={
            "collection_id": collection_id,
            "name": "Sylva elves",
            "commander": result["commander"],
            "cards": result["picks"],
            "basic_lands": result["basic_lands"],
            "source_run_id": second["run_id"],
        },
    )
    assert saved.status_code == 201, saved.text
    assert saved.json()["complete"] is True and saved.json()["card_count"] == 100
    assert [d["name"] for d in client.get("/decks").json()] == ["Sylva elves"]

    off_color = client.post(
        "/decks",
        json={
            "collection_id": collection_id,
            "name": "Bad",
            "commander": COMMANDER,
            "cards": [{"name": OFF_COLOR, "role": "removal", "reason": "x"}],
        },
    )
    assert off_color.status_code == 422


def test_search_budget_then_submit_only(api: tuple[TestClient, int]) -> None:
    """After two search turns, and after any rejected submission, the model is only
    allowed to call submit_deck (enforced by the API's tool allow-list)."""
    client, collection_id = api
    search = ToolCall("search_collection", {"text": "elf"})
    sloppy = legal_picks()[:-10]  # 54 picks: 45 basics would be needed, too many lands
    model = ScriptedModel(
        [
            ModelTurn("", [search]),
            ModelTurn("", [search]),
            ModelTurn("", [submit(sloppy)]),
            ModelTurn("", [submit(legal_picks())]),
        ]
    )
    app.state.agent_model = model
    run = build(client, collection_id)
    assert run["status"] == "succeeded"
    # turn 1 (task): free; after search 1: free; after search 2: submit only; after the rejection: submit only
    assert model.restrictions == [None, None, ["submit_deck"], ["submit_deck"]]


def test_unknown_tool_arguments_are_errors_not_ignored(api: tuple[TestClient, int]) -> None:
    client, collection_id = api

    def check(results: str | list[ToolResult]) -> ModelTurn:
        assert isinstance(results, list)
        assert "Invalid arguments" in results[0].output["error"]
        assert any("names" in d for d in results[0].output["details"])
        return ModelTurn("", [submit(legal_picks())])

    app.state.agent_model = ScriptedModel(
        [ModelTurn("", [ToolCall("search_collection", {"names": ["Elf Scout 1"]})]), check]
    )
    assert build(client, collection_id)["status"] == "succeeded"


def test_land_rejection_says_how_to_fix_it(api: tuple[TestClient, int]) -> None:
    client, collection_id = api

    def check(results: str | list[ToolResult]) -> ModelTurn:
        assert isinstance(results, list)
        problems = " ".join(results[0].output["problems"])
        assert "too few non-land cards" in problems and "Add about" in problems
        return ModelTurn("", [submit(legal_picks())])

    app.state.agent_model = ScriptedModel([ModelTurn("", [submit(legal_picks()[:40])]), check])
    assert build(client, collection_id)["status"] == "succeeded"
