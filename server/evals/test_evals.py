"""Run every engine on every golden case and score the decks.

uv run pytest evals            # offline: deterministic stand-ins for the LLM
uv run pytest evals -m live    # real Gemini (uses API quota: a few calls per case)
"""

import pytest

from app.agent.langgraph_flow import run_langgraph_deck
from app.agent.llm import AgentModel, GeminiAgentModel
from app.agent.loop import AgentError, AgentOutcome, TraceStep, run_agent
from app.agent.models import DeckRequest
from app.agent.service import build_context
from app.agent.tools import ToolContext
from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.gemini_client import GeminiService
from evals.checks import evaluate
from evals.conftest import LIVE_GEMINI_KEY, LIVE_GEMINI_MODEL, REPORTS
from evals.golden import GoldenCase
from evals.policy import PolicyModel, greedy_chooser
from tests.conftest import TEST_DATABASE_URL


async def _context(
    case: GoldenCase, collection_id: int, gemini: GeminiService | None = None
) -> ToolContext:
    sessions = make_session_factory(make_engine(TEST_DATABASE_URL))
    return await build_context(
        DeckRequest(collection_id=collection_id, commander=case.commander),
        sessions,
        gemini=gemini,
        scryfall=None,
    )


async def _run_loop(ctx: ToolContext, model: AgentModel) -> AgentOutcome:
    """Run the agent loop; if it fails, report the last submit_deck problems."""
    steps: list[TraceStep] = []

    async def record(step: TraceStep) -> None:
        steps.append(step)

    try:
        return await run_agent(ctx, model, max_turns=get_settings().agent_max_turns, on_step=record)
    except AgentError as exc:
        submits = [s.output for s in steps if s.name == "submit_deck"]
        pytest.fail(f"{exc} Last rejection: {submits[-1] if submits else 'no submission'}")


async def test_agent_loop(golden: tuple[GoldenCase, int]) -> None:
    case, collection_id = golden
    ctx = await _context(case, collection_id)
    outcome = await _run_loop(ctx, PolicyModel())
    report = evaluate(
        case, "loop", outcome.recommendation, ctx.index, model_calls=outcome.model_calls
    )
    REPORTS.append(report)
    assert report.passed, report.problems


async def test_langgraph_workflow(golden: tuple[GoldenCase, int]) -> None:
    case, collection_id = golden
    ctx = await _context(case, collection_id)
    outcome = await run_langgraph_deck(ctx, greedy_chooser)
    report = evaluate(
        case, "langgraph", outcome.recommendation, ctx.index, model_calls=outcome.model_calls
    )
    REPORTS.append(report)
    assert report.passed, report.problems


@pytest.mark.live
async def test_live_gemini_agent(golden: tuple[GoldenCase, int]) -> None:
    """The real model in the agent loop. Opt in with -m live; it spends API quota."""
    if not LIVE_GEMINI_KEY:
        pytest.skip("GEMINI_API_KEY is not set in server/.env")
    case, collection_id = golden
    from google import genai

    gemini = GeminiService(
        genai.Client(api_key=LIVE_GEMINI_KEY),
        model=LIVE_GEMINI_MODEL,
        embedding_model="gemini-embedding-2",
        embedding_dimensions=768,
        min_interval=4.0,
    )
    ctx = await _context(case, collection_id, gemini)
    outcome = await _run_loop(ctx, GeminiAgentModel(gemini))
    report = evaluate(
        case,
        "live",
        outcome.recommendation,
        ctx.index,
        model_calls=outcome.model_calls,
        tokens=outcome.input_tokens + outcome.output_tokens,
    )
    REPORTS.append(report)
    assert report.passed, report.problems
