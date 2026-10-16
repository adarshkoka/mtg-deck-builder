"""A fake Scryfall API for tests (served through httpx.MockTransport).

Supports POST /cards/collection (batch lookup) and GET /cards/search (paginated search).
"""

import json
from uuid import uuid4

import httpx


def card_json(name: str, set_code: str = "c21", number: str = "1", **extra: object) -> dict:
    return {"id": str(uuid4()), "name": name, "set": set_code, "collector_number": number, **extra}


class FakeScryfall:
    """Finds cards by id, by set + collector number, or by name. Can fail the first N calls."""

    def __init__(self, known: dict[str, dict], fail_with: list[int] | None = None) -> None:
        self.known = known  # lowercase name -> card JSON
        self.fail_with = list(fail_with or [])
        self.requests: list[list[dict]] = []
        # Every search returns these cards, `page_size` per page, like Scryfall's paging.
        self.search_results: list[dict] = []
        self.page_size = 2
        self.search_queries: list[str] = []

    def _find(self, ident: dict) -> dict | None:
        for card in self.known.values():
            if "id" in ident:
                if ident["id"] == card["id"]:
                    return card
            elif "collector_number" in ident:
                if (ident["set"], ident["collector_number"]) == (
                    card["set"],
                    card["collector_number"],
                ):
                    return card
            else:
                # Like Scryfall, a double-faced card also matches its front-face name.
                names = [card["name"], *(f["name"] for f in card.get("card_faces", []))]
                if ident.get("name", "").casefold() in (n.casefold() for n in names):
                    return card
        return None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.fail_with:
            return httpx.Response(self.fail_with.pop(0))
        if request.method == "GET" and request.url.path == "/cards/search":
            return self._search(request)
        identifiers = json.loads(request.content)["identifiers"]
        self.requests.append(identifiers)
        data, not_found = [], []
        for ident in identifiers:
            card = self._find(ident)
            if card:
                data.append(card)
            else:
                not_found.append(ident)
        return httpx.Response(200, json={"object": "list", "data": data, "not_found": not_found})

    def _search(self, request: httpx.Request) -> httpx.Response:
        query = request.url.params["q"]
        page = int(request.url.params.get("page", "1"))
        self.search_queries.append(query)
        if not self.search_results:
            return httpx.Response(404, json={"object": "error", "code": "not_found"})
        start = (page - 1) * self.page_size
        data = self.search_results[start : start + self.page_size]
        has_more = start + self.page_size < len(self.search_results)
        body: dict = {
            "object": "list",
            "total_cards": len(self.search_results),
            "has_more": has_more,
            "data": data,
        }
        if has_more:
            body["next_page"] = str(request.url.copy_merge_params({"page": str(page + 1)}))
        return httpx.Response(200, json=body)
