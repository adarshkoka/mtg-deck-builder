"""Parse collection CSV exports (Moxfield, ManaBox, Archidekt, or a plain name/quantity list).

The file is untrusted input: every row is validated on its own, bad rows are reported
with their line number, and the rest of the file still imports.
"""

import csv
import io
import re
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

type CsvFormat = Literal["moxfield", "manabox", "archidekt", "generic"]

# Canonical field -> header names used by the export formats (compared lowercase).
# Unknown columns are ignored, so new export columns don't break the import.
HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "name": ("name", "card name", "card"),
    "quantity": ("count", "quantity", "qty"),
    "set_code": ("edition", "set code", "edition code", "set"),
    "collector_number": ("collector number", "collector_number", "card number"),
    "scryfall_id": ("scryfall id", "scryfall_id"),
}

CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class CsvFormatError(ValueError):
    """The file as a whole can't be imported (wrong encoding, no usable header, too big)."""


class CollectionRow(BaseModel):
    """One validated CSV row, mapped to our own field names."""

    model_config = ConfigDict(frozen=True, str_strip_whitespace=True)

    line: int
    name: Annotated[str, Field(min_length=1, max_length=200)]
    quantity: Annotated[int, Field(ge=1, le=1000)] = 1
    set_code: Annotated[str | None, Field(pattern=r"^[a-z0-9]{2,6}$")] = None
    collector_number: Annotated[str | None, Field(pattern=r"^[0-9A-Za-z★†\-]{1,10}$")] = None
    scryfall_id: UUID | None = None

    @field_validator("set_code", "collector_number", "scryfall_id", mode="before")
    @classmethod
    def blank_to_none(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("quantity", mode="before")
    @classmethod
    def blank_quantity_is_one(cls, value: object) -> object:
        return 1 if isinstance(value, str) and not value.strip() else value

    @field_validator("set_code", mode="before")
    @classmethod
    def lowercase_set(cls, value: object) -> object:
        # ManaBox writes "ZNR", Moxfield writes "znr"; Scryfall uses lowercase.
        return value.lower() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def no_control_chars(cls, value: str) -> str:
        if CONTROL_CHARS.search(value):
            raise ValueError("contains control characters")
        return value


class RowError(BaseModel):
    line: int
    message: str


class ParseResult(BaseModel):
    format: CsvFormat
    rows: list[CollectionRow]
    errors: list[RowError]


def parse_collection_csv(data: bytes, *, max_rows: int) -> ParseResult:
    try:
        # utf-8-sig strips the byte-order mark that Excel adds to CSVs.
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise CsvFormatError("File must be UTF-8 encoded CSV") from exc

    reader = csv.reader(io.StringIO(text, newline=""))
    try:
        header = next((row for row in reader if any(cell.strip() for cell in row)), None)
        if header is None:
            raise CsvFormatError("File is empty")
        columns = _map_header(header)

        rows: list[CollectionRow] = []
        errors: list[RowError] = []
        for raw in reader:
            if not any(cell.strip() for cell in raw):
                continue  # skip blank lines
            if len(rows) + len(errors) >= max_rows:
                raise CsvFormatError(f"File has more than {max_rows} rows")
            line = reader.line_num  # physical line, correct even with quoted newlines
            fields = {field: raw[i] if i < len(raw) else "" for field, i in columns.items()}
            try:
                rows.append(CollectionRow.model_validate({"line": line, **fields}))
            except ValidationError as exc:
                errors.append(RowError(line=line, message=_describe(exc)))
    except csv.Error as exc:  # e.g. a field over the csv module's size limit
        raise CsvFormatError(f"Malformed CSV: {exc}") from exc

    return ParseResult(format=_detect_format(header), rows=rows, errors=errors)


def _map_header(header: list[str]) -> dict[str, int]:
    """Return canonical field -> column index for the columns we recognise."""
    normalized = [h.strip().lower() for h in header]
    columns: dict[str, int] = {}
    for field, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            if alias in normalized:
                columns[field] = normalized.index(alias)
                break
    if "name" not in columns:
        raise CsvFormatError("No card name column found (expected a 'Name' header)")
    return columns


def _detect_format(header: list[str]) -> CsvFormat:
    # Informational only; parsing relies on the header aliases, not on the format.
    normalized = {h.strip().lower() for h in header}
    if "tradelist count" in normalized:
        return "moxfield"
    if "manabox id" in normalized:
        return "manabox"
    if "edition code" in normalized:
        return "archidekt"
    return "generic"


def _describe(exc: ValidationError) -> str:
    return "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors())
