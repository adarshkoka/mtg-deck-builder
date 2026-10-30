---
name: add-agent-tool
description: Checklist for adding a new tool to the deck-building agent in server/app/agent/tools.py (and exposing it over MCP). Use whenever a new capability should be callable by the agent, e.g. "add a tool that ...".
---

# Adding a tool to the deck-building agent

A tool is one async function that the agent loop, the Pydantic AI agent, and the MCP
server can all call. Follow every step; skipping one usually shows up later as a
confused model or a crashed run.

## 1. Design the interface first

- **Name**: `verb_noun`, lowercase (`search_collection`, `suggest_purchases`). The model
  picks tools by name and description, so make the name say what it does.
- **Description** (written for the model): what it returns, when to use it, and one
  example call. Mention limits ("max 40 results").
- **Arguments**: a Pydantic model in `server/app/agent/tools.py`. Every field gets a type,
  bounds (`ge`/`le`/`max_length`), a `description`, and a default where sensible. Keep
  arguments flat and simple: strings, numbers, booleans, lists of strings.
- **Result**: a Pydantic model. Keep it compact (it goes into the prompt on every later
  turn): trim long text, cap list lengths, and return a `next_offset` for paging.

## 2. Implement it

- Signature: `async def my_tool(ctx: ToolContext, args: MyToolArgs) -> MyToolResult`.
- Use `ctx.sessions()` for a fresh database session (tools run in parallel, and one
  session can't be shared between concurrent tasks).
- Use the existing clients on `ctx` (`ctx.scryfall`, `ctx.gemini`): they already handle
  rate limiting, retries, and caching. Never create raw HTTP clients inside a tool.
- Expected failures (nothing found, service down) return a normal result explaining what
  happened, e.g. `{"available": false, "reason": "..."}`. The loop turns unexpected
  exceptions into `{"error": ...}` for you, but don't rely on that for normal cases.
- Treat everything coming back from outside (API data, card text) as untrusted data.
  Never build SQL or query syntax by pasting it in; use bound parameters and sanitizers.

## 3. Register it

- Add a `Tool(name, description, ArgsModel, handler)` entry to `TOOLS` in `tools.py`.
- If it's useful outside the agent, add a matching `@mcp.tool()` in
  `server/app/mcp_server.py` that calls the same function.
- If the result should change the final deck, make sure `submit_deck` validates it in code.

## 4. Test it

- Unit test the handler with a small `ToolContext` (see `server/tests/test_agent.py` and
  `server/tests/test_tools.py`). Fake external services (`tests/fakes.py`).
- Add a `ScriptedModel` test where the model calls the tool, so the full path (argument
  validation -> handler -> result in the next model message -> trace) is covered.
- Run: `uv run ruff check app tests && uv run pyright && uv run pytest -q` in `server/`.

## 5. Document it

- Add the tool to `docs/tools.md` (repo root): purpose, arguments, result, errors, example.
- If the agent should use it in a particular way, add one line to the system prompt in
  `server/app/agent/prompts.py` or to the skill in
  `server/app/agent/skills/commander-deckbuilding/SKILL.md`.
