"""Runs one deck-building job from start to finish and records it in the database.

The API creates an `agent_runs` row (status "queued") and hands its id to the worker.
`run_deck_build` then:
1. loads the request and the user's collection,
2. runs the agent (the hand-written loop or the Pydantic AI version),
3. saves every trace step as it happens, so the UI can show live progress,
4. stores the final recommendation, or a readable error.
"""

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import cast, update
from sqlalchemy.dialects.postgresql import JSONB

from app.agent.llm import AgentModel, GeminiAgentModel
from app.agent.loop import AgentError, AgentOutcome, StepCallback, TraceStep, run_agent
from app.agent.models import DeckRequest
from app.agent.rules import BASIC_LANDS, CollectionIndex, can_be_commander, normalize_name
from app.agent.tools import TOOLS, ToolContext
from app.collection.queries import OwnedCard, all_owned_cards
from app.config import get_settings
from app.db import AgentRun, SessionFactory
from app.gemini_client import QUOTA, GeminiError, GeminiQuotaError, GeminiService
from app.scryfall import ScryfallClient

logger = logging.getLogger(__name__)


class DeckRequestError(ValueError):
    """The request can't be built (for example, the commander isn't in the collection)."""


def validate_request(request: DeckRequest, index: CollectionIndex) -> OwnedCard:
    """Check a request can produce a legal deck at all; return the commander.

    Catching an impossible request here (an off-color must-include, say) costs nothing.
    Letting the agent discover it would burn every model turn and still fail.
    """
    commander = index.find(request.commander)
    if commander is None:
        raise DeckRequestError(f"'{request.commander}' is not in this collection")
    if not can_be_commander(commander):
        raise DeckRequestError(f"'{commander.name}' can't be a commander")

    identity = set(commander.color_identity)
    problems: list[str] = []
    for name in request.must_include:
        card = index.find(name)
        if card is None:
            problems.append(f"{name}: not in this collection")
        elif normalize_name(card.name) == normalize_name(commander.name):
            problems.append(f"{card.name}: is the commander already")
        elif card.name in BASIC_LANDS:
            problems.append(f"{card.name}: basic lands are added automatically")
        elif not card.legal_in_commander:
            problems.append(f"{card.name}: not legal in Commander")
        elif not set(card.color_identity) <= identity:
            problems.append(f"{card.name}: outside {commander.name}'s colors")
    if problems:
        raise DeckRequestError("Can't include: " + "; ".join(problems))
    return commander


async def build_context(
    request: DeckRequest,
    sessions: SessionFactory,
    *,
    gemini: GeminiService | None,
    scryfall: ScryfallClient | None,
) -> ToolContext:
    """Load the collection once and resolve the commander, ready for the tools to use."""
    async with sessions() as session:
        owned = await all_owned_cards(session, request.collection_id)
    index = CollectionIndex(owned)
    commander = validate_request(request, index)
    return ToolContext(
        sessions=sessions,
        request=request,
        commander=commander,
        index=index,
        gemini=gemini,
        scryfall=scryfall,
    )


async def run_deck_build(
    run_id: UUID,
    sessions: SessionFactory,
    *,
    gemini: GeminiService | None,
    scryfall: ScryfallClient | None,
    model: AgentModel | None = None,  # tests pass a ScriptedModel here
) -> None:
    async with sessions() as session:
        run = await session.get(AgentRun, run_id)
        # Safe to call twice for the same run (a task queue can redeliver a task):
        # a finished run is left alone...
        if run is None or run.status not in ("queued", "running"):
            logger.info("Deck build %s: nothing to do", run_id)
            return
        # ...and a run that had already started when its worker died is marked failed
        # instead of re-run. Re-running would spend the model quota a second time, and a
        # run that crashes the worker would be redelivered forever. The user can retry.
        if run.status == "running":
            run.status, run.error = "failed", "The build was interrupted. Please start it again."
            run.finished_at = datetime.now(UTC).replace(tzinfo=None)
            await session.commit()
            return
        run.status = "running"
        request = DeckRequest.model_validate(run.request)
        await session.commit()

    async def save_step(step: TraceStep) -> None:
        # A short transaction per step, so GET /decks/runs/{id} shows progress immediately.
        # Postgres appends to the JSON array itself (jsonb "||"), so each step is one
        # small write instead of rewriting the whole trace every time.
        async with sessions() as step_session:
            new_step = cast([step.model_dump(mode="json")], JSONB)
            await step_session.execute(
                update(AgentRun)
                .where(AgentRun.id == run_id)
                .values(trace=AgentRun.trace.op("||")(new_step))
            )
            await step_session.commit()

    error: str | None = None
    outcome: AgentOutcome | None = None
    try:
        ctx = await build_context(request, sessions, gemini=gemini, scryfall=scryfall)
        outcome = await _run_engine(ctx, gemini=gemini, model=model, on_step=save_step)
    except GeminiQuotaError as exc:
        error = str(exc)  # shown to the user as-is: they need to know it's a quota problem
    except (DeckRequestError, AgentError, GeminiError) as exc:
        error = str(exc)
    except Exception:
        logger.exception("Deck build %s failed", run_id)
        error = "The deck build failed unexpectedly. Try again later."

    async with sessions() as session:
        run = await session.get(AgentRun, run_id)
        if run is None:
            return
        if outcome is not None:
            run.status = "succeeded"
            run.model = outcome.model_used or run.model
            run.result = outcome.recommendation.model_dump(mode="json")
            run.model_calls = outcome.model_calls
            run.input_tokens = outcome.input_tokens
            run.output_tokens = outcome.output_tokens
        else:
            run.status = "failed"
            run.error = error
            # After a fallback, the trace knows which model really ran.
            models = [s.get("name") for s in run.trace if s.get("kind") == "model"]
            if models and isinstance(models[-1], str):
                run.model = models[-1]
            # Token totals are still useful when a run fails; add them up from the trace.
            run.model_calls = sum(1 for s in run.trace if s.get("kind") == "model")
            run.input_tokens = sum(int(s.get("input_tokens", 0)) for s in run.trace)
            run.output_tokens = sum(int(s.get("output_tokens", 0)) for s in run.trace)
        run.finished_at = datetime.now(UTC).replace(tzinfo=None)
        await session.commit()
    logger.info("Deck build %s finished: %s", run_id, "succeeded" if outcome else error)


async def _run_engine(
    ctx: ToolContext,
    *,
    gemini: GeminiService | None,
    model: AgentModel | None,
    on_step: StepCallback,
) -> AgentOutcome:
    """Pick the agent implementation configured in settings and run it."""
    settings = get_settings()
    if model is None and settings.agent_engine == "langgraph":
        from app.agent.langgraph_flow import gemini_chooser, run_langgraph_deck

        if gemini is None:
            raise GeminiError("AI features are unavailable: GEMINI_API_KEY is not set")
        return await run_langgraph_deck(ctx, gemini_chooser(gemini))
    if model is None and settings.agent_engine == "pydantic_ai":
        from app.agent.pydantic_agent import run_pydantic_agent  # optional engine

        return await run_pydantic_agent(ctx, settings=settings, on_step=on_step)

    if model is not None:  # tests and evals supply their own model
        return await run_agent(
            ctx, model, max_turns=settings.agent_max_turns, tools=TOOLS, on_step=on_step
        )
    if gemini is None:
        raise GeminiError("AI features are unavailable: GEMINI_API_KEY is not set")
    try:
        return await run_agent(
            ctx,
            GeminiAgentModel(gemini),
            max_turns=settings.agent_max_turns,
            tools=TOOLS,
            on_step=on_step,
        )
    except GeminiQuotaError:
        # The main model ran out of daily quota partway through. Its conversation can't
        # move to another model (thought signatures are model-specific), so start the
        # build over on the first fallback model that still has quota.
        spare = next((m for m in gemini.fallback_models if not QUOTA.is_exhausted(m)), None)
        if spare is None:
            raise
        logger.warning("Restarting the build on %s after a quota error", spare)
        ctx.final, ctx.submit_attempts = None, 0
        return await run_agent(
            ctx,
            GeminiAgentModel(gemini, model=spare),
            max_turns=settings.agent_max_turns,
            tools=TOOLS,
            on_step=on_step,
        )


def engine_label(model: AgentModel | None) -> tuple[str, str]:
    """(engine, model name) stored on the run, so traces say what produced them."""
    settings = get_settings()
    if model is not None:
        return "manual", model.name
    if settings.agent_engine == "langgraph":
        return "langgraph", settings.gemini_model
    if settings.agent_engine == "pydantic_ai":
        name = (
            settings.anthropic_model
            if settings.agent_provider == "anthropic"
            else settings.gemini_model
        )
        return f"pydantic_ai:{settings.agent_provider}", name
    return "manual", settings.gemini_model
