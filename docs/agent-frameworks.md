# Three ways to build the deck: loop, framework, graph

The app ships three interchangeable deck-building engines, selected with `AGENT_ENGINE`.
All three use the same tools (`app/agent/tools.py`), the same deck rules
(`app/agent/rules.py`), and return the same `DeckRecommendation`, so they can be compared
on the same evals (`uv run pytest evals`).

## 1. Hand-written agent loop (`AGENT_ENGINE=manual`, the default)
`app/agent/loop.py` + `app/agent/llm.py`

We call the Gemini API directly with function declarations, keep the conversation history
in a list, run every tool the model asks for in parallel (`asyncio.gather`), send the
results back, and stop when `submit_deck` accepts a deck or the turn cap is reached.

- Good: nothing hidden. Every message, retry, and token is under our control and in the
  trace. Easy to debug, no framework to learn, nothing to upgrade.
- Cost: we wrote what a framework gives for free (history, schema handling, retries).
  Supporting another provider means another `AgentModel` class.

## 2. Pydantic AI (`AGENT_ENGINE=pydantic_ai`, `AGENT_PROVIDER=gemini|anthropic`)
`app/agent/pydantic_agent.py`

The same agent with the loop handled by the framework. Our tools are registered with
their existing JSON schemas, the final answer is a typed `output_type`, and our deck rules
run in an output validator that raises `ModelRetry` to send problems back to the model.

- Good: much less code; switching between Gemini and Claude is one setting; structured
  output and usage limits are built in.
- Cost: less direct control over the exact messages; the trace is rebuilt from the
  framework's run steps; one more dependency to keep up to date.

## 3. LangGraph workflow (`AGENT_ENGINE=langgraph`)
`app/agent/langgraph_flow.py`

Not an open-ended agent: a fixed graph of steps. Plain code plans role targets and runs
every search in parallel, one LLM call chooses the cards, plain code validates, and a
conditional edge loops through a "revise" step (another LLM call) until the deck passes or
retries run out.

- Good: predictable cost (2-3 LLM calls instead of ~7), easy to test, and the overall
  shape is guaranteed.
- Cost: it can only consider candidates its fixed searches find. The evals caught exactly
  this: a two-color deck came up short until a "filler" search over the whole pool was added.

## When to use which

| Situation | Choice |
|---|---|
| The task is open-ended and the right steps depend on what the model finds | Agent loop (hand-written or framework) |
| You want an agent quickly, typed outputs, several LLM providers | Pydantic AI (or another agent framework) |
| The steps are known in advance and cost or auditability matter most | Graph / workflow (LangGraph) |
| You need full control and visibility over every model turn and tool call | Hand-written loop |

The deciding rule in all three: the model handles judgment (which cards fit), and code
handles everything that must be correct (legality, ownership, counts).
