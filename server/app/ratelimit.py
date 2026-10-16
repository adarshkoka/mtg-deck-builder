"""A small async rate limiter shared by every outbound API client (Scryfall, Gemini)."""

import asyncio
import time
from collections.abc import Awaitable, Callable

# A sleep function: asyncio.sleep in real code, a no-op in tests so they don't really wait.
type Sleep = Callable[[float], Awaitable[None]]


class RateLimiter:
    """Ensures at least `min_interval` seconds pass between calls that go through it.

    Callers do `await limiter.wait()` right before each request. If the previous request
    was too recent, wait() sleeps for the remaining time.

    This is per-process only: several worker processes would each pace themselves, so a
    multi-process deployment would need a shared limiter (for example, one kept in Redis).
    """

    def __init__(self, min_interval: float, sleep: Sleep = asyncio.sleep) -> None:
        self.min_interval = min_interval
        self._sleep = sleep
        self._lock = asyncio.Lock()
        self._last = float("-inf")

    async def wait(self) -> None:
        # The lock makes concurrent callers line up one at a time, so two tasks can't both
        # decide "enough time has passed" and fire together.
        async with self._lock:
            delay = self._last + self.min_interval - time.monotonic()
            if delay > 0:
                await self._sleep(delay)
            self._last = time.monotonic()
