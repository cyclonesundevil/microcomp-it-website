"""Keep the committed browser compatibility fixture tied to Python behavior."""

from __future__ import annotations

import json
from pathlib import Path

from microcomp_llm.browser_fixture import build_browser_fixture


FIXTURE_PATH = (
    Path(__file__).resolve().parents[3]
    / "frontend"
    / "llm-training-lab"
    / "fixtures"
    / "python-parity-v1.json"
)


def test_committed_browser_fixture_matches_python_reference() -> None:
    committed = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    assert committed == build_browser_fixture()
