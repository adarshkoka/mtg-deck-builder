"""The same deck-building agent, built with the Pydantic AI framework.

Compare with loop.py (the hand-written loop). Pydantic AI does the loop for us:
- it sends the conversation to the model, runs the tools the model asks for, sends
  the results back, and repeats
- `output_type` asks the model for a structured final answer (a SubmitDeckArgs object)
  and validates it with Pydantic
- the output validator below runs OUR deck rules on that answer; raising ModelRetry
  sends the problems back to the model, which tries again
- UsageLimits caps the number of model requests, like our max_turns

What stays ours: the tools (app/agent/tools.py), the rules (rules.py), and the prompts.
The model provider is a setting: the same agent runs on Gemini or Claude.
"""

import time
from typing import Any

from google.genai import types
from pydantic import ValidationError
from pydantic_ai import Agent, ModelRetry, RunContext, Tool
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded
from pydantic_ai.messages import ModelRequest, TextPart, ToolCallPart, ToolReturnPart
from pydantic_ai.models import Model
from pydantic_ai.usage import UsageLimits

from app.agent.loop import AgentError, AgentOutcome, StepCallback, TraceStep
from app.agent.prompts import build_system_prompt, build_user_prompt
from app.agent.tools import (
    FINAL_TOOL,
    TOOLS,
    SubmitDeckArgs,
    ToolContext,
    submit_deck,
    tool_result_json,
)
from app.collection.queries import CardFilters, search_owned_cards
from app.config import Settings
from app.gemini_client import GeminiError, GeminiQuotaError


def make_model(settings: Settings) -> Model:
    """The LLM to use, picked by the AGENT_PROVIDER setting."""
    if settings.agent_provider == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        if settings.anthropic_api_key is None:
            raise GeminiError("AGENT_PROVIDER=anthropic needs ANTHROPIC_API_KEY")
        return AnthropicModel(
            settings.anthropic_model,
            provider=AnthropicProvider(api_key=settings.anthropic_api_key.get_secret_value()),
        )

    from pydantic_ai.models.google import GoogleModel, GoogleModelSettings
    from pydantic_ai.providers.google import GoogleProvider

    if settings.gemini_api_key is None or not settings.gemini_api_key.get_secret_value():
        raise GeminiError("GEMINI_API_KEY is not set")
    return GoogleModel(
        settings.gemini_model,
        provider=GoogleProvider(api_key=settings.gemini_api_key.get_secret_value()),
        settings=GoogleModelSettings(
            google_thinking_config={"thinking_level": types.ThinkingLevel.MEDIUM}
        ),
    )


def _as_framework_tool(name: str) -> Tool[ToolContext]:
    """Wrap one of our tools so Pydantic AI can call it, keeping our schema and handler."""
    tool = TOOLS[name]

    async def call(run_ctx: RunContext[ToolContext], **kwargs: Any) -> dict[str, Any]:  # noqa: ANN401
        try:
            args = tool.args_model.model_validate(kwargs)
        except ValidationError as exc:
            # ModelRetry tells the framework to send this message back to the model.
            raise ModelRetry(
                f"Invalid arguments for {name}: {exc.error_count()} problem(s)"
            ) from exc
        return tool_result_json(await tool.handler(run_ctx.deps, args))

    return Tool.from_schema(
        call,
        name=tool.name,
        description=tool.description,
        json_schema=tool.parameters_schema(),
        takes_ctx=True,
    )


def build_agent(max_turns: int) -> Agent[ToolContext, SubmitDeckArgs]:
    agent: Agent[ToolContext, SubmitDeckArgs] = Agent(
        deps_type=ToolContext,
        # The structured final answer replaces our submit_deck tool.
        output_type=SubmitDeckArgs,
        instructions=build_system_prompt(max_turns).replace(
            "Finish by calling submit_deck", "Finish by returning the final deck"
        ),
        tools=[_as_framework_tool(name) for name in TOOLS if name != FINAL_TOOL],
        retries=3,  # how often a tool call or the final answer may be retried
    )

    @agent.output_validator
    async def validate_deck(
        run_ctx: RunContext[ToolContext], output: SubmitDeckArgs
    ) -> SubmitDeckArgs:
        # Same code-level checks as the hand-written loop's submit_deck tool.
        verdict = await submit_deck(run_ctx.deps, output)
        if not verdict.accepted:
            raise ModelRetry("Deck rejected. Fix these problems: " + "; ".join(verdict.problems))
        return output

    return agent


async def run_pydantic_agent(
    ctx: ToolContext,
    *,
    settings: Settings,
    on_step: StepCallback | None = None,
    model: Model | None = None,  # tests pass Pydantic AI's FunctionModel here
) -> AgentOutcome:
    agent = build_agent(settings.agent_max_turns)
    llm = model or make_model(settings)

    async with ctx.sessions() as session:
        total, _ = await search_owned_cards(
            session,
            ctx.request.collection_id,
            CardFilters(identity_within=ctx.commander.color_identity, commander_legal=True),
            limit=1,
        )
    prompt = build_user_prompt(ctx.request, ctx.commander, total)

    recorder = _Recorder(on_step, llm.model_name)
    try:
        # agent.iter() runs the same loop as agent.run(), but lets us watch each step
        # (model call, then tool calls) as it happens, to build the trace.
        async with agent.iter(
            prompt,
            model=llm,
            deps=ctx,
            usage_limits=UsageLimits(request_limit=settings.agent_max_turns),
        ) as run:
            async for node in run:
                await recorder.observe(node)
            result = run.result
    except UsageLimitExceeded as exc:
        raise AgentError(f"The agent used all {settings.agent_max_turns} turns: {exc}") from exc
    except ModelHTTPError as exc:
        if exc.status_code == 429:
            raise GeminiQuotaError(f"{llm.model_name} quota or rate limit exceeded") from exc
        raise GeminiError(f"{llm.model_name} request failed: HTTP {exc.status_code}") from exc

    if result is None or ctx.final is None:
        raise AgentError("The agent finished without a valid deck")
    usage = result.usage  # token and request counts for the whole run
    return AgentOutcome(
        recommendation=ctx.final,
        model_calls=usage.requests,
        input_tokens=usage.input_tokens or 0,
        output_tokens=usage.output_tokens or 0,
    )


class _Recorder:
    """Turns the framework's run steps into our TraceSteps."""

    def __init__(self, on_step: StepCallback | None, model_name: str) -> None:
        self._on_step = on_step
        self._model_name = model_name
        self._count = 0
        self._last = time.monotonic()

    async def observe(self, node: Any) -> None:  # noqa: ANN401  (the framework's node union)
        now = time.monotonic()
        elapsed = int((now - self._last) * 1000)
        self._last = now
        if Agent.is_call_tools_node(node):
            # The model just answered: record what it said and which tools it called.
            response = node.model_response
            calls = [p for p in response.parts if isinstance(p, ToolCallPart)]
            text = "".join(p.content for p in response.parts if isinstance(p, TextPart))
            await self._add(
                TraceStep(
                    step=0,
                    kind="model",
                    name=self._model_name,
                    duration_ms=elapsed,
                    output={
                        "text": text,
                        "tool_calls": [
                            {"name": c.tool_name, "args": c.args_as_dict()} for c in calls
                        ],
                    },
                    input_tokens=response.usage.input_tokens or 0,
                    output_tokens=response.usage.output_tokens or 0,
                )
            )
        elif Agent.is_model_request_node(node) and isinstance(node.request, ModelRequest):
            # The next request carries the results of the tools that just ran.
            for part in node.request.parts:
                if isinstance(part, ToolReturnPart):
                    await self._add(
                        TraceStep(
                            step=0,
                            kind="tool",
                            name=part.tool_name,
                            duration_ms=elapsed,  # time for the whole batch of tool calls
                            output=part.content
                            if isinstance(part.content, dict)
                            else str(part.content),
                        )
                    )

    async def _add(self, step: TraceStep) -> None:
        self._count += 1
        step.step = self._count
        if self._on_step is not None:
            await self._on_step(step)
