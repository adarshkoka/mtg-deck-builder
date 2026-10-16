"""HTTP endpoints for AI deck building and saved decks.

The flow, with the human in the loop:
1. POST /decks/build              -> the agent starts building in the background (202)
2. GET  /decks/runs/{run_id}      -> poll: live trace while running, the deck when done
3. POST /decks/runs/{id}/revise   -> the user accepts/rejects cards and gives feedback;
                                     a new run revises the deck
4. POST /decks                    -> nothing is saved until the user approves and saves
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.agent.llm import AgentModel
from app.agent.loop import TraceStep
from app.agent.models import CardPick, DeckRecommendation, DeckRequest
from app.agent.rules import CollectionIndex, can_be_commander, check_deck
from app.agent.service import (
    DeckRequestError,
    engine_label,
    run_deck_build,
    validate_request,
)
from app.collection.queries import all_owned_cards, collection_exists
from app.config import get_settings
from app.db import AgentRun, Deck, SessionFactory
from app.deps import ApiKeyRequired, Sessions, send_celery_task

logger = logging.getLogger(__name__)

# Longer than any healthy run (the worker's hard time limit is 15 minutes).
RUN_TIMEOUT = timedelta(minutes=20)

# A card name as sent by a client: bounded so a request can't carry huge strings.
CardName = Annotated[str, Field(min_length=1, max_length=200)]


def _utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)  # the database stores naive UTC times


router = APIRouter(prefix="/decks", tags=["decks"], dependencies=[ApiKeyRequired])


class BuildDeckBody(BaseModel):
    collection_id: int
    commander: CardName
    must_include: list[CardName] = Field(default=[], max_length=30)
    notes: str | None = Field(default=None, max_length=500)


class ReviseBody(BaseModel):
    accepted: list[CardName] = Field(default=[], max_length=99)
    rejected: list[CardName] = Field(default=[], max_length=99)
    feedback: str | None = Field(default=None, max_length=1000)


class RunAccepted(BaseModel):
    run_id: UUID


class AgentRunView(BaseModel):
    run_id: UUID
    parent_run_id: UUID | None
    collection_id: int
    status: str
    engine: str
    model: str
    request: DeckRequest
    trace: list[TraceStep]
    result: DeckRecommendation | None
    error: str | None
    model_calls: int
    input_tokens: int
    output_tokens: int
    created_at: datetime
    finished_at: datetime | None


class SaveDeckBody(BaseModel):
    collection_id: int
    name: str = Field(min_length=1, max_length=100)
    commander: str = Field(min_length=1, max_length=200)
    cards: list[CardPick] = Field(max_length=99)
    basic_lands: dict[str, Annotated[int, Field(ge=0, le=99)]] = {}
    source_run_id: UUID | None = None


class SavedDeck(BaseModel):
    id: int
    collection_id: int
    name: str
    commander: str
    cards: list[CardPick]
    basic_lands: dict[str, int]
    source_run_id: UUID | None
    created_at: datetime
    card_count: int
    complete: bool  # exactly 100 cards


# --- Agent runs ---------------------------------------------------------------------------


@router.post("/build", status_code=202)
async def build_deck(
    body: BuildDeckBody, request: Request, sessions: Sessions, background: BackgroundTasks
) -> RunAccepted:
    """Start an AI deck build. Poll GET /decks/runs/{run_id} for progress and the result."""
    deck_request = DeckRequest(**body.model_dump())
    await _check_request(sessions, deck_request)
    run_id = await _create_run(request, sessions, deck_request, parent=None)
    await _dispatch(request, sessions, background, run_id)
    return RunAccepted(run_id=run_id)


@router.get("/runs/{run_id}")
async def get_run(run_id: UUID, sessions: Sessions) -> AgentRunView:
    async with sessions() as session:
        run = await session.get(AgentRun, run_id)
        if run is None:
            raise HTTPException(404, "Run not found")
        # A run whose worker died (or hit the time limit) would otherwise show "running"
        # forever. Anything still unfinished after RUN_TIMEOUT is marked failed.
        if run.status in ("queued", "running") and run.created_at < _utcnow() - RUN_TIMEOUT:
            run.status, run.error = "failed", "The build timed out. Please start it again."
            run.finished_at = _utcnow()
            await session.commit()
    return _run_view(run)


@router.get("/runs")
async def list_runs(
    sessions: Sessions, collection_id: Annotated[int, Query()], limit: int = 20
) -> list[AgentRunView]:
    """Recent runs for a collection, newest first."""
    async with sessions() as session:
        runs = await session.scalars(
            select(AgentRun)
            .where(AgentRun.collection_id == collection_id)
            .order_by(AgentRun.created_at.desc())
            .limit(min(max(limit, 1), 100))
        )
        return [_run_view(r) for r in runs]


@router.post("/runs/{run_id}/revise", status_code=202)
async def revise_run(
    run_id: UUID,
    body: ReviseBody,
    request: Request,
    sessions: Sessions,
    background: BackgroundTasks,
) -> RunAccepted:
    """Ask the agent to revise a finished deck using the user's accept/reject feedback."""
    async with sessions() as session:
        parent = await session.get(AgentRun, run_id)
    if parent is None:
        raise HTTPException(404, "Run not found")
    if parent.status != "succeeded" or parent.result is None:
        raise HTTPException(409, "Only a finished, successful run can be revised")

    original = DeckRequest.model_validate(parent.request)
    # The user's latest decision wins: a must-include card they now reject is dropped.
    rejected = {name.casefold() for name in body.rejected}
    revision = original.model_copy(
        update={
            "must_include": [n for n in original.must_include if n.casefold() not in rejected],
            "previous": DeckRecommendation.model_validate(parent.result),
            "accepted": body.accepted,
            "rejected": body.rejected,
            "feedback": body.feedback,
        }
    )
    new_id = await _create_run(request, sessions, revision, parent=run_id)
    await _dispatch(request, sessions, background, new_id)
    return RunAccepted(run_id=new_id)


# --- Saved decks --------------------------------------------------------------------------


@router.post("", status_code=201)
async def save_deck(body: SaveDeckBody, sessions: Sessions) -> SavedDeck:
    """Save a deck the user approved. It's checked against the collection first."""
    async with sessions() as session:
        owned = await all_owned_cards(session, body.collection_id)
    index = CollectionIndex(owned)
    commander = index.find(body.commander)
    if commander is None or not can_be_commander(commander):
        raise HTTPException(422, f"'{body.commander}' is not an owned commander")

    # Saving a deck that is still short of 100 cards is allowed (work in progress), but
    # every card must be owned, singleton, and inside the commander's colors.
    check = check_deck(
        commander, [c.name for c in body.cards], body.basic_lands, index, require_complete=False
    )
    if not check.ok:
        raise HTTPException(422, {"message": "Deck has problems", "problems": check.problems})

    async with sessions() as session:
        if body.source_run_id is not None:
            run = await session.get(AgentRun, body.source_run_id)
            if run is None or run.collection_id != body.collection_id:
                raise HTTPException(422, "source_run_id doesn't match a run for this collection")
        deck = Deck(
            collection_id=body.collection_id,
            name=body.name,
            commander=commander.name,
            cards=[c.model_dump() for c in body.cards],
            basic_lands={k: v for k, v in body.basic_lands.items() if v > 0},
            source_run_id=body.source_run_id,
        )
        session.add(deck)
        await session.commit()
        await session.refresh(deck)  # load server-set columns like created_at
    return _deck_view(deck)


@router.get("")
async def list_decks(sessions: Sessions, collection_id: int | None = None) -> list[SavedDeck]:
    async with sessions() as session:
        query = select(Deck).order_by(Deck.created_at.desc())
        if collection_id is not None:
            query = query.where(Deck.collection_id == collection_id)
        return [_deck_view(d) for d in await session.scalars(query)]


@router.get("/{deck_id}")
async def get_deck(deck_id: int, sessions: Sessions) -> SavedDeck:
    async with sessions() as session:
        deck = await session.get(Deck, deck_id)
    if deck is None:
        raise HTTPException(404, "Deck not found")
    return _deck_view(deck)


@router.delete("/{deck_id}", status_code=204)
async def delete_deck(deck_id: int, sessions: Sessions) -> None:
    async with sessions() as session:
        deck = await session.get(Deck, deck_id)
        if deck is None:
            raise HTTPException(404, "Deck not found")
        await session.delete(deck)
        await session.commit()


# --- Helpers ------------------------------------------------------------------------------


async def _check_request(sessions: SessionFactory, deck_request: DeckRequest) -> None:
    """Reject impossible requests right away instead of failing later in the background."""
    async with sessions() as session:
        if not await collection_exists(session, deck_request.collection_id):
            raise HTTPException(404, "Collection not found")
        owned = await all_owned_cards(session, deck_request.collection_id)
    try:
        validate_request(deck_request, CollectionIndex(owned))
    except DeckRequestError as exc:
        raise HTTPException(422, str(exc)) from exc


async def _create_run(
    request: Request, sessions: SessionFactory, deck_request: DeckRequest, parent: UUID | None
) -> UUID:
    model: AgentModel | None = request.app.state.agent_model
    if (
        model is None
        and request.app.state.gemini is None
        and get_settings().agent_engine == "manual"
    ):
        raise HTTPException(503, "AI deck building is unavailable: GEMINI_API_KEY is not set")
    engine, model_name = engine_label(model)
    async with sessions() as session:
        run = AgentRun(
            collection_id=deck_request.collection_id,
            parent_run_id=parent,
            engine=engine,
            model=model_name,
            request=deck_request.model_dump(mode="json"),
        )
        session.add(run)
        await session.commit()
        return run.id


async def _dispatch(
    request: Request, sessions: SessionFactory, background: BackgroundTasks, run_id: UUID
) -> None:
    """Hand the run to the Celery worker, or run it in-process after the response."""
    model: AgentModel | None = request.app.state.agent_model
    if get_settings().task_runner == "celery" and model is None:
        try:
            await send_celery_task("deck.build", str(run_id))
            return
        except Exception as exc:
            logger.exception("Could not enqueue deck build %s", run_id)
            async with sessions() as session:
                run = await session.get(AgentRun, run_id)
                if run is not None:
                    run.status, run.error = "failed", "Task queue unavailable"
                    await session.commit()
            raise HTTPException(503, "Task queue unavailable, try again later") from exc
    background.add_task(
        run_deck_build,
        run_id,
        sessions,
        gemini=request.app.state.gemini,
        scryfall=request.app.state.scryfall,
        model=model,
    )


def _run_view(run: AgentRun) -> AgentRunView:
    return AgentRunView(
        run_id=run.id,
        parent_run_id=run.parent_run_id,
        collection_id=run.collection_id,
        status=run.status,
        engine=run.engine,
        model=run.model,
        request=DeckRequest.model_validate(run.request),
        trace=[TraceStep.model_validate(s) for s in run.trace],
        result=DeckRecommendation.model_validate(run.result) if run.result else None,
        error=run.error,
        model_calls=run.model_calls,
        input_tokens=run.input_tokens,
        output_tokens=run.output_tokens,
        created_at=run.created_at,
        finished_at=run.finished_at,
    )


def _deck_view(deck: Deck) -> SavedDeck:
    cards = [CardPick.model_validate(c) for c in deck.cards]
    count = 1 + len(cards) + sum(deck.basic_lands.values())
    return SavedDeck(
        id=deck.id,
        collection_id=deck.collection_id,
        name=deck.name,
        commander=deck.commander,
        cards=cards,
        basic_lands=deck.basic_lands,
        source_run_id=deck.source_run_id,
        created_at=deck.created_at,
        card_count=count,
        complete=count == 100,
    )
