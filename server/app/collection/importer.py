"""Runs a collection import: match CSV rows to Scryfall cards and store what the user owns.

Safe to run more than once for the same job (a task queue may redeliver it): every write
is an upsert, so a re-run produces the same result instead of duplicates.
"""

import logging
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import ColumnElement, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.collection.csv_parser import CollectionRow
from app.db import Card, CollectionCard, ImportJob, SessionFactory
from app.embeddings import embed_missing_cards
from app.gemini_client import GeminiError, GeminiService
from app.scryfall import CardIdentifier, ScryfallCard, ScryfallClient

logger = logging.getLogger(__name__)

UPSERT_CHUNK = 500  # keeps each INSERT well under Postgres's 32k bind-parameter limit
LOOKUP_CHUNK = 1000


def identifier_for(row: CollectionRow) -> CardIdentifier:
    """Most precise Scryfall identifier the row supports."""
    if row.scryfall_id:
        return CardIdentifier(id=row.scryfall_id)
    if row.set_code and row.collector_number:
        return CardIdentifier(set=row.set_code, collector_number=row.collector_number)
    if row.set_code:
        return CardIdentifier(name=row.name, set=row.set_code)
    return CardIdentifier(name=row.name)


async def run_import(
    job_id: UUID, sessions: SessionFactory, scryfall: ScryfallClient
) -> int | None:
    """Run one import job. Returns the collection id if the import succeeded."""
    async with sessions() as session:
        job = await session.get(ImportJob, job_id)
        if job is None or job.status not in ("queued", "running"):
            logger.info("Import %s: nothing to do", job_id)
            return None
        job.status = "running"
        await session.commit()

        try:
            await _import(session, job, sessions, scryfall)
            job.status = "succeeded"
        except Exception:
            logger.exception("Import %s failed", job_id)
            await session.rollback()
            job = await session.get(ImportJob, job_id, populate_existing=True)
            assert job is not None
            job.status = "failed"
            job.error = "Import failed while matching cards. Try again later."
        job.finished_at = datetime.now(UTC).replace(tzinfo=None)
        await session.commit()
        return job.collection_id if job.status == "succeeded" else None


async def embed_collection(
    collection_id: int, sessions: SessionFactory, gemini: GeminiService | None
) -> None:
    """Embed a collection's cards for semantic search. Failures here never fail the import:
    search simply falls back to keywords until the embeddings exist."""
    if gemini is None:
        logger.info("Skipping embeddings for collection %s: no Gemini key", collection_id)
        return
    try:
        count = await embed_missing_cards(sessions, gemini, collection_id=collection_id)
        logger.info("Embedded %d new cards for collection %s", count, collection_id)
    except GeminiError as exc:
        logger.warning("Embedding collection %s stopped: %s", collection_id, exc)


async def _import(
    session: AsyncSession, job: ImportJob, sessions: SessionFactory, scryfall: ScryfallClient
) -> None:
    rows = [CollectionRow.model_validate(r) for r in job.rows]
    idents = {row.line: identifier_for(row) for row in rows}

    # 1. Cards already in our database need no Scryfall call at all.
    found = await _find_stored_cards(session, idents.values())
    await session.commit()  # don't hold a transaction open during slow API calls

    # 2. Everything else goes to Scryfall in batches (the client de-dupes and caches).
    async def report(done: int, total: int) -> None:
        # Separate short transaction so GET /imports/{id} sees progress while we work.
        async with sessions() as progress_session:
            progress_job = await progress_session.get(ImportJob, job.id)
            if progress_job is not None:
                progress_job.batches_done, progress_job.batches_total = done, total
                await progress_session.commit()

    missing = [i for i in idents.values() if i not in found]
    lookup = await scryfall.fetch_collection(missing, report)
    found.update(lookup.found)

    # 3. A printing we can't find (odd promo set code, typo'd number) still means the
    #    user owns the card, so fall back to a plain name lookup. Same if the printing
    #    exists but is a different card than the row names ("Lightning Bolt, c21, 263").
    retry: dict[int, CardIdentifier] = {}
    for row in rows:
        by_name = CardIdentifier(name=row.name)
        card = found.get(idents[row.line])
        if idents[row.line] != by_name and (card is None or not _same_name(row, card)):
            retry[row.line] = by_name
    if retry:
        found.update((await scryfall.fetch_collection(retry.values())).found)
        for line, ident in retry.items():
            idents[line] = ident  # the name lookup wins; unmatched rows become not_found

    # 4. Store cards, then owned quantities. Rows for the same card add up.
    quantities: Counter[UUID] = Counter()
    not_found: list[dict[str, Any]] = []
    for row in rows:
        card = found.get(idents[row.line])
        if card is None:
            not_found.append({"line": row.line, "name": row.name})
        else:
            quantities[card.id] += row.quantity

    await _upsert_cards(session, {card.id: card for card in found.values()}.values())
    await _upsert_owned(session, job.collection_id, quantities)

    job.not_found = not_found
    job.unique_cards = len(quantities)
    logger.info(
        "Import %s: %d unique cards, %d rows not found", job.id, len(quantities), len(not_found)
    )


async def _find_stored_cards(
    session: AsyncSession, idents: Iterable[CardIdentifier]
) -> dict[CardIdentifier, ScryfallCard]:
    idents = set(idents)
    ids = sorted({i.id for i in idents if i.id})
    printings = sorted(
        {(i.set, i.collector_number) for i in idents if i.set and i.collector_number}
    )
    names = sorted({i.name.lower() for i in idents if i.name})

    # Chunked IN lists: one huge list hits Postgres's 32,767 bind-parameter limit.
    conditions: list[ColumnElement[bool]] = [
        *(Card.id.in_(chunk) for chunk in _chunks(ids, LOOKUP_CHUNK)),
        *(
            tuple_(Card.set_code, Card.collector_number).in_(chunk)
            for chunk in _chunks(printings, LOOKUP_CHUNK)
        ),
        *(func.lower(Card.name).in_(chunk) for chunk in _chunks(names, LOOKUP_CHUNK)),
    ]
    stored: dict[UUID, ScryfallCard] = {}
    for condition in conditions:
        for row in await session.scalars(select(Card).where(condition)):
            stored.setdefault(row.id, ScryfallCard.model_validate(row.data))

    # Index once, then match each identifier with a dict lookup (not a scan per identifier).
    by_printing = {(c.set, c.collector_number): c for c in stored.values()}
    by_name: dict[str, list[ScryfallCard]] = {}
    for card in stored.values():
        for name in card.face_names():
            by_name.setdefault(name, []).append(card)

    result: dict[CardIdentifier, ScryfallCard] = {}
    for ident in idents:
        card: ScryfallCard | None = None
        if ident.id:
            card = stored.get(ident.id)
        elif ident.set and ident.collector_number:
            card = by_printing.get((ident.set, ident.collector_number))
        elif ident.name:
            candidates = by_name.get(" ".join(ident.name.casefold().split()), [])
            card = next((c for c in candidates if not ident.set or c.set == ident.set), None)
        if card is not None:
            result[ident] = card
    return result


async def _upsert_cards(session: AsyncSession, cards: Iterable[ScryfallCard]) -> None:
    values = [_card_row(c) for c in cards]
    for chunk in _chunks(values, UPSERT_CHUNK):
        stmt = insert(Card).values(chunk)
        # ON CONFLICT DO UPDATE: refresh stored data instead of failing on known cards.
        stmt = stmt.on_conflict_do_update(
            index_elements=[Card.id],
            set_={col: stmt.excluded[col] for col in chunk[0] if col != "id"},
        )
        await session.execute(stmt)


async def _upsert_owned(session: AsyncSession, collection_id: int, qty: Counter[UUID]) -> None:
    values = [
        {"collection_id": collection_id, "card_id": cid, "quantity": n} for cid, n in qty.items()
    ]
    for chunk in _chunks(values, UPSERT_CHUNK):
        stmt = insert(CollectionCard).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=[CollectionCard.collection_id, CollectionCard.card_id],
            set_={"quantity": stmt.excluded.quantity},
        )
        await session.execute(stmt)


def _same_name(row: CollectionRow, card: ScryfallCard) -> bool:
    return " ".join(row.name.casefold().split()) in card.face_names()


def _card_row(card: ScryfallCard) -> dict[str, Any]:
    return {
        "id": card.id,
        "oracle_id": card.oracle_id,
        "name": card.name,
        "set_code": card.set,
        "collector_number": card.collector_number,
        "mana_cost": card.mana_cost,
        "cmc": card.cmc,
        "type_line": card.type_line,
        "oracle_text": card.oracle_text,
        "colors": card.colors,
        "color_identity": card.color_identity,
        "legal_in_commander": card.legalities.get("commander") == "legal",
        "data": card.model_dump(mode="json"),
        "fetched_at": func.now(),
    }


def _chunks[T](items: Sequence[T], size: int) -> Iterable[Sequence[T]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]
