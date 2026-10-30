"""Shared setup for evals: test environment, golden collections, and the scorecard."""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from dotenv import dotenv_values

from app.config import ENV_FILE

# Read the real Gemini settings BEFORE tests.conftest blanks them for the offline tests.
# Only the opt-in `live` evals use them.
_real_env = dotenv_values(ENV_FILE)
LIVE_GEMINI_KEY = _real_env.get("GEMINI_API_KEY") or ""
LIVE_GEMINI_MODEL = _real_env.get("GEMINI_MODEL") or "gemini-3.8-flash"

from evals.checks import EvalReport  # noqa: E402
from evals.golden import GOLDEN, GoldenCase  # noqa: E402
from tests.conftest import reset_db, running_app  # noqa: E402  (also sets the test environment)

RESULTS_FILE = Path(__file__).parent / "results" / "latest.json"
REPORTS: list[EvalReport] = []


@pytest.fixture(params=GOLDEN, ids=[case.name for case in GOLDEN])
def golden(request: pytest.FixtureRequest) -> Iterator[tuple[GoldenCase, int]]:
    """A fresh database with one golden collection imported. Yields (case, collection id)."""
    case: GoldenCase = request.param
    reset_db()
    with running_app({c["name"].lower(): c for c in case.cards}) as (client, _fake):
        response = client.post(
            "/collections/import", files={"file": ("c.csv", case.csv, "text/csv")}
        )
        yield case, response.json()["collection_id"]


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    """Print the scorecard after the run and save it as JSON for comparing runs."""
    if not REPORTS:
        return
    terminalreporter.write_sep("=", "eval scorecard")
    for report in REPORTS:
        terminalreporter.write_line(report.line())
    RESULTS_FILE.parent.mkdir(exist_ok=True)
    RESULTS_FILE.write_text(
        json.dumps(
            [
                {
                    "case": r.case,
                    "engine": r.engine,
                    "passed": r.passed,
                    **r.metrics,
                    "problems": r.problems,
                }
                for r in REPORTS
            ],
            indent=2,
        )
    )
