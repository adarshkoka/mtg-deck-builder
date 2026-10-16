"""The model side of the agent loop: a small interface plus a Gemini implementation.

The agent loop (loop.py) only needs two things from a model:
1. "here is the user's message, what do you want to do?"
2. "here are the results of the tools you asked for, what next?"
Each answer is a ModelTurn: some text and/or a list of tool calls.

Hiding the provider behind this interface means the loop doesn't care whether it talks
to Gemini, to another provider, or to ScriptedModel (a fake used by tests and evals).
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from google.genai import types

from app.agent.tools import Tool, compact_for_model
from app.gemini_client import GeminiError, GeminiService


@dataclass
class ToolCall:
    """The model asking us to run one tool."""

    name: str
    args: dict[str, Any]
    id: str | None = None  # some providers tag calls so results can be matched to them


@dataclass
class ToolResult:
    """What we send back after running a tool."""

    call: ToolCall
    output: dict[str, Any]


@dataclass
class ModelTurn:
    """One reply from the model."""

    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    model: str | None = None  # which model answered (can differ from the default on fallback)


class Conversation(Protocol):
    """One ongoing chat with a model. It remembers the history between calls."""

    # `only_tools` limits which tools the model may call on this turn (and makes it call
    # one): the loop uses it to say "no more searching, submit the deck now".
    async def send_user(self, text: str, *, only_tools: list[str] | None = None) -> ModelTurn: ...

    async def send_tool_results(
        self, results: list[ToolResult], *, only_tools: list[str] | None = None
    ) -> ModelTurn: ...


class AgentModel(Protocol):
    name: str

    def start(self, system_prompt: str, tools: Sequence[Tool]) -> Conversation: ...


# --- Gemini -------------------------------------------------------------------------------


class GeminiAgentModel:
    """Talks to Gemini with function calling, keeping the conversation history ourselves.

    Gemini's API is stateless: every call sends the whole conversation so far. We keep
    that history in a list and append to it after each turn.
    """

    def __init__(
        self,
        gemini: GeminiService,
        thinking_level: types.ThinkingLevel = types.ThinkingLevel.MEDIUM,
        *,
        model: str | None = None,  # pin a specific model (no fallback); default: the main one
    ) -> None:
        self._gemini = gemini
        self._thinking_level = thinking_level
        self._pinned = model
        self.name = model or gemini.model

    def start(self, system_prompt: str, tools: Sequence[Tool]) -> GeminiConversation:
        declarations = [
            types.FunctionDeclaration(
                name=tool.name,
                description=tool.description,
                parameters_json_schema=tool.parameters_schema(),
            )
            for tool in tools
        ]
        config = types.GenerateContentConfig(
            system_instruction=system_prompt,
            tools=[types.Tool(function_declarations=declarations)],
            # AUTO: the model decides each turn whether to call tools or answer in text.
            tool_config=types.ToolConfig(
                function_calling_config=types.FunctionCallingConfig(
                    mode=types.FunctionCallingConfigMode.AUTO
                )
            ),
            # We run the loop ourselves, so the SDK must never call functions on its own.
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
            thinking_config=types.ThinkingConfig(thinking_level=self._thinking_level),
        )
        return GeminiConversation(self._gemini, config, model=self._pinned)


class GeminiConversation:
    def __init__(
        self,
        gemini: GeminiService,
        config: types.GenerateContentConfig,
        *,
        model: str | None = None,
    ) -> None:
        self._gemini = gemini
        self._config = config
        # The full conversation: user messages, model replies, and tool results, in order.
        self.history: list[types.Content] = []
        # Chosen on the first call. If the main model is overloaded at that point, a
        # fallback model takes the whole run. We never switch models mid-conversation:
        # the hidden thought signatures in the history belong to the model that made them.
        self.model: str | None = model

    async def send_user(self, text: str, *, only_tools: list[str] | None = None) -> ModelTurn:
        self.history.append(types.Content(role="user", parts=[types.Part(text=text)]))
        return await self._call_model(only_tools)

    async def send_tool_results(
        self, results: list[ToolResult], *, only_tools: list[str] | None = None
    ) -> ModelTurn:
        # All results from one turn go back together in a single message, each tagged with
        # the tool's name (and call id) so the model knows which answer is which.
        parts = [
            types.Part(
                function_response=types.FunctionResponse(
                    id=r.call.id, name=r.call.name, response=compact_for_model(r.output)
                )
            )
            for r in results
        ]
        self.history.append(types.Content(role="user", parts=parts))
        return await self._call_model(only_tools)

    async def _call_model(self, only_tools: list[str] | None = None) -> ModelTurn:
        config = self._config
        if only_tools:
            # Mode ANY + an allow-list: Gemini must call one of these tools this turn.
            # Enforced by the API, so it's a guarantee, not a request the model can ignore.
            config = config.model_copy(
                update={
                    "tool_config": types.ToolConfig(
                        function_calling_config=types.FunctionCallingConfig(
                            mode=types.FunctionCallingConfigMode.ANY,
                            allowed_function_names=only_tools,
                        )
                    )
                }
            )
        if self.model is None:
            response, self.model = await self._gemini.generate_with_fallback(self.history, config)
        else:
            response = await self._gemini.generate_content(self.history, config, model=self.model)
        candidate = response.candidates[0] if response.candidates else None
        if candidate is None or candidate.content is None:
            reason = candidate.finish_reason if candidate else "no candidates"
            raise GeminiError(f"Gemini returned no content (finish reason: {reason})")

        # Append the model's reply exactly as received. It can contain hidden "thought
        # signatures" that Gemini needs to see again on the next call to keep reasoning
        # consistent across tool calls, so we never rebuild this message ourselves.
        self.history.append(candidate.content)

        parts = candidate.content.parts or []
        calls = [
            ToolCall(
                name=p.function_call.name or "",
                args=dict(p.function_call.args or {}),
                id=p.function_call.id,
            )
            for p in parts
            if p.function_call is not None
        ]
        text = "".join(p.text for p in parts if p.text and not p.thought)
        usage = response.usage_metadata
        return ModelTurn(
            text=text,
            tool_calls=calls,
            model=self.model,
            input_tokens=(usage.prompt_token_count or 0) if usage else 0,
            output_tokens=(
                (usage.candidates_token_count or 0) + (usage.thoughts_token_count or 0)
                if usage
                else 0
            ),
        )


# --- A scripted fake, for tests and evals -------------------------------------------------

# A script step receives what the loop just sent (the user text, or the list of tool
# results) and returns the model's next turn. Steps can therefore react to tool output,
# e.g. "submit whichever cards the search returned".
type ScriptStep = ModelTurn | Callable[[str | list[ToolResult]], ModelTurn]


class ScriptedModel:
    """A fake model that plays back a fixed script. No network, fully deterministic."""

    name = "scripted"

    def __init__(self, script: Sequence[ScriptStep]) -> None:
        self._script = list(script)
        self.received: list[str | list[ToolResult]] = []  # everything the loop sent
        self.restrictions: list[list[str] | None] = []  # the only_tools of each turn
        self.system_prompt = ""
        self.tool_names: list[str] = []

    def start(self, system_prompt: str, tools: Sequence[Tool]) -> ScriptedModel:
        self.system_prompt = system_prompt
        self.tool_names = [t.name for t in tools]
        return self

    async def send_user(self, text: str, *, only_tools: list[str] | None = None) -> ModelTurn:
        self.restrictions.append(only_tools)
        return self._next(text)

    async def send_tool_results(
        self, results: list[ToolResult], *, only_tools: list[str] | None = None
    ) -> ModelTurn:
        self.restrictions.append(only_tools)
        return self._next(results)

    def _next(self, message: str | list[ToolResult]) -> ModelTurn:
        self.received.append(message)
        if not self._script:
            return ModelTurn(text="(script finished)")
        step = self._script.pop(0)
        return step(message) if callable(step) else step
