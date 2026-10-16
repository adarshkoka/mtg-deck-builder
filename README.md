# MTG Commander Deck Builder

Build a Commander deck from the cards you already own:

1. **Upload your collection** as a CSV (Moxfield, ManaBox, Archidekt, or any file with a `Name` column).
2. **Pick a commander** from the legendary creatures you own.
3. **An AI agent builds the deck** from your collection: 100 cards, legal, balanced, with
   a reason for every card. You watch every step it takes in a live trace.
4. **You review it**: reject cards, give feedback, let the agent revise, then save.

Manual deck building, card filters, and "find synergistic cards" work without the AI too.

## Architecture

```
React (Vite, Tailwind) ──X-API-Key──▶ FastAPI ─────────────┐
                                        │  202 + job id      │ reads
                                        ▼                    ▼
                                      Redis ──▶ Celery worker ──▶ Postgres + pgvector
                                                  │      │
                                     Scryfall API ◀┘      └▶ Gemini (agent, embeddings)

MCP server (stdio) ── same tools ──▶ Postgres   (for Claude Code / Claude Desktop)
```

- **Collection import** (`server/app/collection/`): per-row validated CSV parsing;
  batched Scryfall lookups (75 per request) with rate limiting, retry/backoff, caching, and
  de-duplication; Postgres as a persistent card cache; progress reporting.
- **Deck-building agent** (`server/app/agent/`): a hand-written tool-calling loop over
  Gemini with parallel tool calls, code-level validation of the final deck, and a
  step-by-step trace. The same agent is also built on Pydantic AI (Gemini or Claude), with
  a LangGraph workflow for comparison. See `docs/agent-frameworks.md`.
- **Semantic search** (`server/app/collection/synergy.py`): card embeddings in pgvector,
  hybrid retrieval (vector + full-text) merged with Reciprocal Rank Fusion.
- **Tools for other agents** (`server/app/mcp_server.py`): the collection and deck tools as
  an MCP server; registered for Claude Code in `.mcp.json`. See `docs/tools.md`.
- **Evals** (`server/evals/`): a golden set of collections scored on legality, ownership,
  trap cards (including a prompt injection), and balance; offline in CI, live on request.

## Quick start

```sh
cp server/.env.example server/.env           # add GEMINI_API_KEY and an API_KEY
cp mtg-deckbuilder/.env.example mtg-deckbuilder/.env.local   # same API_KEY as VITE_API_KEY
API_KEY=<your key> docker compose up --build
```

Then open http://localhost:3000. The API docs are at http://localhost:8080/docs.

For development without containers, see `server/README.md` and run the frontend with
`npm install && npm run dev` in `mtg-deckbuilder/`.

## Deployment

`docs/deploy.md` maps each container to Google Cloud (Cloud Run service and worker pool,
Cloud SQL with pgvector, Memorystore, Secret Manager) with the commands to deploy.
