import pytest

from app.collection.csv_parser import CsvFormatError, parse_collection_csv

MOXFIELD = b""""Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number"
"2","0","Sol Ring","c21","Near Mint","English","","","2026-01-01","263"
"1","0","Fire // Ice","mh2","Near Mint","English","foil","","2026-01-01","290"
"""

MANABOX = b"""Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price
Arcane Signet,M3C,Modern Horizons 3 Commander,283,normal,common,3,1234,3d6c8f50-9a2b-4d8e-8f0e-1a2b3c4d5e6f,0.25
"""


def parse(data: bytes, max_rows: int = 100):
    return parse_collection_csv(data, max_rows=max_rows)


def test_moxfield_export() -> None:
    result = parse(MOXFIELD)
    assert result.format == "moxfield"
    assert result.errors == []
    sol_ring, fire_ice = result.rows
    assert (sol_ring.name, sol_ring.quantity, sol_ring.set_code) == ("Sol Ring", 2, "c21")
    assert sol_ring.collector_number == "263"
    assert fire_ice.name == "Fire // Ice"


def test_manabox_export_maps_set_code_and_scryfall_id() -> None:
    result = parse(MANABOX)
    assert result.format == "manabox"
    (row,) = result.rows
    assert row.set_code == "m3c"  # lowercased for Scryfall
    assert row.quantity == 3
    assert str(row.scryfall_id) == "3d6c8f50-9a2b-4d8e-8f0e-1a2b3c4d5e6f"


def test_generic_name_only_list_defaults_quantity_to_one() -> None:
    result = parse(b"Name\nSol Ring\nCommand Tower\n")
    assert result.format == "generic"
    assert [(r.name, r.quantity) for r in result.rows] == [("Sol Ring", 1), ("Command Tower", 1)]


def test_bad_rows_are_reported_and_good_rows_still_import() -> None:
    data = (
        b"Count,Name,Edition,Scryfall ID\n"
        b"1,Sol Ring,c21,\n"
        b"two,Command Tower,c21,\n"  # quantity not a number
        b"1,,c21,\n"  # missing name
        b"1,Arcane Signet,not a set!,\n"  # invalid set code
        b"1,Lightning Bolt,,not-a-uuid\n"
    )
    result = parse(data)
    assert [r.name for r in result.rows] == ["Sol Ring"]
    assert [e.line for e in result.errors] == [3, 4, 5, 6]
    assert "quantity" in result.errors[0].message


def test_byte_order_mark_and_blank_lines_are_ignored() -> None:
    result = parse(b"\xef\xbb\xbfName,Count\n\nSol Ring,1\n\n")
    assert [r.name for r in result.rows] == ["Sol Ring"]


def test_quoted_newline_in_name_is_rejected_without_breaking_line_numbers() -> None:
    result = parse(b'Name\n"Sol\nRing"\nCommand Tower\n')
    assert len(result.errors) == 1
    assert [(r.name, r.line) for r in result.rows] == [("Command Tower", 4)]


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"", "empty"),
        (b"Count,Edition\n1,c21\n", "name column"),
        ("Name\nJötun Grunt\n".encode("utf-16"), "UTF-8"),
    ],
)
def test_file_level_problems_raise(data: bytes, message: str) -> None:
    with pytest.raises(CsvFormatError, match=message):
        parse(data)


def test_row_limit() -> None:
    with pytest.raises(CsvFormatError, match="more than 2 rows"):
        parse(b"Name\nA\nB\nC\n", max_rows=2)


def test_blank_quantity_defaults_to_one() -> None:
    (row,) = parse(b"Count,Name\n,Sol Ring\n").rows
    assert row.quantity == 1
