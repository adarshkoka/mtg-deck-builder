"""The agent loop, written by hand.

This is the core idea of an AI agent: instead of our code deciding every step, the model
decides which tool to use next, based on what it has learned so far.

    send the task to the model
    repeat:
        the model replies with tool calls (or text)
        run every requested tool (in parallel)
        send the results back to the model
    until the model submits a deck that passes validation, or we run out of turns

Everything that happens is recorded as TraceSteps (what the model asked, what each tool
returned, how long it took), so a person can see exactly how the agent reached its answer.
"""

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, ValidationError

from app.agent.llm import AgentModel, ModelTurn, ToolCall, ToolResult
from app.agent.models import DeckRecommendation
from app.agent.pool import gather_pool, render_pool
from app.agent.prompts import NUDGE_TO_USE_TOOLS, build_system_prompt, build_user_prompt
from app.agent.tools import FINAL_TOOL, TOOLS, Tool, ToolContext, tool_result_json
from app.collection.queries import CardFilters, search_owned_cards
from app.observability import tracer

logger = logging.getLogger(__name__)

TRACE_TEXT_LIMIT = 4_000  # how much of each step's input/output is kept in the trace
# At most this many tool calls run at once, however many the model asks for in one
# turn. Each holds a database connection, and the pool is finite.
MAX_PARALLEL_TOOLS = 4
# Turns the model may spend searching before it must submit. Each turn is a request
# against a small daily quota, and the starting pool usually has everything needed.
MAX_SEARCH_TURNS = 2


class AgentError(RuntimeError):
    """The agent couldn't produce a valid deck."""


class TraceStep(BaseModel):
    """One step of a run, shown in the UI's trace view."""

    step: int
    kind: Literal["model", "tool"]
    name: str  # the model's name, or the tool's name
    duration_ms: int
    input: Any = None
    output: Any = None
    error: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0


class AgentOutcome(BaseModel):
    recommendation: DeckRecommendation
    model_used: str | None = None  # the model that produced the deck (after any fallback)
    model_calls: int
    input_tokens: int
    output_tokens: int


type StepCallback = Callable[[TraceStep], Awaitable[None]]


async def run_agent(
    ctx: ToolContext,
    model: AgentModel,
    *,
    max_turns: int,
    tools: dict[str, Tool] | None = None,
    on_step: StepCallback | None = None,
    starting_pool: bool = True,
) -> AgentOutcome:
    """Run the agent until it submits a valid deck. Raises AgentError if it can't."""
    tools = tools if tools is not None else TOOLS
    recorder = _Recorder(on_step)
    limit = asyncio.Semaphore(MAX_PARALLEL_TOOLS)

    async def run_limited(call: ToolCall) -> ToolResult:
        async with limit:
            return await _run_tool(recorder, ctx, tools, call)

    async with ctx.sessions() as session:
        total, _ = await search_owned_cards(
            session,
            ctx.request.collection_id,
            CardFilters(identity_within=ctx.commander.color_identity, commander_legal=True),
            limit=1,
        )

    with tracer.start_as_current_span("agent.run") as span:
        span.set_attribute("agent.model", model.name)
        span.set_attribute("agent.commander", ctx.commander.name)

        # Gather candidate cards with plain database queries before the first model call,
        # so the model can pick a deck right away instead of spending turns searching.
        pool_text = None
        if starting_pool:
            started = time.monotonic()
            try:
                pool = await gather_pool(ctx)
            except Exception:
                # The pool only saves turns; without it the model can still search.
                logger.exception("Starting pool failed; continuing without it")
                pool = {}
            pool_text = render_pool(pool) or None
            await recorder.add(
                TraceStep(
                    step=0,
                    kind="tool",
                    name="starting_pool",
                    duration_ms=_ms_since(started),
                    input={role: len(cards) for role, cards in pool.items()},
                    output=_clip(pool_text),
                )
            )

        conversation = model.start(
            build_system_prompt(max_turns, MAX_SEARCH_TURNS), list(tools.values())
        )
        user_prompt = build_user_prompt(ctx.request, ctx.commander, total, pool_text)

        # Turn 1: send the task.
        turn = await _model_call(
            recorder, model.name, lambda: conversation.send_user(user_prompt), user_prompt
        )
        model_calls = 1
        search_turns = 0  # turns that ran tools without submitting a deck

        def next_restriction() -> list[str] | None:
            # Once the search budget is spent, or a deck has been submitted and needs fixing,
            # the only allowed move is to submit (again). The pool has the replacements.
            if search_turns >= MAX_SEARCH_TURNS or ctx.submit_attempts > 0:
                return [FINAL_TOOL]
            return None

        while True:
            if not turn.tool_calls:
                # The model answered in text instead of using tools. Remind it how to finish.
                if model_calls >= max_turns:
                    break
                turn = await _model_call(
                    recorder,
                    model.name,
                    lambda: conversation.send_user(NUDGE_TO_USE_TOOLS, only_tools=[FINAL_TOOL]),
                    NUDGE_TO_USE_TOOLS,
                )
                model_calls += 1
                continue

            # Run every tool the model asked for at the same time. They're independent
            # (each opens its own database session), so there's no reason to wait for one
            # search to finish before starting the next.
            results = await asyncio.gather(*(run_limited(call) for call in turn.tool_calls))

            if ctx.final is not None:  # submit_deck accepted the deck: we're done
                span.set_attribute("agent.model_calls", model_calls)
                return AgentOutcome(
                    recommendation=ctx.final,
                    model_used=turn.model or model.name,
                    model_calls=model_calls,
                    input_tokens=recorder.input_tokens,
                    output_tokens=recorder.output_tokens,
                )
            if model_calls >= max_turns:
                break
            if all(call.name != FINAL_TOOL for call in turn.tool_calls):
                search_turns += 1

            # Send the results back; the model decides what to do next.
            only = next_restriction()
            turn = await _model_call(
                recorder,
                model.name,
                lambda results=results, only=only: conversation.send_tool_results(
                    list(results), only_tools=only
                ),
                f"{len(results)} tool result(s)" + (" (submit only)" if only else ""),
            )
            model_calls += 1

        span.set_attribute("agent.model_calls", model_calls)
        raise AgentError(
            f"The agent used all {max_turns} turns without submitting a valid deck "
            f"({ctx.submit_attempts} submission attempt(s))."
        )


async def _model_call(
    recorder: _Recorder,
    model_name: str,
    call: Callable[[], Awaitable[ModelTurn]],
    sent: str,
) -> ModelTurn:
    """Make one model call, timing it and recording it in the trace."""
    with tracer.start_as_current_span("agent.model_call") as span:
        started = time.monotonic()
        turn = await call()
        span.set_attribute("llm.input_tokens", turn.input_tokens)
        span.set_attribute("llm.output_tokens", turn.output_tokens)
        span.set_attribute("llm.tool_calls", len(turn.tool_calls))
    await recorder.add(
        TraceStep(
            step=0,
            kind="model",
            name=turn.model or model_name,
            duration_ms=_ms_since(started),
            input=_clip(sent),
            output={
                "text": _clip(turn.text),
                "tool_calls": [{"name": c.name, "args": c.args} for c in turn.tool_calls],
            },
            input_tokens=turn.input_tokens,
            output_tokens=turn.output_tokens,
        )
    )
    return turn


async def _run_tool(
    recorder: _Recorder, ctx: ToolContext, tools: dict[str, Tool], call: ToolCall
) -> ToolResult:
    """Run one tool call safely. Any problem becomes an error result the model can read."""
    started = time.monotonic()
    error: str | None = None
    with tracer.start_as_current_span(f"agent.tool.{call.name}"):
        tool = tools.get(call.name)
        if tool is None:
            error = f"Unknown tool '{call.name}'. Available tools: {', '.join(tools)}"
            output: dict[str, Any] = {"error": error}
        else:
            try:
                # Validate the model's arguments before running anything: the model can
                # send wrong types or missing fields, and that must not crash the run.
                args = tool.args_model.model_validate(call.args)
                output = tool_result_json(await tool.handler(ctx, args))
            except ValidationError as exc:
                error = f"Invalid arguments: {exc.error_count()} problem(s)"
                output = {"error": error, "details": _validation_summary(exc)}
            except Exception as exc:
                logger.exception("Tool %s failed", call.name)
                error = f"Tool failed: {type(exc).__name__}"
                output = {"error": error}

    await recorder.add(
        TraceStep(
            step=0,
            kind="tool",
            name=call.name,
            duration_ms=_ms_since(started),
            input=_clip(call.args),
            output=_clip(output),
            error=error,
        )
    )
    if call.name == FINAL_TOOL:
        logger.info("submit_deck attempt %d: %s", ctx.submit_attempts, output.get("message"))
    return ToolResult(call=call, output=output)


class _Recorder:
    """Numbers the trace steps, adds up token usage, and forwards each step to on_step."""

    def __init__(self, on_step: StepCallback | None) -> None:
        self._on_step = on_step
        self._count = 0
        self.input_tokens = 0
        self.output_tokens = 0
        self._lock = asyncio.Lock()  # parallel tools finish in any order; keep numbering tidy

    async def add(self, step: TraceStep) -> None:
        async with self._lock:
            self._count += 1
            step.step = self._count
            self.input_tokens += step.input_tokens
            self.output_tokens += step.output_tokens
            if self._on_step is not None:
                await self._on_step(step)


def _validation_summary(exc: ValidationError) -> list[str]:
    return [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()[:10]]


def _clip(value: object) -> object:
    """Keep trace entries small: long text or big results are cut off."""
    if isinstance(value, str):
        return value if len(value) <= TRACE_TEXT_LIMIT else value[:TRACE_TEXT_LIMIT] + "…"
    text = json.dumps(value, default=str)
    if len(text) <= TRACE_TEXT_LIMIT:
        return value
    return {"truncated": True, "preview": text[:TRACE_TEXT_LIMIT] + "…"}


def _ms_since(started: float) -> int:
    return int((time.monotonic() - started) * 1000)
