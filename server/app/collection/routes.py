"""HTTP endpoints for importing, browsing, and searching a card collection."""

import logging
from datetime import datetime
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from app.agent.rules import CollectionIndex
from app.collection.csv_parser import CsvFormatError, RowError, parse_collection_csv
from app.collection.importer import embed_collection, run_import
from app.collection.queries import (
    CardFilters,
    CollectionSummary,
    OwnedCard,
    all_owned_cards,
    collection_exists,
    commander_candidates,
    list_collections,
    search_owned_cards,
)
from app.collection.synergy import (
    SynergyResult,
    embed_query,
    embedding_coverage,
    find_synergy,
)
from app.config import get_settings
from app.db import Collection, ImportJob
from app.deps import ApiKeyRequired, Scryfall, Sessions, send_celery_task
from app.gemini_client import GeminiService

logger = logging.getLogger(__name__)

# Every endpoint in this router requires the X-API-Key header.
router = APIRouter(prefix="/collections", tags=["collections"], dependencies=[ApiKeyRequired])


class ImportAccepted(BaseModel):
    """Returned right after upload. The slow card matching continues in the background."""

    job_id: UUID  # poll GET /collections/imports/{job_id} with this
    collection_id: int
    source_format: str
    rows_accepted: int
    row_errors: list[RowError]


class ImportStatus(BaseModel):
    """Progress of a background import, read from the import_jobs row the worker updates."""

    job_id: UUID
    collection_id: int
    status: Literal["queued", "running", "succeeded", "failed"]
    batches_done: int
    batches_total: int
    unique_cards: int
    row_errors: list[RowError]
    not_found: list[dict[str, Any]]
    error: str | None
    finished_at: datetime | None


class CardSearchParams(CardFilters):
    """Query-string parameters for listing cards: the filters plus pagination.

    FastAPI reads every field of this model from the query string. (It only does that
    when the model is the endpoint's single query parameter, so limit and offset live here.)
    """

    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0, le=100_000)


class OwnedCardsPage(BaseModel):
    total: int
    limit: int
    offset: int
    cards: list[OwnedCard]


@router.get("")
async def get_collections(sessions: Sessions) -> list[CollectionSummary]:
    """All uploaded collections, newest first."""
    async with sessions() as session:
        return await list_collections(session)


@router.post("/import", status_code=202)
async def import_collection(
    file: UploadFile,
    request: Request,
    sessions: Sessions,
    scryfall: Scryfall,
    background: BackgroundTasks,
    name: Annotated[str, Form(min_length=1, max_length=100)] = "My collection",
) -> ImportAccepted:
    """Upload a collection CSV. Returns at once; poll GET /collections/imports/{job_id}."""
    settings = get_settings()
    # Read one byte past the limit so we can tell "exactly at the limit" from "too big".
    # (A reverse proxy should also cap request bodies; Starlette buffers the upload first.)
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(413, f"File larger than {settings.max_upload_bytes} bytes")

    # Validate every row. Whole-file problems are a 400; a file with no usable rows is a
    # 422 listing what's wrong; otherwise good rows import and bad rows are reported.
    try:
        parsed = parse_collection_csv(data, max_rows=settings.max_csv_rows)
    except CsvFormatError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not parsed.rows:
        raise HTTPException(
            422, {"message": "No valid rows", "row_errors": [e.model_dump() for e in parsed.errors]}
        )

    # Save the collection and the job (with its validated rows) in one transaction.
    # Postgres is the source of truth; the queue only carries the job id.
    async with sessions() as session:
        collection = Collection(name=name)
        session.add(collection)
        await session.flush()  # sends the INSERT now so collection.id is assigned
        job = ImportJob(
            collection_id=collection.id,
            source_format=parsed.format,
            rows=[r.model_dump(mode="json") for r in parsed.rows],
            row_errors=[e.model_dump() for e in parsed.errors],
        )
        session.add(job)
        await session.commit()

    if settings.task_runner == "celery":
        try:
            await send_celery_task("collection.import", str(job.id))
        except Exception as exc:
            # Without this, the job would sit in "queued" forever and the UI would poll
            # a job that never runs.
            logger.exception("Could not enqueue import %s", job.id)
            async with sessions() as session:
                failed = await session.get(ImportJob, job.id)
                if failed is not None:
                    failed.status, failed.error = "failed", "Import queue unavailable"
                    await session.commit()
            raise HTTPException(503, "Import queue unavailable, try again later") from exc
    else:
        # In-process runner: background tasks run one after another, so the embedding
        # starts after the import has finished.
        background.add_task(run_import, job.id, sessions, scryfall)
        background.add_task(embed_collection, collection.id, sessions, request.app.state.gemini)

    return ImportAccepted(
        job_id=job.id,
        collection_id=collection.id,
        source_format=parsed.format,
        rows_accepted=len(parsed.rows),
        row_errors=parsed.errors,
    )


@router.get("/imports/{job_id}")
async def import_status(job_id: UUID, sessions: Sessions) -> ImportStatus:
    """Progress of an import. The browser polls this to draw a progress bar."""
    async with sessions() as session:
        job = await session.get(ImportJob, job_id)
    if job is None:
        raise HTTPException(404, "Import job not found")
    return ImportStatus(
        job_id=job.id,
        collection_id=job.collection_id,
        status=job.status,  # pyright: ignore[reportArgumentType]  # validated by Pydantic
        batches_done=job.batches_done,
        batches_total=job.batches_total,
        unique_cards=job.unique_cards,
        row_errors=[RowError.model_validate(e) for e in job.row_errors],
        not_found=job.not_found,
        error=job.error,
        finished_at=job.finished_at,
    )


@router.get("/{collection_id}/cards")
async def owned_cards(
    collection_id: int,
    sessions: Sessions,
    params: Annotated[CardSearchParams, Query()],
) -> OwnedCardsPage:
    """Owned cards, alphabetical, filtered and paginated with limit/offset.

    Filters come from the query string, e.g.
    /collections/1/cards?type_line=Creature&identity_within=G&identity_within=U&max_cmc=3
    """
    filters = CardFilters.model_validate(params.model_dump(exclude={"limit", "offset"}))
    async with sessions() as session:
        if not await collection_exists(session, collection_id):
            raise HTTPException(404, "Collection not found")
        total, cards = await search_owned_cards(
            session, collection_id, filters, limit=params.limit, offset=params.offset
        )
    return OwnedCardsPage(total=total, limit=params.limit, offset=params.offset, cards=cards)


@router.get("/{collection_id}/commanders")
async def owned_commanders(collection_id: int, sessions: Sessions) -> list[OwnedCard]:
    """Owned cards that can be a deck's commander (one entry per card, not per printing)."""
    async with sessions() as session:
        if not await collection_exists(session, collection_id):
            raise HTTPException(404, "Collection not found")
        return await commander_candidates(session, collection_id)


@router.delete("/{collection_id}", status_code=204)
async def delete_collection(collection_id: int, sessions: Sessions) -> None:
    """Delete a collection. Its owned-card rows and import jobs go with it (ON DELETE CASCADE)."""
    async with sessions() as session:
        collection = await session.get(Collection, collection_id)
        if collection is None:
            raise HTTPException(404, "Collection not found")
        await session.delete(collection)
        await session.commit()


class LookupBody(BaseModel):
    names: list[str] = Field(min_length=1, max_length=250)


@router.post("/{collection_id}/cards/lookup")
async def lookup_cards(collection_id: int, body: LookupBody, sessions: Sessions) -> list[OwnedCard]:
    """Owned cards by exact name (one entry per name found; unknown names are skipped).

    The UI uses this to turn an AI recommendation (a list of names) into full card data.
    """
    async with sessions() as session:
        if not await collection_exists(session, collection_id):
            raise HTTPException(404, "Collection not found")
        index = CollectionIndex(await all_owned_cards(session, collection_id))
    found = (index.find(name) for name in body.names)
    return [card for card in found if card is not None]


class EmbeddingStatus(BaseModel):
    collection_id: int
    coverage: float  # 0-1: share of the collection's cards that semantic search can find
    queued: bool = False


@router.get("/{collection_id}/synergy")
async def synergy_cards(
    collection_id: int,
    request: Request,
    sessions: Sessions,
    commander: Annotated[str | None, Query(max_length=200)] = None,
    theme: Annotated[str | None, Query(max_length=300)] = None,
    limit: Annotated[int, Query(ge=1, le=60)] = 30,
) -> SynergyResult:
    """Owned cards that fit a commander (its rules text is the search) or a free-text theme.

    Uses hybrid retrieval (meaning + keywords) with no LLM call, so it's fast and free.
    """
    if not commander and not theme:
        raise HTTPException(422, "Pass a commander name or a theme")
    gemini: GeminiService | None = request.app.state.gemini
    async with sessions() as session:
        if not await collection_exists(session, collection_id):
            raise HTTPException(404, "Collection not found")
        leaders = await commander_candidates(session, collection_id) if commander else []
    leader = None
    if commander:
        leader = next((c for c in leaders if c.name.casefold() == commander.casefold()), None)
        if leader is None:
            raise HTTPException(422, f"'{commander}' is not an owned commander")
    # The search text: the commander's type line and rules text, plus any extra theme.
    parts: list[str] = []
    if leader is not None:
        parts.append(f"{leader.type_line}. {leader.oracle_text}")
    if theme:
        parts.append(theme)
    query = " ".join(parts)
    # Embed the query first, outside the database transaction (it can take a while).
    vector = await embed_query(gemini, query)
    async with sessions() as session:
        return await find_synergy(
            session,
            collection_id,
            query,
            identity_within=leader.color_identity if leader else ["W", "U", "B", "R", "G"],
            query_vector=vector,
            embedding_model=gemini.embedding_model if gemini else None,
            limit=limit,
            exclude_names={leader.name} if leader else set(),
        )


@router.get("/{collection_id}/embeddings")
async def embedding_status(
    collection_id: int, request: Request, sessions: Sessions
) -> EmbeddingStatus:
    """How much of the collection semantic search can see."""
    gemini: GeminiService | None = request.app.state.gemini
    async with sessions() as session:
        if not await collection_exists(session, collection_id):
            raise HTTPException(404, "Collection not found")
        model = gemini.embedding_model if gemini else get_settings().gemini_embedding_model
        coverage = await embedding_coverage(session, collection_id, model)
    return EmbeddingStatus(collection_id=collection_id, coverage=round(coverage, 4))


@router.post("/{collection_id}/embeddings", status_code=202)
async def start_embedding(
    collection_id: int, request: Request, sessions: Sessions, background: BackgroundTasks
) -> EmbeddingStatus:
    """Embed any of the collection's cards that don't have a vector yet (background job)."""
    gemini: GeminiService | None = request.app.state.gemini
    if gemini is None:
        raise HTTPException(503, "Embeddings need GEMINI_API_KEY")
    async with sessions() as session:
        if not await collection_exists(session, collection_id):
            raise HTTPException(404, "Collection not found")
        coverage = await embedding_coverage(session, collection_id, gemini.embedding_model)
    if get_settings().task_runner == "celery":
        try:
            await send_celery_task("collection.embed", str(collection_id))
        except Exception as exc:
            raise HTTPException(503, "Task queue unavailable, try again later") from exc
    else:
        background.add_task(embed_collection, collection_id, sessions, gemini)
    return EmbeddingStatus(collection_id=collection_id, coverage=round(coverage, 4), queued=True)
