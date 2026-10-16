"""Application settings, loaded once from environment variables and server/.env.

Every tunable value (model names, limits, keys) lives here, so changing behavior never
means hunting through the code. Real environment variables win over the .env file, which
lets Docker, CI, and production override anything.
"""

from functools import cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # --- Security -------------------------------------------------------------------
    # Clients must send this value in the X-API-Key header. If it isn't configured, the
    # protected endpoints refuse every request (fail closed) instead of running open.
    api_key: SecretStr | None = None
    # Browser origins allowed to call the API (the Vite dev server and the Docker web app).
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    # --- Gemini ---------------------------------------------------------------------
    # SecretStr keeps the key out of logs and error messages; .get_secret_value() reads it.
    gemini_api_key: SecretStr | None = None
    # No default on purpose: the model name lives in exactly one place (.env).
    gemini_model: str
    # Tried in order when the main model is overloaded (Google returns 503 "high
    # demand" on popular models at busy times). All must support function calling.
    gemini_fallback_models: list[str] = ["gemini-3.5-flash-lite"]
    # Embedding model for semantic card search, and the vector size we store.
    gemini_embedding_model: str = "gemini-embedding-2"
    embedding_dimensions: int = 768
    # Minimum seconds between Gemini calls from one process. The free tier allows only a
    # handful of requests per minute, so we pace ourselves instead of collecting 429s.
    gemini_min_interval_s: float = 4.0
    # Embedding requests are paced separately: each one embeds 25 cards, and the free
    # tier allows roughly 100 embedded texts per minute, so one request per 15 seconds
    # stays under the limit instead of tripping it and waiting out a 429.
    gemini_embed_min_interval_s: float = 15.0

    # --- Deck-building agent ----------------------------------------------------------
    # Which deck-building implementation runs: our hand-written agent loop, the same agent
    # on Pydantic AI, or the fixed LangGraph workflow.
    agent_engine: Literal["manual", "pydantic_ai", "langgraph"] = "manual"
    # Which LLM provider the Pydantic AI engine talks to.
    agent_provider: Literal["gemini", "anthropic"] = "gemini"
    # Hard cap on model calls per deck build, so a confused agent can't burn the quota.
    agent_max_turns: int = 8
    # Optional Claude support (only used when agent_provider == "anthropic").
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-sonnet-5"

    # --- Infrastructure ---------------------------------------------------------------
    database_url: str = "postgresql+asyncpg://mtg:mtg@localhost:5432/mtg"
    redis_url: str = "redis://localhost:6379/0"
    # "celery": long jobs run on the worker via Redis. "inline": run in the API process
    # after the response is sent (tests, or local dev without Redis).
    task_runner: Literal["celery", "inline"] = "celery"

    # Scryfall asks every client to identify itself.
    scryfall_user_agent: str = "MTGCommanderDeckBuilder/0.3"

    # Upload limits for collection CSVs (file contents are untrusted).
    max_upload_bytes: int = 5_000_000
    max_csv_rows: int = 50_000


@cache
def get_settings() -> Settings:
    return Settings()  # pyright: ignore[reportCallIssue]  # fields come from the environment
