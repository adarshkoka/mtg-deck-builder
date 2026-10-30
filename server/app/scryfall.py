"""Async Scryfall client for batch card lookups.

Uses POST /cards/collection (up to 75 identifiers per request, 2 requests/second).
Handles rate limiting, retry with exponential backoff, de-duplication, and an in-memory
TTL cache, and maps Scryfall's JSON into our own Pydantic models.
"""

import asyncio
import logging
import math
import random
import time
from collections.abc import Awaitable, Callable, Iterable
from typing import Any, Self
from uuid import UUID

import httpx
from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

from app.ratelimit import RateLimiter, Sleep

logger = logging.getLogger(__name__)

BASE_URL = "https://api.scryfall.com"
BATCH_SIZE = 75  # Scryfall's maximum identifiers per /cards/collection request
COLLECTION_MIN_INTERVAL = 0.5  # /cards/collection is limited to 2 requests/second
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_DELAY = 60.0  # never trust a server-sent delay beyond this
MAX_CACHED_SEARCHES = 500  # search results kept in memory (oldest dropped first)

type ProgressCallback = Callable[[int, int], Awaitable[None]]  # (batches_done, batches_total)


class ScryfallError(RuntimeError):
    pass


class CardIdentifier(BaseModel):
    """One Scryfall card identifier. Frozen so it can be a dict key (for de-duplication)."""

    model_config = ConfigDict(frozen=True)

    id: UUID | None = None
    multiverse_id: int | None = None
    name: str | None = None
    set: str | None = None
    collector_number: str | None = None

    def key(self) -> tuple[object, ...]:
        """Normalised key: 'Sol Ring' and 'sol ring ' are the same lookup."""
        name = " ".join(self.name.casefold().split()) if self.name else None
        set_code = self.set.lower() if self.set else None
        return (self.id, self.multiverse_id, name, set_code, self.collector_number)

    def to_request(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude_none=True)


class CardFace(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    mana_cost: str = ""
    type_line: str = ""
    oracle_text: str = ""
    power: str | None = None
    toughness: str | None = None
    image_uris: dict[str, str] | None = None


class ScryfallCard(BaseModel):
    """The fields we use from a Scryfall card object (everything else is ignored)."""

    model_config = ConfigDict(extra="ignore")

    id: UUID
    oracle_id: UUID | None = None
    name: str
    mana_cost: str = ""
    cmc: float = 0
    type_line: str = ""
    oracle_text: str = ""
    colors: list[str] = []
    color_identity: list[str] = []
    keywords: list[str] = []
    power: str | None = None
    toughness: str | None = None
    set: str
    set_name: str = ""
    collector_number: str
    rarity: str = ""
    multiverse_ids: list[int] = []
    legalities: dict[str, str] = {}
    image_uris: dict[str, str] | None = None
    card_faces: list[CardFace] | None = None
    prices: dict[str, str | None] = {}
    scryfall_uri: str = ""
    released_at: str = ""
    artist: str = ""

    @model_validator(mode="after")
    def fill_from_faces(self) -> Self:
        # Double-faced cards keep text, cost and images on each face, not on the card.
        if self.card_faces:
            if not self.oracle_text:
                self.oracle_text = "\n//\n".join(f.oracle_text for f in self.card_faces)
            if not self.mana_cost:
                self.mana_cost = self.card_faces[0].mana_cost
            if self.image_uris is None:
                self.image_uris = self.card_faces[0].image_uris
        return self

    def face_names(self) -> set[str]:
        names = {self.name.casefold()}
        names.update(f.name.casefold() for f in self.card_faces or [])
        return names

    def matches(self, ident: CardIdentifier) -> bool:
        if ident.id is not None:
            return ident.id == self.id
        if ident.multiverse_id is not None:
            return ident.multiverse_id in self.multiverse_ids
        if ident.set and ident.set.lower() != self.set:
            return False
        if ident.collector_number is not None:
            return ident.collector_number == self.collector_number
        return ident.name is not None and " ".join(ident.name.casefold().split()) in (
            self.face_names()
        )


class CollectionLookup(BaseModel):
    found: dict[CardIdentifier, ScryfallCard]
    not_found: list[CardIdentifier]


class SearchPage(BaseModel):
    """The result of a Scryfall search, possibly gathered from several pages."""

    total_cards: int  # how many cards match in total (may be more than we fetched)
    cards: list[ScryfallCard]
    pages_fetched: int
    has_more: bool


class TTLCache:
    """Tiny in-memory cache. Scryfall asks clients to cache card data for at least 24h."""

    def __init__(self, ttl_seconds: float = 24 * 3600, max_items: int = 50_000) -> None:
        self.ttl = ttl_seconds
        self.max_items = max_items
        self._items: dict[tuple[object, ...], tuple[float, ScryfallCard]] = {}

    def get(self, ident: CardIdentifier) -> ScryfallCard | None:
        item = self._items.get(ident.key())
        if item is None or time.monotonic() - item[0] > self.ttl:
            return None
        return item[1]

    def put(self, ident: CardIdentifier, card: ScryfallCard) -> None:
        self._items.pop(ident.key(), None)
        self._items[ident.key()] = (time.monotonic(), card)
        if len(self._items) > self.max_items:  # dicts keep insertion order: drop the oldest
            del self._items[next(iter(self._items))]


class ScryfallClient:
    def __init__(
        self,
        http: httpx.AsyncClient,
        *,
        cache: TTLCache | None = None,
        max_retries: int = 4,
        min_interval: float = COLLECTION_MIN_INTERVAL,
        sleep: Sleep = asyncio.sleep,  # injectable so tests don't really wait
    ) -> None:
        self._http = http
        self._cache = cache or TTLCache()
        self._max_retries = max_retries
        self._limiter = RateLimiter(min_interval, sleep)
        self._sleep = sleep
        self._search_cache: dict[tuple[str, str, int], tuple[float, SearchPage]] = {}

    @staticmethod
    def build_http_client(user_agent: str) -> httpx.AsyncClient:
        # Scryfall requires a User-Agent and an Accept header on every request.
        return httpx.AsyncClient(
            base_url=BASE_URL,
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            timeout=httpx.Timeout(30.0),
        )

    async def fetch_collection(
        self,
        identifiers: Iterable[CardIdentifier],
        on_progress: ProgressCallback | None = None,
    ) -> CollectionLookup:
        """Look up many cards; duplicates are sent once and cached cards aren't sent at all."""
        unique: dict[tuple[object, ...], CardIdentifier] = {}
        for ident in identifiers:
            unique.setdefault(ident.key(), ident)

        found: dict[CardIdentifier, ScryfallCard] = {}
        to_fetch: list[CardIdentifier] = []
        for ident in unique.values():
            if (cached := self._cache.get(ident)) is not None:
                found[ident] = cached
            else:
                to_fetch.append(ident)

        not_found: list[CardIdentifier] = []
        batches = [to_fetch[i : i + BATCH_SIZE] for i in range(0, len(to_fetch), BATCH_SIZE)]
        for done, batch in enumerate(batches, start=1):
            batch_found, batch_missing = await self._fetch_batch(batch)
            for ident, card in batch_found.items():
                self._cache.put(ident, card)
            found.update(batch_found)
            not_found.extend(batch_missing)
            if on_progress is not None:
                await on_progress(done, len(batches))

        logger.info(
            "Scryfall lookup: %d unique, %d from cache, %d batches, %d not found",
            len(unique),
            len(unique) - len(to_fetch),
            len(batches),
            len(not_found),
        )
        return CollectionLookup(found=found, not_found=not_found)

    async def _fetch_batch(
        self, batch: list[CardIdentifier]
    ) -> tuple[dict[CardIdentifier, ScryfallCard], list[CardIdentifier]]:
        body = await self._post_with_retry(
            "/cards/collection", {"identifiers": [i.to_request() for i in batch]}
        )
        try:
            cards = [ScryfallCard.model_validate(c) for c in body.get("data", [])]
            missing_keys = {
                CardIdentifier.model_validate(i).key() for i in body.get("not_found", [])
            }
        except ValidationError as exc:  # Scryfall changed shape or sent garbage
            raise ScryfallError(
                f"Unexpected Scryfall response: {exc.error_count()} errors"
            ) from exc
        return _match_cards(batch, cards, missing_keys)

    async def search_cards(
        self, query: str, *, max_pages: int = 1, order: str = "edhrec"
    ) -> SearchPage:
        """Run a Scryfall full-text search (GET /cards/search), following up to `max_pages`.

        Scryfall returns 175 cards per page and says whether more exist (`has_more`, plus
        a ready-made `next_page` URL). We follow those links until we have `max_pages`
        pages or there are no more. Results are cached, because Scryfall's data changes
        at most once a day.
        """
        key = (query, order, max_pages)
        cached = self._search_cache.get(key)
        if cached is not None and time.monotonic() - cached[0] < self._cache.ttl:
            return cached[1]

        cards: list[ScryfallCard] = []
        total = 0
        has_more = False
        pages = 0
        url: str | None = "/cards/search"
        params: dict[str, str] | None = {"q": query, "order": order}
        while url is not None and pages < max_pages:
            body = await self._request_with_retry("GET", url, params=params, allow_404=True)
            pages += 1
            if body is None:  # Scryfall answers 404 when nothing matches the query
                break
            try:
                cards.extend(ScryfallCard.model_validate(c) for c in body.get("data", []))
            except ValidationError as exc:
                raise ScryfallError("Unexpected Scryfall search response") from exc
            total = int(body.get("total_cards", len(cards)))
            has_more = bool(body.get("has_more"))
            next_page = body.get("next_page")
            # Only follow links back to the same API host: never let a response send us
            # to an arbitrary URL.
            url = next_page if has_more and self._same_host(next_page) else None
            params = None  # the next_page URL already contains the query

        page = SearchPage(total_cards=total, cards=cards, pages_fetched=pages, has_more=has_more)
        self._search_cache.pop(key, None)
        self._search_cache[key] = (time.monotonic(), page)
        if len(self._search_cache) > MAX_CACHED_SEARCHES:  # drop the oldest search
            del self._search_cache[next(iter(self._search_cache))]
        return page

    def _same_host(self, url: object) -> bool:
        if not isinstance(url, str):
            return False
        target, base = httpx.URL(url), self._http.base_url
        return target.scheme == base.scheme and target.host == base.host

    async def _post_with_retry(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = await self._request_with_retry("POST", path, json=payload)
        assert body is not None  # allow_404 is off, so a 404 raised instead
        return body

    async def _request_with_retry(
        self,
        method: str,
        url: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        allow_404: bool = False,
    ) -> dict[str, Any] | None:
        """One API call with pacing and retries. Returns None for a 404 if allow_404."""
        path = httpx.URL(url).path
        for attempt in range(self._max_retries + 1):
            await self._limiter.wait()
            try:
                response = await self._http.request(method, url, json=json, params=params)
            except httpx.TransportError as exc:  # timeouts, connection resets, DNS
                if attempt == self._max_retries:
                    raise ScryfallError(f"Scryfall unreachable: {exc}") from exc
                await self._sleep(_backoff(attempt))
                continue

            if response.status_code == 200:
                try:
                    return response.json()
                except ValueError as exc:
                    raise ScryfallError(f"Scryfall {path} returned invalid JSON") from exc
            if response.status_code == 404 and allow_404:
                return None
            if response.status_code not in RETRYABLE_STATUSES or attempt == self._max_retries:
                raise ScryfallError(f"Scryfall {path} returned HTTP {response.status_code}")

            # A 429 locks us out for ~30s; honour Retry-After when Scryfall sends it.
            delay = _retry_after(response) or (30.0 if response.status_code == 429 else 0)
            delay = min(max(delay, _backoff(attempt)), MAX_RETRY_DELAY)
            logger.warning("Scryfall HTTP %d, retrying in %.1fs", response.status_code, delay)
            await self._sleep(delay)
        raise AssertionError("unreachable")


def _match_cards(
    batch: list[CardIdentifier], cards: list[ScryfallCard], missing_keys: set[tuple[object, ...]]
) -> tuple[dict[CardIdentifier, ScryfallCard], list[CardIdentifier]]:
    """Pair returned cards with the identifiers that asked for them.

    Scryfall returns found cards in request order but skips missing ones, so positions
    shift. Match on the identifier's fields first, then pair leftovers that Scryfall did
    not list in `not_found`, in order (covers spellings Scryfall resolves, e.g. accents).
    """
    found: dict[CardIdentifier, ScryfallCard] = {}
    unclaimed = list(cards)
    for ident in batch:
        card = next((c for c in unclaimed if c.matches(ident)), None)
        if card is not None:
            found[ident] = card
            unclaimed.remove(card)

    leftovers = [i for i in batch if i not in found and i.key() not in missing_keys]
    if leftovers and len(unclaimed) == len(leftovers):
        found.update(zip(leftovers, unclaimed, strict=True))
    elif unclaimed:
        logger.warning("Could not pair %d Scryfall results with identifiers", len(unclaimed))
    return found, [i for i in batch if i not in found]


def _backoff(attempt: int) -> float:
    # Exponential backoff with jitter: ~1s, 2s, 4s, 8s... so retries don't arrive in lockstep.
    return float(2**attempt) + random.uniform(0, 0.5)


def _retry_after(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After")
    try:
        delay = float(value) if value is not None else None
    except ValueError:
        return None
    return delay if delay is not None and math.isfinite(delay) and delay >= 0 else None
