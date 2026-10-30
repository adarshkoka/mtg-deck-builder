"""The other two deck-building engines:
- the Pydantic AI agent, driven by Pydantic AI's FunctionModel (a fake model whose
  replies come from a Python function)
- the LangGraph workflow, with a deterministic chooser in place of the LLM step
"""

from collections.abc import Iterator

import pytest
from pydantic import SecretStr
from pydantic_ai.messages import (
    ModelMessage,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.agent.langgraph_flow import ChooseRequest, build_graph, run_langgraph_deck
from app.agent.loop import TraceStep
from app.agent.models import CardPick, DeckRequest
from app.agent.pydantic_agent import make_model, run_pydantic_agent
from app.agent.service import build_context
from app.config import get_settings
from app.db import make_engine, make_session_factory
from tests.conftest import TEST_DATABASE_URL, reset_db, running_app
from tests.deck_data import COMMANDER, CSV, KNOWN, OFF_COLOR, legal_picks


@pytest.fixture
def collection_id() -> Iterator[int]:
    reset_db()
    with running_app(dict(KNOWN)) as (client, _fake):
        yield client.post("/collections/import", files={"file": ("c.csv", CSV, "text/csv")}).json()[
            "collection_id"
        ]


def scripted(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """Turn 1: search. Turn 2: an invalid deck. Turn 3 (after the retry): a valid deck."""
    output_tool = info.output_tools[0].name
    turn = sum(1 for m in messages if isinstance(m, ModelResponse)) + 1
    if turn == 1:
        assert {t.name for t in info.function_tools} >= {"search_collection", "check_deck_rules"}
        return ModelResponse(parts=[ToolCallPart("search_collection", {"type_line": "Artifact"})])
    if turn == 2:
        last = messages[-1].parts
        assert any(
            isinstance(p, ToolReturnPart) and p.tool_name == "search_collection" for p in last
        )
        bad = [*legal_picks()[:-1], {"name": OFF_COLOR, "role": "removal", "reason": "Burn"}]
        return ModelResponse(parts=[ToolCallPart(output_tool, {"picks": bad, "summary": "Elves"})])
    retry = [p for p in messages[-1].parts if isinstance(p, RetryPromptPart)]
    assert retry and OFF_COLOR in str(retry[0].content)  # our rules' problems came back
    return ModelResponse(
        parts=[ToolCallPart(output_tool, {"picks": legal_picks(), "summary": "Elves"})]
    )


async def test_pydantic_ai_agent_uses_our_tools_and_rules(collection_id: int) -> None:
    sessions = make_session_factory(make_engine(TEST_DATABASE_URL))
    ctx = await build_context(
        DeckRequest(collection_id=collection_id, commander=COMMANDER),
        sessions,
        gemini=None,
        scryfall=None,
    )
    steps: list[TraceStep] = []

    async def record(step: TraceStep) -> None:
        steps.append(step)

    outcome = await run_pydantic_agent(
        ctx, settings=get_settings(), on_step=record, model=FunctionModel(scripted)
    )
    assert outcome.model_calls == 3
    assert len(outcome.recommendation.picks) == 64
    assert outcome.recommendation.basic_lands == {"Forest": 35}
    assert [s.kind for s in steps][:2] == ["model", "tool"]
    assert steps[1].name == "search_collection"


def test_provider_switch_builds_the_right_model() -> None:
    settings = get_settings().model_copy(update={"agent_provider": "anthropic"})
    settings.anthropic_api_key = SecretStr("sk-test")
    assert type(make_model(settings)).__name__ == "AnthropicModel"
    settings.agent_provider = "gemini"
    settings.gemini_api_key = SecretStr("g-test")
    assert type(make_model(settings)).__name__ == "GoogleModel"


# --- LangGraph workflow ---------------------------------------------------------------


def greedy_chooser(sneak_in_bad_card: bool) -> tuple[list[ChooseRequest], object]:
    """Picks the first N candidates per role; optionally adds an off-color card first."""
    seen: list[ChooseRequest] = []

    async def choose(request: ChooseRequest) -> list[CardPick]:
        seen.append(request)
        taken = {p.name for p in request.keep}
        picks: list[CardPick] = []
        if sneak_in_bad_card and not request.keep:
            picks.append(CardPick(name=OFF_COLOR, role="removal", reason="bad"))
            taken.add(OFF_COLOR)
        needed = 64 - len(request.keep)
        for role, cards in request.candidates.items():
            for card in cards:
                if len(picks) >= needed or card.name in taken or card.name in request.avoid:
                    continue
                picks.append(CardPick(name=card.name, role=role, reason=f"{role} pick"))  # type: ignore[arg-type]
                taken.add(card.name)
        return picks

    return seen, choose


async def test_graph_builds_validates_and_revises(collection_id: int) -> None:
    sessions = make_session_factory(make_engine(TEST_DATABASE_URL))
    ctx = await build_context(
        DeckRequest(collection_id=collection_id, commander=COMMANDER),
        sessions,
        gemini=None,
        scryfall=None,
    )
    seen, choose = greedy_chooser(sneak_in_bad_card=True)
    outcome = await run_langgraph_deck(ctx, choose)  # type: ignore[arg-type]

    assert len(seen) == 2  # one choose call, one revise call after validation failed
    assert OFF_COLOR.casefold() in seen[1].avoid  # the revise step was told what to drop
    assert outcome.model_calls == 2
    names = {p.name for p in outcome.recommendation.picks}
    assert OFF_COLOR not in names
    assert sum(outcome.recommendation.basic_lands.values()) + len(names) == 99


def test_graph_shape() -> None:
    mermaid = build_graph(None, None).get_graph().draw_mermaid()  # type: ignore[arg-type]
    for node in ("plan_roles", "gather_candidates", "choose_cards", "validate", "revise"):
        assert node in mermaid
