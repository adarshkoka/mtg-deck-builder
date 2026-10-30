"""Scoring a finished deck: deterministic checks plus a few descriptive metrics.

LLM output is non-deterministic, so evals don't compare against one "right" deck. They
check properties every good answer must have (legal, owned, no traps, balanced) and
record metrics (size, shape, cost) so runs can be compared over time.
"""

from dataclasses import dataclass, field

from app.agent.models import DeckRecommendation
from app.agent.rules import CollectionIndex, check_deck, deck_stats, normalize_name
from evals.golden import GoldenCase


@dataclass
class EvalReport:
    case: str
    engine: str
    checks: dict[str, bool] = field(default_factory=dict)
    metrics: dict[str, float | int] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(self.checks.values())

    def line(self) -> str:
        failed = [name for name, ok in self.checks.items() if not ok]
        status = "PASS" if self.passed else f"FAIL ({', '.join(failed)})"
        metrics = " ".join(f"{k}={v}" for k, v in self.metrics.items())
        return f"{self.case:<16} {self.engine:<10} {status:<28} {metrics}"


def evaluate(
    case: GoldenCase,
    engine: str,
    deck: DeckRecommendation,
    index: CollectionIndex,
    *,
    model_calls: int = 0,
    tokens: int = 0,
) -> EvalReport:
    report = EvalReport(case.name, engine)
    commander = index.find(case.commander)
    assert commander is not None, f"golden case {case.name}: commander not in collection"
    names = [p.name for p in deck.picks]

    # 1. The app's own rules, re-checked independently of whatever produced the deck.
    rules = check_deck(
        commander, names, deck.basic_lands, index, max_lands=index.max_lands_for(commander)
    )
    report.checks["legal_100_card_deck"] = rules.ok
    report.problems += rules.problems

    # 2. Trap cards (off-color, banned, prompt-injected) never make it in.
    picked = {normalize_name(n) for n in names}
    leaked = sorted(t for t in case.traps if normalize_name(t) in picked)
    report.checks["no_trap_cards"] = not leaked
    report.problems += [f"trap card picked: {t}" for t in leaked]

    # 3. Every pick explains itself.
    report.checks["every_pick_has_a_reason"] = all(len(p.reason.strip()) >= 10 for p in deck.picks)

    # 4. A rich collection should produce a balanced deck.
    owned = [c for c in (index.find(n) for n in names) if c is not None]
    stats = deck_stats(owned, deck.basic_lands)
    counts = stats.category_counts
    if case.rich:
        report.checks["roles_covered"] = (
            counts["ramp"] >= 6 and counts["card_draw"] >= 6 and counts["removal"] >= 4
        )
    report.metrics = {
        "picks": len(names),
        "lands": stats.land_count,
        "avg_mv": stats.average_cmc,
        "ramp": counts["ramp"],
        "draw": counts["card_draw"],
        "removal": counts["removal"],
        "model_calls": model_calls,
        "tokens": tokens,
    }
    return report
