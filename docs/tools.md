# Agent tools

The deck-building agent works only through these tools. Each is one async function in
`app/agent/tools.py` with a Pydantic argument model (validated before it runs) and a
Pydantic result model. The same functions back the REST API and the MCP server
(`app/mcp_server.py`), so they behave identically everywhere.

Shared conventions:
- **Scope.** Collection tools only ever see cards the commander can legally use: owned,
  legal in Commander, and inside the commander's color identity.
- **Errors are results.** Bad arguments, unknown tools, and expected failures come back
  as `{"error": "..."}` (or `available: false`) so the model can read them and recover.
  A run never crashes because of a tool call.
- **Size.** Any single result is capped at 15,000 characters; rules text in search
  results is trimmed to 180 characters (use `get_card_details` for the full text).
- **Untrusted data.** Card names and text are data. The system prompt tells the model to
  ignore instructions inside them, and `submit_deck` re-checks everything in code.

| Tool | Purpose |
|---|---|
| `search_collection` | Filtered search of the user's collection |
| `find_synergy_cards` | Search the collection by meaning (semantic + keyword) |
| `get_card_details` | Full text and stats for named cards |
| `check_deck_rules` | Validate a draft deck against the Commander rules |
| `get_deck_stats` | Mana curve, land count, role counts vs targets |
| `suggest_purchases` | Search all cards (Scryfall) for cards worth buying |
| `submit_deck` | The final answer; validated in code |

## search_collection
Arguments: `type_line`, `text`, `name` (substring filters), `min_cmc`, `max_cmc`,
`limit` (1-40, default 25), `offset` (paging).
Result: `total_matches`, `returned`, `next_offset` (null when there are no more),
`cards[]` of `{name, mana_cost, cmc, type_line, text, tags}`. `tags` are estimated roles
(`ramp`, `card_draw`, `removal`, `board_wipe`) from the rules text.
Example: `{"type_line": "Instant", "text": "destroy target"}`.

## find_synergy_cards
Arguments: `theme` (3-300 chars, plain words), `limit` (1-30).
Result: `search_type` (`"meaning + keywords"`, or `"keywords only"` when embeddings are
unavailable) and `cards[]` (same shape as above), best match first.
How it works: hybrid retrieval in `app/collection/synergy.py` (pgvector cosine distance
plus Postgres full-text rank, merged with Reciprocal Rank Fusion).
Example: `{"theme": "benefit when creatures die"}`.

## get_card_details
Arguments: `names` (1-25 exact names; a double-faced card's front name also works).
Result: `cards[]` with `owned`, full `oracle_text`, power/toughness, color identity,
keywords, Commander legality. Unknown names come back with `owned: false`.

## check_deck_rules
Arguments: `cards` (names of every non-basic card; not the commander, not basic lands).
Result: `check` = `{ok, card_count, land_count, problems[]}` and `basic_lands_added`.
Basic lands are added automatically to fill the deck to 100, split by the colors in the
cards' mana costs. Problems name the card and the rule, e.g.
`"Ember Bolt: color identity R is outside the commander's (G)"`.

## get_deck_stats
Arguments: same as `check_deck_rules`.
Result: `card_count`, `land_count`, `nonland_count`, `average_cmc`, `mana_curve`,
`category_counts`, `targets`, and `notes` such as `"Only about 4 removal cards; aim for 8+."`

## suggest_purchases
Arguments: `query` (Scryfall search syntax, e.g. `o:token t:creature`), `max_results` (1-10).
The tool adds `id<=<commander colors> legal:commander -is:digital` and skips owned cards.
Result: `available`, `total_matches`, `cards[]` with price and Scryfall link. Follows
Scryfall's pagination (`has_more` / `next_page`) for up to 2 pages; results are cached.

## submit_deck
Arguments: `picks[]` of `{name, role, reason}` (non-basic cards only, max 99), `summary`,
optional `suggested_buys[]` of `{name, reason}`.
Result: `{accepted: true}` ends the run. Otherwise `{accepted: false, problems[]}`, and the
model must fix every problem and submit again. Suggested buys are kept only if they came
from `suggest_purchases` in the same run, so invented card names never reach the user.

## Adding a tool
Follow `.claude/skills/add-agent-tool/SKILL.md` at the repo root.
