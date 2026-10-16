"""Regression tests for problems found in code review: impossible requests, redelivered
and stuck runs, network failures, quota parsing, and untrusted search queries."""

from collections.abc import Iterator
from datetime import timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from google.genai import errors

from app.agent.llm import ModelTurn, ScriptedModel, ToolCall
from app.agent.tools import SuggestPurchasesArgs, suggest_purchases
from app.db import AgentRun, make_engine, make_session_factory
from app.gemini_client import (
    GeminiError,
    GeminiQuotaError,
    GeminiService,
    is_daily_quota_error,
    retry_delay_seconds,
)
from app.main import app
from app.scryfall import ScryfallClient
from tests.conftest import TEST_DATABASE_URL, reset_db, running_app
from tests.deck_data import BANNED, COMMANDER, CSV, KNOWN, OFF_COLOR, legal_picks, mtg_card
from tests.fakes import FakeScryfall
from tests.test_tools import _context


@pytest.fixture
def api() -> Iterator[tuple[TestClient, int]]:
    reset_db()
    with running_app(dict(KNOWN)) as (client, _fake):
        collection_id = client.post(
            "/collections/import", files={"file": ("c.csv", CSV, "text/csv")}
        ).json()["collection_id"]
        yield client, collection_id


@pytest.mark.parametrize(
    ("must_include", "reason"),
    [
        ([OFF_COLOR], "outside"),
        ([BANNED], "not legal"),
        ([COMMANDER], "is the commander"),
        (["Nonexistent Card"], "not in this collection"),
    ],
)
def test_impossible_must_includes_are_rejected_up_front(api, must_include, reason) -> None:
    client, collection_id = api
    app.state.agent_model = ScriptedModel([])  # would fail the test if it were ever called
    response = client.post(
        "/decks/build",
        json={"collection_id": collection_id, "commander": COMMANDER, "must_include": must_include},
    )
    assert response.status_code == 422
    assert reason in response.json()["detail"]


def test_revision_drops_rejected_must_includes_and_keeps_accepted_cards(api) -> None:
    client, collection_id = api
    keep, drop = "Elf Scout 1", "Vine Snare 1"
    app.state.agent_model = ScriptedModel(
        [ModelTurn("", [ToolCall("submit_deck", {"picks": legal_picks(), "summary": "x"})])]
    )
    first = client.post(
        "/decks/build",
        json={"collection_id": collection_id, "commander": COMMANDER, "must_include": [drop]},
    ).json()["run_id"]

    # The revision silently drops the accepted card: code must reject that.
    without_keep = [p for p in legal_picks(skip={drop, keep})]
    revision = ScriptedModel(
        [
            ModelTurn("", [ToolCall("submit_deck", {"picks": without_keep, "summary": "x"})]),
            ModelTurn(
                "", [ToolCall("submit_deck", {"picks": legal_picks(skip={drop}), "summary": "x"})]
            ),
        ]
    )
    app.state.agent_model = revision
    second = client.post(
        f"/decks/runs/{first}/revise", json={"accepted": [keep], "rejected": [drop]}
    ).json()["run_id"]
    run = client.get(f"/decks/runs/{second}").json()
    assert run["status"] == "succeeded"
    assert run["request"]["must_include"] == []  # the rejected must-include was dropped
    first_try = next(s for s in run["trace"] if s["name"] == "submit_deck")["output"]
    assert any(keep in p and "must be included" in p for p in first_try["problems"])


def test_save_rejects_unknown_source_run(api) -> None:
    client, collection_id = api
    response = client.post(
        "/decks",
        json={
            "collection_id": collection_id,
            "name": "x",
            "commander": COMMANDER,
            "cards": [],
            "source_run_id": "00000000-0000-0000-0000-000000000000",
        },
    )
    assert response.status_code == 422


async def test_redelivered_and_stuck_runs_end_as_failed(api) -> None:
    client, collection_id = api
    sessions = make_session_factory(make_engine(TEST_DATABASE_URL))
    async with sessions() as session:
        stuck = AgentRun(
            collection_id=collection_id,
            engine="manual",
            model="m",
            request={"collection_id": collection_id, "commander": COMMANDER},
            status="running",
        )
        session.add(stuck)
        await session.commit()
        run_id = stuck.id

    # A redelivered task for a run that already started is not re-run (no double spend).
    from app.agent.service import run_deck_build

    await run_deck_build(run_id, sessions, gemini=None, scryfall=None, model=ScriptedModel([]))
    async with sessions() as session:
        run = await session.get(AgentRun, run_id)
        assert run is not None and run.status == "failed" and "interrupted" in (run.error or "")

        # A run left "running" past the timeout is reported as failed when polled.
        run.status, run.error = "running", None
        run.created_at = run.created_at - timedelta(hours=1)
        await session.commit()
    polled = client.get(f"/decks/runs/{run_id}").json()
    assert polled["status"] == "failed" and "timed out" in polled["error"]


async def test_purchase_results_are_filtered_in_code() -> None:
    fake = FakeScryfall({})
    off_color = mtg_card("Red Dragon", "Creature — Dragon", "Flying.", "{R}", ["R"])
    banned = mtg_card("Banned Elf", "Creature — Elf", "x", "{G}", ["G"], legal=False)
    good = mtg_card("Good Elf", "Creature — Elf", "x", "{G}", ["G"])
    for card in (off_color, banned, good):
        card |= {"prices": {"usd": "1.00"}, "scryfall_uri": "https://scryfall.test"}
    fake.search_results = [off_color, banned, good]
    result = await suggest_purchases(
        _context(fake, []), SuggestPurchasesArgs(query="x) or (t:dragon")
    )
    assert [c.name for c in result.cards] == ["Good Elf"]


async def test_next_page_links_to_other_hosts_are_not_followed() -> None:
    requests: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(str(request.url))
        return httpx.Response(
            200,
            json={
                "total_cards": 2,
                "has_more": True,
                "next_page": "https://evil.test/steal",
                "data": [],
            },
        )

    async def no_sleep(_: float) -> None:
        return None

    http = httpx.AsyncClient(base_url="https://api.test", transport=httpx.MockTransport(handler))
    page = await ScryfallClient(http, sleep=no_sleep).search_cards("t:elf", max_pages=3)
    assert page.pages_fetched == 1 and len(requests) == 1


# --- Gemini error handling -----------------------------------------------------------------


def _api_error(code: int, details: list[dict[str, Any]]) -> errors.APIError:
    return errors.APIError(
        code, {"error": {"code": code, "status": "RESOURCE_EXHAUSTED", "details": details}}
    )


def test_quota_error_parsing() -> None:
    daily = _api_error(
        429, [{"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]
    )
    per_minute = _api_error(
        429, [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "34s"}]
    )
    assert is_daily_quota_error(daily) and not is_daily_quota_error(per_minute)
    assert retry_delay_seconds(per_minute) == 34.0


class _FakeModels:
    def __init__(self, failures: list[BaseException]) -> None:
        self.failures = failures
        self.calls = 0

    async def embed_content(self, **_: object) -> object:
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return type("R", (), {"embeddings": [type("E", (), {"values": [1.0]})()]})()


def _service(failures: list[BaseException]) -> tuple[GeminiService, _FakeModels]:
    models = _FakeModels(failures)
    client = type("C", (), {"aio": type("A", (), {"models": models})()})()

    async def no_sleep(_: float) -> None:
        return None

    service = GeminiService(
        client,  # type: ignore[arg-type]
        model="m",
        embedding_model="e",
        embedding_dimensions=1,
        min_interval=0,
        sleep=no_sleep,
    )
    return service, models


async def test_gemini_retries_network_errors_and_rate_limits() -> None:
    per_minute = _api_error(429, [{"retryDelay": "1s"}])
    service, models = _service([httpx.ConnectTimeout("slow"), per_minute])
    assert await service.embed(["x"]) == [[1.0]]
    assert models.calls == 3


async def test_gemini_daily_quota_and_persistent_outage_raise_clear_errors() -> None:
    daily = _api_error(
        429, [{"violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel"}]}]
    )
    service, models = _service([daily])
    with pytest.raises(GeminiQuotaError):
        await service.embed(["x"])
    # Remembered: the next call fails at once, without spending another request.
    with pytest.raises(GeminiQuotaError, match="reset at midnight Pacific"):
        await service.embed(["x"])
    assert models.calls == 1

    from app.gemini_client import QUOTA

    QUOTA.reset()
    service, _ = _service([httpx.ConnectError("down")] * 10)
    with pytest.raises(GeminiError, match="unreachable"):
        await service.embed(["x"])


# --- Overload handling: longer retries, then a fallback model at the start of a run ---------


class _ScriptedGemini:
    """Stands in for GeminiService.generate_content: fails per model as told, else answers."""

    def __init__(self, down: set[str]) -> None:
        self.down = down
        self.calls: list[str | None] = []

    async def __call__(self, contents, config, *, model=None):
        self.calls.append(model)
        if model in self.down:
            from app.gemini_client import GeminiUnavailableError

            raise GeminiUnavailableError(f"{model} overloaded")
        from google.genai import types

        part = types.Part(function_call=types.FunctionCall(name="search_collection", args={}))
        content = types.Content(role="model", parts=[part])
        return types.GenerateContentResponse(candidates=[types.Candidate(content=content)])


async def test_conversation_falls_back_only_before_the_first_reply() -> None:
    from google.genai import types

    from app.agent.llm import GeminiConversation
    from app.gemini_client import GeminiUnavailableError

    service, _ = _service([])
    service.model, service.fallback_models = "main", ["lite"]
    fake = _ScriptedGemini(down={"main"})
    service.generate_content = fake  # type: ignore[method-assign]

    conversation = GeminiConversation(service, types.GenerateContentConfig())
    first = await conversation.send_user("build")
    assert first.model == "lite" and fake.calls == ["main", "lite"]

    # Later turns stay on the model that started the run, even if it becomes unavailable.
    fake.down = {"lite"}
    with pytest.raises(GeminiUnavailableError):
        await conversation.send_user("again")
    assert fake.calls[-1] == "lite"


async def test_overload_retries_wait_longer_then_report_clearly() -> None:
    from app.gemini_client import MAX_OVERLOAD_RETRIES, GeminiUnavailableError

    overloaded = errors.APIError(503, {"error": {"code": 503, "status": "UNAVAILABLE"}})
    service, models = _service([overloaded] * 20)
    with pytest.raises(GeminiUnavailableError, match="overloaded"):
        await service.embed(["x"])
    assert models.calls == MAX_OVERLOAD_RETRIES + 1


def test_compact_for_model_shrinks_card_lists() -> None:
    import json

    from app.agent.tools import compact_for_model

    output = {
        "total_matches": 1,
        "cards": [
            {
                "name": "Sol Ring",
                "mana_cost": "{1}",
                "cmc": 1,
                "type_line": "Artifact",
                "text": "{T}: Add {C}{C}.",
                "tags": ["ramp"],
            }
        ],
    }
    compact = compact_for_model(output)
    assert compact["cards"] == ["Sol Ring | {1} | Artifact | {T}: Add {C}{C}."]
    assert len(json.dumps(compact)) < len(json.dumps(output))
    assert compact_for_model({"accepted": True}) == {"accepted": True}  # non-card results untouched


async def test_quota_error_mid_run_restarts_on_the_fallback_model(api) -> None:
    """The main model runs out of quota during a build: the build restarts on the lite
    model and finishes there, and the main model isn't called again."""
    from google.genai import types

    from app.agent.models import DeckRequest
    from app.agent.service import _run_engine, build_context

    _client, collection_id = api
    service, _ = _service([])
    service.model, service.fallback_models = "main", ["lite"]
    calls: list[str | None] = []

    async def fake_generate(contents, config, *, model=None):
        calls.append(model)
        if model == "main" and len(calls) == 2:
            from app.gemini_client import QUOTA

            QUOTA.mark_exhausted("main")
            raise GeminiQuotaError("main daily quota exhausted")
        if len(calls) == 1 or (model == "lite" and calls.count("lite") == 1):
            call = types.FunctionCall(name="search_collection", args={"text": "draw"})
        else:
            call = types.FunctionCall(
                name="submit_deck", args={"picks": legal_picks(), "summary": "Elves."}
            )
        content = types.Content(role="model", parts=[types.Part(function_call=call)])
        return types.GenerateContentResponse(candidates=[types.Candidate(content=content)])

    service.generate_content = fake_generate  # type: ignore[method-assign]
    sessions = make_session_factory(make_engine(TEST_DATABASE_URL))
    ctx = await build_context(
        DeckRequest(collection_id=collection_id, commander=COMMANDER),
        sessions,
        gemini=None,
        scryfall=None,
    )

    async def ignore(_: object) -> None:
        return None

    outcome = await _run_engine(ctx, gemini=service, model=None, on_step=ignore)
    assert outcome.model_used == "lite"
    assert calls == ["main", "main", "lite", "lite"]
