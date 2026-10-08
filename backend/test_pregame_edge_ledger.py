import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest


BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from app import app
from experimental import pregame_edge_ledger as ledger


def test_normalize_ledger_row_accepts_ats_snapshot():
    row = ledger.normalize_ledger_row({
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_ATL_NO",
        "away_team": "ATL",
        "home_team": "NO",
        "model": "current_season_matrix",
        "market_type": "ATS",
        "market_line": -9,
        "model_projection": -5.5,
        "model_edge": 3.5,
        "model_pick": "home",
        "observed_at": "2026-10-08T15:00:00Z",
    })

    assert row["market_type"] == "ATS"
    assert row["market_line"] == -9
    assert row["model_pick"] == "home"


def test_import_ledger_rows_deduplicates(tmp_path, monkeypatch):
    monkeypatch.setattr(ledger, "pregame_ledger_data_root", lambda: tmp_path)
    row = {
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_ATL_NO",
        "away_team": "ATL",
        "home_team": "NO",
        "model": "rsm_plus",
        "market_type": "OU",
        "market_line": 47.5,
        "model_projection": 51,
        "model_edge": 3.5,
        "model_pick": "over",
        "observed_at": "2026-10-08T15:00:00Z",
    }

    first = ledger.import_ledger_rows([row])
    second = ledger.import_ledger_rows([row])

    assert first["imported"] == 1
    assert second["imported"] == 1
    assert second["total_rows"] == 1


def test_ats_grading_uses_market_line_not_model_projection():
    rows = [ledger.normalize_ledger_row({
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_FAV_DOG",
        "away_team": "DOG",
        "home_team": "FAV",
        "model": "current_season_matrix",
        "market_type": "ATS",
        "market_line": 9.0,
        "model_projection": 5.5,
        "model_edge": -3.5,
        "model_pick": "away",
    })]
    games = [{
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_FAV_DOG",
        "away_team": "DOG",
        "home_team": "FAV",
        "actual_margin": 7.0,
        "home_score": 27,
        "away_score": 20,
    }]

    graded = ledger.grade_ledger_rows(rows, games)

    assert graded[0]["result"] == "win"
    assert graded[0]["margin_error"] == pytest.approx(1.5)


def test_ou_grading_uses_captured_total_line():
    rows = [ledger.normalize_ledger_row({
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_ATL_NO",
        "away_team": "ATL",
        "home_team": "NO",
        "model": "rsm_stage7c",
        "market_type": "OU",
        "market_line": 47.5,
        "model_projection": 51.0,
        "model_edge": 3.5,
        "model_pick": "over",
    })]
    games = [{
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_ATL_NO",
        "away_team": "ATL",
        "home_team": "NO",
        "home_score": 24,
        "away_score": 20,
    }]

    graded = ledger.grade_ledger_rows(rows, games)

    assert graded[0]["result"] == "loss"
    assert graded[0]["total_error"] == pytest.approx(-7.0)


def test_edge_bucket_assignment():
    assert ledger.edge_bucket(0.5) == "0 to 1"
    assert ledger.edge_bucket(1.5) == "1 to 2"
    assert ledger.edge_bucket(2.5) == "2 to 3"
    assert ledger.edge_bucket(3.0) == "3+"


def test_model_agreement_grouping_counts_agreed_picks():
    rows = []
    for model in ("current_season_matrix", "rsm_stage7c", "rsm_plus"):
        rows.append(ledger.normalize_ledger_row({
            "season": 2026,
            "week": 5,
            "game_id": "2026_05_ATL_NO",
            "away_team": "ATL",
            "home_team": "NO",
            "model": model,
            "market_type": "ATS",
            "market_line": -2.5,
            "model_projection": -5.0,
            "model_edge": -2.5,
            "model_pick": "away",
        }))
    graded = ledger.grade_ledger_rows(rows, [{
        "season": 2026,
        "week": 5,
        "game_id": "2026_05_ATL_NO",
        "away_team": "ATL",
        "home_team": "NO",
        "actual_margin": -3.0,
    }])

    groups = ledger.model_agreement_analysis(graded)
    all_group = next(row for row in groups if row["group"] == "CS Matrix + RSM + RSM+" and row["market_type"] == "ATS")

    assert all_group["sample_size"] == 3
    assert all_group["wins"] == 3


@pytest.mark.anyio
async def test_pregame_ledger_snapshot_route_is_admin_protected(tmp_path, monkeypatch):
    previous_secret = os.environ.get("ADMIN_SECRET")
    os.environ["ADMIN_SECRET"] = "test-admin-secret"
    monkeypatch.setattr(ledger, "pregame_ledger_data_root", lambda: tmp_path)
    snapshot = {
        "season": 2026,
        "week": 5,
        "games": [{
            "schedule": {
                "season": 2026,
                "week": 5,
                "game_id": "2026_05_ATL_NO",
                "gameday": "2026-10-08",
                "away_team": "ATL",
                "home_team": "NO",
                "spread_line": -2.5,
                "total_line": 47.5,
            },
            "models": {
                "current_season_matrix": {
                    "pred_margin": -5.5,
                    "pred_total": 51,
                    "market_margin": -2.5,
                    "total_line": 47.5,
                    "spread_edge": -3,
                    "total_edge": 3.5,
                    "spread_pick": "away",
                    "total_pick": "over",
                    "spread_threshold": 3,
                    "total_threshold": 2,
                }
            },
        }],
    }
    client = app.test_client()
    try:
        blocked = await client.post("/api/nfl/experimental/pregame-ledger/snapshot")
        with patch.object(__import__("app"), "load_nfl_games_for_request", new=AsyncMock(return_value=([], {}))), \
            patch.object(__import__("app"), "cached_upcoming_predictions", return_value=snapshot), \
            patch.object(__import__("app"), "upcoming_predictions_for_roster_basis", return_value=snapshot):
            allowed = await client.post("/api/nfl/experimental/pregame-ledger/snapshot?secret=test-admin-secret")
            payload = await allowed.get_json()
    finally:
        if previous_secret is None:
            os.environ.pop("ADMIN_SECRET", None)
        else:
            os.environ["ADMIN_SECRET"] = previous_secret

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    assert payload["created_rows"] == 2
