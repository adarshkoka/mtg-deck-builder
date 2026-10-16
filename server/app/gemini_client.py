"""Async wrapper around the Gemini API (google-genai SDK).

Everything that talks to Gemini goes through GeminiService, so these concerns are
handled in one place:
- pacing: a rate limiter keeps us under the free tier's requests-per-minute limit
- retries: short "slow down" 429s and temporary 5xx errors are retried with backoff
- quota: a daily-quota 429 is turned into GeminiQuotaError, which callers show to the user
- async: we always use the SDK's async client (client.aio), so a slow model call never
  blocks the FastAPI event loop
"""

import asyncio
import logging
import random
import re
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
from google import genai
from google.genai import errors, types

from app.config import Settings
from app.ratelimit import RateLimiter, Sleep

logger = logging.getLogger(__name__)

MAX_RETRIES = 3  # for rate limits (429) and network errors
QUOTA_HINT = "Free-tier quotas reset at midnight Pacific time."
PACIFIC = ZoneInfo("America/Los_Angeles")
# Overload errors (500/503) usually clear within a minute, so they get more attempts:
# waits of about 2, 4, 8, 16 and 30 seconds.
MAX_OVERLOAD_RETRIES = 5
MAX_OVERLOAD_DELAY = 30.0
MAX_RETRY_DELAY = 60.0  # never wait longer than this on a single retry
# Give up on a single request after this long. Without it the SDK waits forever, and
# one stalled connection would block the (single) background worker.
REQUEST_TIMEOUT_MS = 120_000
# Texts per embedding request. One request is capped at 8,192 tokens in total, and a long
# card text is ~250 tokens, so 25 stays safely under the cap.
EMBED_BATCH_SIZE = 25


class GeminiError(RuntimeError):
    """Gemini failed in a way retrying won't fix right now."""


class GeminiQuotaError(GeminiError):
    """The API key's quota is used up (usually the free tier's daily limit)."""


class GeminiNotConfiguredError(GeminiError):
    """No GEMINI_API_KEY is set."""


class GeminiUnavailableError(GeminiError):
    """Google's servers are overloaded or down for this model (HTTP 500/503)."""


class QuotaMemory:
    """Remembers which models used up their daily quota, so we stop calling them.

    Once Google says a model's daily quota is gone, every further request today would
    just fail (and some quotas count failed requests too). Calls to a model in this list
    fail immediately, with no request, until the quota resets at midnight Pacific time.
    Kept in process memory: the single background worker process holds it across builds.
    """

    def __init__(self) -> None:
        self._exhausted_until: dict[str, datetime] = {}

    def mark_exhausted(self, model: str) -> None:
        self._exhausted_until[model] = _next_pacific_midnight()

    def reset(self) -> None:
        self._exhausted_until.clear()

    def is_exhausted(self, model: str) -> bool:
        until = self._exhausted_until.get(model)
        if until is None:
            return False
        if datetime.now(UTC) >= until:
            del self._exhausted_until[model]
            return False
        return True


def _next_pacific_midnight() -> datetime:
    now = datetime.now(PACIFIC)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return tomorrow.astimezone(UTC)


# Shared by every GeminiService in this process (each Celery task builds its own service).
QUOTA = QuotaMemory()


class GeminiService:
    def __init__(
        self,
        client: genai.Client,
        *,
        model: str,
        embedding_model: str,
        embedding_dimensions: int,
        min_interval: float,
        fallback_models: list[str] | None = None,
        embed_min_interval: float = 0.0,
        sleep: Sleep = asyncio.sleep,
    ) -> None:
        self._client = client
        self.model = model
        self.fallback_models = fallback_models or []
        self.embedding_model = embedding_model
        self.embedding_dimensions = embedding_dimensions
        self._limiter = RateLimiter(min_interval, sleep)
        self._embed_limiter = RateLimiter(embed_min_interval, sleep)
        self._sleep = sleep

    @classmethod
    def from_settings(cls, settings: Settings) -> GeminiService:
        if settings.gemini_api_key is None or not settings.gemini_api_key.get_secret_value():
            raise GeminiNotConfiguredError("GEMINI_API_KEY is not set")
        client = genai.Client(
            api_key=settings.gemini_api_key.get_secret_value(),
            http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS),
        )
        return cls(
            client,
            model=settings.gemini_model,
            embedding_model=settings.gemini_embedding_model,
            embedding_dimensions=settings.embedding_dimensions,
            min_interval=settings.gemini_min_interval_s,
            fallback_models=settings.gemini_fallback_models,
            embed_min_interval=settings.gemini_embed_min_interval_s,
        )

    async def generate_content(
        self,
        contents: list[types.Content],
        config: types.GenerateContentConfig,
        *,
        model: str | None = None,
    ) -> types.GenerateContentResponse:
        """One model call (one "turn"), with pacing and retries. Used by the agent loop."""
        chosen = model or self.model
        return await self._with_retries(
            lambda: self._client.aio.models.generate_content(
                model=chosen, contents=contents, config=config
            ),
            model=chosen,
        )

    async def generate_with_fallback(
        self, contents: list[types.Content], config: types.GenerateContentConfig
    ) -> tuple[types.GenerateContentResponse, str]:
        """Like generate_content, but if the main model is overloaded or out of quota, try
        the fallback models in order (each has its own quota). Returns the response and
        the model that produced it."""
        candidates = [self.model, *self.fallback_models]
        for i, model in enumerate(candidates):
            try:
                return await self.generate_content(contents, config, model=model), model
            except GeminiUnavailableError, GeminiQuotaError:
                if i == len(candidates) - 1:
                    raise
                logger.warning("%s is unavailable; falling back to %s", model, candidates[i + 1])
        raise AssertionError("unreachable")

    async def generate_text(self, prompt: str, *, system_instruction: str) -> str:
        """Send one prompt and return the plain-text answer."""
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        )
        content = types.Content(role="user", parts=[types.Part(text=prompt)])
        response, _ = await self.generate_with_fallback([content], config)
        return response.text or ""

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Turn texts into vectors (one vector per text), in batches."""
        vectors: list[list[float]] = []
        config = types.EmbedContentConfig(output_dimensionality=self.embedding_dimensions)
        for start in range(0, len(texts), EMBED_BATCH_SIZE):
            batch = texts[start : start + EMBED_BATCH_SIZE]
            # Each text must be its own Content. A plain list of strings is treated as ONE
            # multi-part input by gemini-embedding-2 and comes back as a single vector.
            contents: list[Any] = [types.Content(parts=[types.Part(text=t)]) for t in batch]
            response = await self._with_retries(
                lambda contents=contents: self._client.aio.models.embed_content(
                    model=self.embedding_model, contents=contents, config=config
                ),
                model=self.embedding_model,
                limiter=self._embed_limiter,
            )
            embeddings = response.embeddings or []
            if len(embeddings) != len(batch):
                raise GeminiError(f"Expected {len(batch)} embeddings, got {len(embeddings)}")
            vectors.extend(list(e.values or []) for e in embeddings)
        return vectors

    async def _with_retries[T](
        self,
        call: Callable[[], Awaitable[T]],
        *,
        model: str,
        limiter: RateLimiter | None = None,
    ) -> T:
        """Run `call()` (an async SDK call) with pacing, retry and quota handling."""
        if QUOTA.is_exhausted(model):
            # Known to be out of quota today: fail without spending a request.
            raise GeminiQuotaError(f"{model} daily quota exhausted. {QUOTA_HINT}")
        overloads = 0  # 500/503 answers so far; they get their own, longer retry budget
        attempt = 0  # rate-limit and network retries so far
        while True:
            await (limiter or self._limiter).wait()
            try:
                return await call()
            except httpx.TransportError as exc:
                # Network trouble (timeout, connection reset, DNS): worth a retry.
                if attempt == MAX_RETRIES:
                    raise GeminiError(f"Gemini unreachable: {type(exc).__name__}") from exc
                logger.warning("Gemini network error (%s), retrying", type(exc).__name__)
                await self._sleep(_backoff(attempt))
                attempt += 1
                continue
            except errors.APIError as exc:
                if exc.code == 429:
                    if is_daily_quota_error(exc):
                        QUOTA.mark_exhausted(model)
                        logger.warning("%s daily quota exhausted: %s", model, _quota_ids(exc))
                        raise GeminiQuotaError(
                            f"{model} daily quota exhausted. {QUOTA_HINT}"
                        ) from exc
                    delay = retry_delay_seconds(exc) or _backoff(attempt)
                elif exc.code in (500, 502, 503, 504):
                    # Overloaded or down. Wait it out for a while, then report it clearly.
                    if overloads == MAX_OVERLOAD_RETRIES:
                        raise GeminiUnavailableError(
                            "Gemini is overloaded right now (Google returned HTTP "
                            f"{exc.code}: high demand). Please try again in a few minutes."
                        ) from exc
                    delay = min(_backoff(overloads), MAX_OVERLOAD_DELAY)
                    overloads += 1
                    logger.warning("Gemini HTTP %s, retrying in %.1fs", exc.code, delay)
                    await self._sleep(delay)
                    continue
                else:
                    # 400 (bad request), 403 (bad key), 404 (unknown model): retrying won't help.
                    logger.warning("Gemini %s %s: %s", exc.code, exc.status, exc.message)
                    raise GeminiError(
                        f"Gemini request failed: {exc.code} {exc.status} ({exc.message})"
                    ) from exc

                if attempt == MAX_RETRIES:
                    raise GeminiQuotaError(
                        "Gemini rate limit hit repeatedly; the per-minute quota is exhausted."
                    ) from exc
                delay = min(delay, MAX_RETRY_DELAY)
                logger.warning("Gemini HTTP %s, retrying in %.1fs", exc.code, delay)
                await self._sleep(delay)
                attempt += 1


def _error_details(exc: errors.APIError) -> list[dict[str, Any]]:
    """The structured `details` list Google attaches to errors (quota info, retry hints)."""
    body = exc.details if isinstance(exc.details, dict) else {}
    error = body.get("error", body)
    details = error.get("details", []) if isinstance(error, dict) else []
    return [d for d in details if isinstance(d, dict)]


def _quota_ids(exc: errors.APIError) -> list[str]:
    """Which quotas a 429 names, for the logs (e.g. GenerateRequestsPerDay...)."""
    return [
        str(v.get("quotaId"))
        for detail in _error_details(exc)
        for v in detail.get("violations", [])
        if v.get("quotaId")
    ]


def is_daily_quota_error(exc: errors.APIError) -> bool:
    """True when the 429 says a per-day quota is used up (waiting a minute won't help)."""
    for detail in _error_details(exc):
        for violation in detail.get("violations", []):
            quota_id = str(violation.get("quotaId", ""))
            if "PerDay" in quota_id:
                return True
    return False


def retry_delay_seconds(exc: errors.APIError) -> float | None:
    """Read Google's suggested wait (RetryInfo.retryDelay, e.g. "34s") from a 429."""
    for detail in _error_details(exc):
        delay = detail.get("retryDelay")
        if isinstance(delay, str) and (match := re.fullmatch(r"(\d+(?:\.\d+)?)s", delay)):
            return float(match.group(1))
    return None


def _backoff(attempt: int) -> float:
    # Exponential backoff with jitter: about 2s, 4s, 8s, so retries don't arrive in lockstep.
    return float(2 ** (attempt + 1)) + random.uniform(0, 1)
