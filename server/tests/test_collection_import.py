"""End-to-end import: upload CSV -> background import -> Postgres -> read owned cards.

Needs a Postgres database: set TEST_DATABASE_URL (default: the docker compose database
on localhost:5432, database mtg_test). Skipped if it can't connect.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from tests.conftest import reset_db, running_app
from tests.fakes import FakeScryfall, card_json

SOL_RING = card_json("Sol Ring", "c21", "263", color_identity=[], legalities={"commander": "legal"})
SIGNET = card_json("Arcane Signet", "m3c", "283", color_identity=[])
BOLT = card_json("Lightning Bolt", "2xm", "117", color_identity=["R"])

CSV = b"""Count,Name,Edition,Collector Number
2,Sol Ring,c21,263
1,sol ring,,
1,Arcane Signet,m3c,999
two,Command Tower,c21,
1,Not A Real Card,,
3,Lightning Bolt,,
"""


def test_health_needs_no_key() -> None:
    response = TestClient(app).get("/health")  # no X-API-Key header
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.fixture
def api() -> Iterator[tuple[TestClient, FakeScryfall]]:
    reset_db()
    with running_app({c["name"].lower(): c for c in (SOL_RING, SIGNET, BOLT)}) as pair:
        yield pair


def upload(client: TestClient, data: bytes = CSV):
    return client.post(
        "/collections/import",
        files={"file": ("collection.csv", data, "text/csv")},
        data={"name": "Test collection"},
    )


def test_import_matches_dedupes_and_reports(api: tuple[TestClient, FakeScryfall]) -> None:
    client, _ = api
    accepted = upload(client)
    assert accepted.status_code == 202
    body = accepted.json()
    assert body["rows_accepted"] == 5
    assert [e["line"] for e in body["row_errors"]] == [5]  # "two" isn't a quantity

    # Inline runner: the background task has finished by the time TestClient returns.
    status = client.get(f"/collections/imports/{body['job_id']}").json()
    assert status["status"] == "succeeded"
    assert status["not_found"] == [{"line": 6, "name": "Not A Real Card"}]
    assert status["unique_cards"] == 3

    page = client.get(f"/collections/{body['collection_id']}/cards").json()
    owned = {c["name"]: c["quantity"] for c in page["cards"]}
    # Sol Ring rows add up (2 + 1); Arcane Signet's bad collector number fell back to name.
    assert owned == {"Arcane Signet": 1, "Lightning Bolt": 3, "Sol Ring": 3}
    assert page["total"] == 3


def test_reimport_uses_stored_cards_instead_of_scryfall(
    api: tuple[TestClient, FakeScryfall],
) -> None:
    client, fake = api
    upload(client, b"Name,Count\nSol Ring,1\nLightning Bolt,1\n")
    calls_after_first = len(fake.requests)

    app.state.scryfall._cache = type(app.state.scryfall._cache)()  # drop the in-memory cache
    second = upload(client, b"Name,Count\nSol Ring,4\n").json()

    assert len(fake.requests) == calls_after_first  # served from Postgres
    page = client.get(f"/collections/{second['collection_id']}/cards").json()
    assert [(c["name"], c["quantity"]) for c in page["cards"]] == [("Sol Ring", 4)]


def test_owned_cards_pagination(api: tuple[TestClient, FakeScryfall]) -> None:
    client, _ = api
    collection_id = upload(client).json()["collection_id"]
    first = client.get(f"/collections/{collection_id}/cards?limit=2").json()
    second = client.get(f"/collections/{collection_id}/cards?limit=2&offset=2").json()
    names = [c["name"] for c in first["cards"] + second["cards"]]
    assert names == ["Arcane Signet", "Lightning Bolt", "Sol Ring"]


def test_rejects_bad_uploads(api: tuple[TestClient, FakeScryfall]) -> None:
    client, _ = api
    assert upload(client, b"\xff\xfe\x00garbage").status_code == 400
    assert upload(client, b"Name\n,\n").status_code == 422
    assert client.get("/collections/999/cards").status_code == 404

    settings = get_settings()
    original = settings.max_upload_bytes
    settings.max_upload_bytes = 10
    try:
        assert upload(client).status_code == 413
    finally:
        settings.max_upload_bytes = original


def test_printing_that_names_a_different_card_falls_back_to_name(
    api: tuple[TestClient, FakeScryfall],
) -> None:
    client, _ = api
    # c21 #263 is Sol Ring, but the row says Lightning Bolt: trust the name.
    body = upload(client, b"Count,Name,Edition,Collector Number\n1,Lightning Bolt,c21,263\n").json()
    page = client.get(f"/collections/{body['collection_id']}/cards").json()
    assert [c["name"] for c in page["cards"]] == ["Lightning Bolt"]


def test_large_reimport_is_chunked_and_fast(api: tuple[TestClient, FakeScryfall]) -> None:
    client, fake = api
    many = {f"card {i}": card_json(f"Card {i}", "tst", str(i)) for i in range(2500)}
    fake.known.update(many)
    csv = b"Name\n" + b"\n".join(f"Card {i}".encode() for i in range(2500))
    upload(client, csv)
    calls = len(fake.requests)

    app.state.scryfall._cache = type(app.state.scryfall._cache)()
    second = upload(client, csv).json()  # 2,500 names > one lookup chunk, all from Postgres
    status = client.get(f"/collections/imports/{second['job_id']}").json()
    assert status["status"] == "succeeded"
    assert status["unique_cards"] == 2500
    assert len(fake.requests) == calls


def test_requires_api_key(api: tuple[TestClient, FakeScryfall]) -> None:
    client, _ = api
    assert client.get("/collections", headers={"X-API-Key": "wrong"}).status_code == 401
    assert client.get("/collections").status_code == 200  # the fixture sends the right key


def test_list_filter_and_commanders(api: tuple[TestClient, FakeScryfall]) -> None:
    client, fake = api
    leader = card_json(
        "Krenko, Mob Boss",
        "ddt",
        "52",
        type_line="Legendary Creature — Goblin Warrior",
        color_identity=["R"],
        legalities={"commander": "legal"},
        image_uris={"normal": "https://img.test/krenko.jpg", "small": "https://img.test/s.jpg"},
    )
    fake.known[leader["name"].lower()] = leader
    csv = b'Name\n"Krenko, Mob Boss"\nLightning Bolt\nSol Ring\n'  # quoted: the name has a comma
    collection_id = upload(client, csv).json()["collection_id"]

    listed = client.get("/collections").json()
    assert listed[0]["id"] == collection_id and listed[0]["unique_cards"] == 3

    red_only = client.get(f"/collections/{collection_id}/cards?identity_within=R").json()
    assert {c["name"] for c in red_only["cards"]} == {
        "Krenko, Mob Boss",
        "Lightning Bolt",
        "Sol Ring",
    }
    colorless = client.get(f"/collections/{collection_id}/cards?identity_within=").json()
    assert [c["name"] for c in colorless["cards"]] == ["Sol Ring"]
    creatures = client.get(f"/collections/{collection_id}/cards?type_line=creature").json()
    assert [c["name"] for c in creatures["cards"]] == ["Krenko, Mob Boss"]
    assert creatures["cards"][0]["image_url"] == "https://img.test/krenko.jpg"

    leaders = client.get(f"/collections/{collection_id}/commanders").json()
    assert [c["name"] for c in leaders] == ["Krenko, Mob Boss"]

    found = client.post(
        f"/collections/{collection_id}/cards/lookup", json={"names": ["sol ring", "Nope"]}
    ).json()
    assert [c["name"] for c in found] == ["Sol Ring"]

    assert client.delete(f"/collections/{collection_id}").status_code == 204
    assert client.get(f"/collections/{collection_id}/cards").status_code == 404
