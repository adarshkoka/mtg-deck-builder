import httpx
import pytest

from app.scryfall import CardIdentifier, ScryfallClient, ScryfallError
from tests.fakes import FakeScryfall, card_json


def make_client(fake: FakeScryfall, sleeps: list[float]) -> ScryfallClient:
    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    http = httpx.AsyncClient(
        base_url="https://api.test", transport=httpx.MockTransport(fake.handler)
    )
    return ScryfallClient(http, sleep=fake_sleep)


async def test_batches_dedupes_and_reports_not_found() -> None:
    known = {f"card {i}": card_json(f"Card {i}", number=str(i)) for i in range(100)}
    fake = FakeScryfall(known)
    client = make_client(fake, sleeps=[])

    idents = [CardIdentifier(name=f"Card {i}") for i in range(100)]
    idents += [CardIdentifier(name="card 5 "), CardIdentifier(name="Not A Card")]  # dup + missing
    progress: list[tuple[int, int]] = []

    async def on_progress(done: int, total: int) -> None:
        progress.append((done, total))

    result = await client.fetch_collection(idents, on_progress)

    assert [len(r) for r in fake.requests] == [75, 26]  # 101 unique identifiers, 75 per batch
    assert progress == [(1, 2), (2, 2)]
    assert len(result.found) == 100
    assert [i.name for i in result.not_found] == ["Not A Card"]


async def test_second_lookup_is_served_from_cache() -> None:
    fake = FakeScryfall({"sol ring": card_json("Sol Ring")})
    client = make_client(fake, sleeps=[])
    await client.fetch_collection([CardIdentifier(name="Sol Ring")])
    result = await client.fetch_collection([CardIdentifier(name="Sol Ring")])
    assert len(fake.requests) == 1
    assert len(result.found) == 1


async def test_retries_on_429_and_503_then_succeeds() -> None:
    fake = FakeScryfall({"sol ring": card_json("Sol Ring")}, fail_with=[429, 503])
    sleeps: list[float] = []
    client = make_client(fake, sleeps)
    result = await client.fetch_collection([CardIdentifier(name="Sol Ring")])
    assert len(result.found) == 1
    assert sleeps[0] >= 30  # a 429 waits out Scryfall's 30-second lockout


async def test_gives_up_after_max_retries() -> None:
    fake = FakeScryfall({}, fail_with=[503] * 10)
    client = make_client(fake, sleeps=[])
    with pytest.raises(ScryfallError, match="503"):
        await client.fetch_collection([CardIdentifier(name="Sol Ring")])


async def test_client_errors_are_not_retried() -> None:
    fake = FakeScryfall({}, fail_with=[400, 400])
    client = make_client(fake, sleeps=[])
    with pytest.raises(ScryfallError, match="400"):
        await client.fetch_collection([CardIdentifier(name="Sol Ring")])
    assert fake.fail_with == [400]  # only one attempt was made


async def test_double_faced_card_matches_front_face_name_and_gets_face_text() -> None:
    dfc = card_json(
        "Delver of Secrets // Insectile Aberration",
        card_faces=[
            {"name": "Delver of Secrets", "mana_cost": "{U}", "oracle_text": "Transform..."},
            {"name": "Insectile Aberration", "oracle_text": "Flying"},
        ],
    )
    fake = FakeScryfall({"delver of secrets": dfc})
    client = make_client(fake, sleeps=[])
    result = await client.fetch_collection([CardIdentifier(name="Delver of Secrets")])
    (card,) = result.found.values()
    assert card.mana_cost == "{U}"
    assert card.oracle_text == "Transform...\n//\nFlying"


async def test_requests_are_spaced_by_the_rate_limiter() -> None:
    known = {f"card {i}": card_json(f"Card {i}") for i in range(200)}
    sleeps: list[float] = []
    client = make_client(FakeScryfall(known), sleeps)
    await client.fetch_collection([CardIdentifier(name=f"Card {i}") for i in range(200)])
    # 3 batches: the 2nd and 3rd each wait to keep requests >= 0.5s apart.
    assert len(sleeps) == 2
    assert all(0 < s <= 0.5 for s in sleeps)


async def test_huge_retry_after_is_capped() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"Retry-After": "86400"})

    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    http = httpx.AsyncClient(base_url="https://api.test", transport=httpx.MockTransport(handler))
    client = ScryfallClient(http, sleep=fake_sleep, max_retries=1)
    with pytest.raises(ScryfallError):
        await client.fetch_collection([CardIdentifier(name="Sol Ring")])
    assert max(sleeps) <= 60


async def test_garbage_response_becomes_scryfall_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>maintenance</html>")

    http = httpx.AsyncClient(base_url="https://api.test", transport=httpx.MockTransport(handler))
    with pytest.raises(ScryfallError, match="invalid JSON"):
        await ScryfallClient(http).fetch_collection([CardIdentifier(name="Sol Ring")])
