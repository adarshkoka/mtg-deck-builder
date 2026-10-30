"""Deterministic stand-ins for the LLM, so the eval harness runs offline in every test run.

- PolicyModel plays the agent's side of the hand-written loop with simple rules: search
  every role in parallel, pick cards to fill role targets, submit, fix rejections.
- greedy_chooser plays the single LLM step of the LangGraph workflow.

They're not smart; they make sure the harness, tools, and rules work end to end. The
`live` evals put the real model in the same seat.
"""

import re
from collections.abc import Sequence

from app.agent.langgraph_flow import ChooseRequest
from app.agent.llm import ModelTurn, ToolCall, ToolResult
from app.agent.models import CardPick, Role
from app.agent.rules import BASIC_LANDS
from app.agent.tools import Tool

# (role, search arguments). All are sent together in the first turn.
SEARCHES: list[tuple[Role, dict[str, object]]] = [
    ("ramp", {"text": "add {", "limit": 40}),
    ("ramp", {"text": "search your library for a basic land", "limit": 40}),
    ("card_draw", {"text": "draw", "limit": 40}),
    ("removal", {"text": "destroy target", "limit": 40}),
    ("removal", {"text": "counter target", "limit": 40}),
    ("removal", {"text": "damage to any target", "limit": 40}),
    ("board_wipe", {"text": "destroy all", "limit": 20}),
    ("land", {"type_line": "Land", "limit": 40}),
    ("synergy", {"type_line": "Creature", "limit": 40}),
    # Everything usable, three pages deep: fills any role that came up short.
    ("utility", {"limit": 40, "offset": 0}),
    ("utility", {"limit": 40, "offset": 40}),
    ("utility", {"limit": 40, "offset": 80}),
]
TARGETS: dict[Role, int] = {
    "ramp": 10,
    "card_draw": 10,
    "removal": 8,
    "board_wipe": 3,
    "land": 3,
    "synergy": 99,
}
MAX_SPELLS, MAX_LANDS = 61, 3


class PolicyModel:
    name = "eval-policy"

    def start(self, system_prompt: str, tools: Sequence[Tool]) -> PolicyModel:
        del system_prompt, tools
        self._candidates: dict[Role, list[str]] = {}
        self._lands: set[str] = set()  # names whose type line says Land
        self._picks: list[CardPick] = []
        return self

    async def send_user(self, text: str, *, only_tools: list[str] | None = None) -> ModelTurn:
        del text, only_tools
        calls = [ToolCall("search_collection", dict(args)) for _, args in SEARCHES]
        return ModelTurn("Searching every role.", calls)

    async def send_tool_results(
        self, results: list[ToolResult], *, only_tools: list[str] | None = None
    ) -> ModelTurn:
        del only_tools  # this policy always submits right after searching anyway
        if results and results[0].call.name == "search_collection":
            for (role, _), result in zip(SEARCHES, results, strict=True):
                cards = result.output.get("cards", [])
                self._candidates.setdefault(role, []).extend(c["name"] for c in cards)
                self._lands.update(c["name"] for c in cards if "Land" in c["type_line"])
            self._picks = self._choose(exclude=set())
            return self._submit()
        verdict = results[0].output
        if results[0].call.name == "submit_deck" and not verdict.get("accepted"):
            # Drop every card named in a problem ("Name: reason") and fill the gaps again.
            bad = {re.split(r":\s", p, maxsplit=1)[0] for p in verdict.get("problems", [])}
            keep = [p for p in self._picks if p.name not in bad]
            self._picks = keep + self._choose(exclude=bad | {p.name for p in keep}, start=keep)
            return self._submit()
        return ModelTurn("Done.")

    def _choose(self, exclude: set[str], start: Sequence[CardPick] = ()) -> list[CardPick]:
        taken = set(exclude) | {p.name for p in start}
        # A card counts as a land because of its type line, not because of which search
        # found it ("add {G}" finds mana lands as well as mana rocks).
        lands = sum(1 for p in start if p.name in self._lands)
        spells = len(start) - lands
        picks: list[CardPick] = []
        for role, target in TARGETS.items():
            count = 0
            for name in self._candidates.get(role, []):
                if name in taken or name in BASIC_LANDS or count >= target:
                    continue
                is_land = name in self._lands
                if (is_land and lands >= MAX_LANDS) or (not is_land and spells >= MAX_SPELLS):
                    continue
                pick_role: Role = "land" if is_land else role
                reason = f"Fills the {pick_role} slot for this deck."
                picks.append(CardPick(name=name, role=pick_role, reason=reason))
                taken.add(name)
                count += 1
                if is_land:
                    lands += 1
                else:
                    spells += 1
        return picks

    def _submit(self) -> ModelTurn:
        picks = [p.model_dump() for p in self._picks]
        return ModelTurn(
            "", [ToolCall("submit_deck", {"picks": picks, "summary": "A balanced deck."})]
        )


async def greedy_chooser(request: ChooseRequest) -> list[CardPick]:
    """Fill each role's target from its candidates, in order (LangGraph's LLM step)."""
    taken = {p.name for p in request.keep} | set(request.avoid)
    needed = 64 - len(request.keep)
    picks: list[CardPick] = []
    # The role targets first, then top up from the "utility" pool if anything came up short.
    plan = [*request.targets.items(), ("utility", needed)]
    for role, target in plan:
        count = 0
        for card in request.candidates.get(role, []):
            if len(picks) >= needed or count >= target or card.name in taken:
                continue
            # model_validate checks the role string against the allowed Role values.
            reason = f"Fills the {role} slot for this deck."
            picks.append(
                CardPick.model_validate({"name": card.name, "role": role, "reason": reason})
            )
            taken.add(card.name)
            count += 1
    return picks
