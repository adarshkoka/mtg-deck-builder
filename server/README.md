# MTG Deck Builder API

FastAPI backend: collection import, collection search, the deck-building agent, semantic
search, saved decks, and an MCP server.

## Setup
Requires Python 3.14, [uv](https://docs.astral.sh/uv/), and Docker.

```sh
cp .env.example .env          # add GEMINI_API_KEY and API_KEY; GEMINI_MODEL picks the model
uv sync                       # creates .venv from uv.lock
docker compose up -d db redis # from the repo root
```

## Run
```sh
uv run uvicorn app.main:app --port 8080 --reload
uv run celery -A app.worker worker --loglevel=info --concurrency=1   # add --pool=solo on Windows
uv run python -m app.mcp_server                                       # MCP server (stdio)
```
Or run everything in containers: `docker compose up --build` from the repo root.
Without Redis, set `TASK_RUNNER=inline` to run background jobs inside the API process.

Every endpoint except `/health` needs the `X-API-Key` header (the `API_KEY` setting).

## Endpoints

Collections
- `POST /collections/import`: upload a CSV (multipart `file`, optional `name`). Returns `202`
  with a `job_id` and the rows that failed validation.
- `GET /collections/imports/{job_id}`: import status and batch progress.
- `GET /collections`: all collections with card counts.
- `GET /collections/{id}/cards`: owned cards, with filters `name`, `text`, `type_line`,
  `identity_within` (repeatable), `min_cmc`, `max_cmc`, `commander_legal`, plus `limit`/`offset`.
- `GET /collections/{id}/commanders`: owned cards that can be a commander.
- `POST /collections/{id}/cards/lookup`: owned cards by exact name.
- `GET /collections/{id}/synergy?commander=&theme=`: hybrid semantic + keyword search.
- `GET|POST /collections/{id}/embeddings`: embedding coverage, or start embedding.
- `DELETE /collections/{id}`

Decks
- `POST /decks/build`: start an agent run (`collection_id`, `commander`, `must_include`, `notes`). Returns `202` + `run_id`.
- `GET /decks/runs/{run_id}`: status, live trace, and the recommendation when finished.
- `POST /decks/runs/{run_id}/revise`: `accepted`, `rejected`, `feedback`; starts a revision run.
- `POST /decks`, `GET /decks?collection_id=`, `GET /decks/{id}`, `DELETE /decks/{id}`: saved decks.

## Code map
- `app/collection/`: CSV parsing, import job, queries, hybrid synergy search
- `app/agent/`: tools, rules, the agent loop, prompts, the Pydantic AI and LangGraph engines,
  and the deck-building skill (`skills/commander-deckbuilding/SKILL.md`)
- `app/scryfall.py`, `app/gemini_client.py`: external API clients (rate limiting, retries)
- `app/embeddings.py`: card embeddings in pgvector
- `app/mcp_server.py`: MCP server
- `../docs/`: tool reference (`tools.md`), engine comparison (`agent-frameworks.md`), deployment (`deploy.md`)

## Checks
```sh
uv run ruff check . && uv run ruff format --check .
uv run pyright
uv run pytest            # tests + offline evals; DB tests use TEST_DATABASE_URL (default: compose db, mtg_test)
uv run pytest evals -m live   # evals with the real Gemini model (uses API quota)
```
